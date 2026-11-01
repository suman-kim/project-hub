import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { App } from '../apps/app.entity';
import { ActivitiesService } from '../activities/activities.service';
import { AppsService } from '../apps/apps.service';
import { Task } from './task.entity';
import { allocateTaskIds } from './tasks.service';
import { composeDescription, mapTmStatus, parseTaskmasterFile } from './taskmaster-import';

export interface ImportResult {
  app: string;
  imported: number;
  skipped: number;
  /** 제목·설명·의존을 덮어쓴 task 수 (update일 때) */
  updated: number;
  tags: Record<string, { imported: number; skipped: number }>;
  /** 무엇이 바뀌는지: 새로 추가할 것, 내용이 바뀐 것, 같은 것 */
  preview: {
    add: Array<{ tag: string; tmId: string; title: string }>;
    changed: Array<{ id: string; title: string; fields: string[] }>;
    same: number;
  };
}

export interface ImportOptions {
  path?: string;
  /** 바꾸지 않고 미리 보기만 */
  dryRun?: boolean;
  /** 이미 가져온 task의 제목·설명·의존이 바뀌었으면 덮어쓴다. 상태는 Hub 것을 둔다 */
  update?: boolean;
}

/**
 * 앱 하나의 Task Master tasks.json을 한 번 가져온다.
 * 이미 가져온 task(metadata.taskmaster의 tag+id가 같은 것)는 건너뛰어 여러 번 불러도 안전하다.
 */
@Injectable()
export class TaskmasterImportService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly apps: AppsService,
    private readonly activities: ActivitiesService,
  ) {}

  async import(appCode: string, opts: ImportOptions = {}): Promise<ImportResult> {
    const { path, dryRun = false, update = false } = opts;
    const app = await this.apps.getByCode(appCode);
    if (!app.repoPath) throw new BadRequestException(`앱 ${app.code}에 repo_path가 없다`);

    const file = resolve(app.repoPath, path ?? join('.taskmaster', 'tasks', 'tasks.json'));
    const rel = relative(app.repoPath, file);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new BadRequestException('앱 저장소 밖의 파일은 가져올 수 없다');

    let tagged;
    try {
      tagged = parseTaskmasterFile(JSON.parse(await readFile(file, 'utf8')));
    } catch (e) {
      throw new BadRequestException(`tasks.json을 읽을 수 없다: ${(e as Error).message}`);
    }

    const result: ImportResult = { app: app.code, imported: 0, skipped: 0, updated: 0, tags: {}, preview: { add: [], changed: [], same: 0 } };

    await this.ds.transaction(async (em) => {
      const existingRows: Array<{ id: string; tag: string; tm_id: string; title: string; description: string | null; depends_on: string[] }> =
        await em.query(
          `SELECT id, title, description, depends_on, metadata->'taskmaster'->>'tag' AS tag, metadata->'taskmaster'->>'id' AS tm_id
             FROM tasks WHERE app_id = $1 AND metadata ? 'taskmaster'`,
          [app.id],
        );
      const hubIdOf = new Map(existingRows.map((r) => [`${r.tag}:${r.tm_id}`, r.id]));
      const existingOf = new Map(existingRows.map((r) => [r.id, r]));

      // 이미 가져온 task 중 내용이 바뀐 것
      for (const { tag, tasks } of tagged) {
        for (const t of tasks) {
          const id = hubIdOf.get(`${tag}:${t.id}`);
          if (!id) continue;
          const cur = existingOf.get(id)!;
          const next = {
            title: t.title,
            description: composeDescription(t),
            dependsOn: (t.dependencies ?? []).map((d) => hubIdOf.get(`${tag}:${d}`)).filter((d): d is string => Boolean(d)),
          };
          const fields = [
            cur.title !== next.title ? 'title' : null,
            (cur.description ?? null) !== next.description ? 'description' : null,
            [...cur.depends_on].sort().join(',') !== [...next.dependsOn].sort().join(',') ? 'dependsOn' : null,
          ].filter((f): f is string => !!f);
          if (!fields.length) {
            result.preview.same += 1;
            continue;
          }
          result.preview.changed.push({ id, title: t.title, fields });
          if (update && !dryRun) {
            await em.query('UPDATE tasks SET title = $2, description = $3, depends_on = $4, updated_at = now() WHERE id = $1', [
              id, next.title, next.description, next.dependsOn,
            ]);
            result.updated += 1;
          }
        }
      }

      for (const { tag, tasks } of tagged) {
        const fresh = [...tasks]
          .sort((a, b) => Number(a.id) - Number(b.id))
          .filter((t) => !hubIdOf.has(`${tag}:${t.id}`));
        result.tags[tag] = { imported: fresh.length, skipped: tasks.length - fresh.length };
        result.imported += fresh.length;
        result.skipped += tasks.length - fresh.length;
        result.preview.add.push(...fresh.map((t) => ({ tag, tmId: String(t.id), title: t.title })));
        if (!fresh.length || dryRun) continue;

        const ids = await this.assignIds(em, app, fresh.map((t) => t.id));
        fresh.forEach((t, i) => hubIdOf.set(`${tag}:${t.id}`, ids[i]));

        const rows = fresh.map((t, i) =>
          em.create(Task, {
            id: ids[i],
            appId: app.id,
            title: t.title,
            description: composeDescription(t),
            status: mapTmStatus(t.status),
            tag,
            dependsOn: (t.dependencies ?? [])
              .map((d) => hubIdOf.get(`${tag}:${d}`))
              .filter((d): d is string => Boolean(d)),
            metadata: {
              taskmaster: { tag, id: String(t.id), status: t.status ?? null, priority: t.priority ?? null },
              ...(t.subtasks?.length ? { subtasks: t.subtasks } : {}),
            },
          }),
        );
        await em.save(Task, rows, { chunk: 100 });
      }
    });
    if (!dryRun && (result.imported || result.updated)) {
      await this.activities.record({
        appId: app.id, kind: 'tasks.imported', actor: 'me',
        summary: `Task Master에서 task ${result.imported}개 가져옴${result.updated ? `, ${result.updated}개 갱신` : ''}`,
        data: { imported: result.imported, updated: result.updated },
      });
    }
    if (dryRun) {
      result.imported = 0;
      result.tags = Object.fromEntries(Object.entries(result.tags).map(([k, v]) => [k, { imported: 0, skipped: v.skipped }]));
    }
    return result;
  }

  /**
   * 설명 속 "태스크 4" 같은 참조가 그대로 통하도록 가능하면 Task Master 번호를 그대로 쓴다(LK-4).
   * 이미 쓰인 번호(다른 태그 등)만 새 순번을 받고, 앱 순번은 쓴 번호 중 가장 큰 값 다음으로 올린다.
   */
  private async assignIds(em: EntityManager, app: App, tmIds: Array<number | string>): Promise<string[]> {
    const taken = new Set<string>(
      (await em.query('SELECT id FROM tasks WHERE app_id = $1', [app.id])).map((r: { id: string }) => r.id),
    );
    const ids: Array<string | null> = tmIds.map((tmId) => {
      const n = Number(tmId);
      const preferred = `${app.code}-${n}`;
      if (!Number.isInteger(n) || n < 1 || taken.has(preferred)) return null;
      taken.add(preferred);
      return preferred;
    });

    const maxUsed = Math.max(0, ...ids.filter(Boolean).map((id) => Number(id!.split('-')[1])));
    await em.query('UPDATE apps SET next_task_seq = GREATEST(next_task_seq, $2) WHERE id = $1', [app.id, maxUsed + 1]);

    const missing = ids.filter((id) => id === null).length;
    const fresh = missing ? await allocateTaskIds(em, app, missing) : [];
    return ids.map((id) => id ?? fresh.shift()!);
  }
}
