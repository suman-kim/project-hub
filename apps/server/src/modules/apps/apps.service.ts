import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { sep } from 'node:path';
import { Repository } from 'typeorm';
import type { ActivityActor, AppDto, AppLifecycle } from '@hub/shared';
import { ActivitiesService } from '../activities/activities.service';
import { HubEventsService } from '../realtime/hub-events.service';
import { App } from './app.entity';
import { CreateAppInput, UpdateAppInput } from './apps.schemas';

export function toAppDto(app: App): AppDto {
  return {
    id: app.id,
    code: app.code,
    name: app.name,
    repoPath: app.repoPath,
    defaultBranch: app.defaultBranch,
    folderNames: app.folderNames,
    setupCmd: app.setupCmd,
    ideaCron: app.ideaCron,
    guardEnabled: app.guardEnabled,
    directionNote: app.directionNote,
    allowedTools: app.allowedTools,
    checkCmd: app.checkCmd,
    worktreeRoot: app.worktreeRoot,
    nextTaskSeq: app.nextTaskSeq,
    description: app.description,
    links: app.links ?? {},
    stack: app.stack,
    stages: app.stages,
    stage: app.stage,
    lifecycle: app.lifecycle,
  };
}

export const LIFECYCLE_LABEL: Record<AppLifecycle, string> = { developing: '개발 중', operating: '운영 중', paused: '멈춤', archived: '보관' };

/**
 * 경로 조각을 뒤에서부터 보며 앱 폴더(repo_path)나 folder_names와 맞는 앱을 찾는다.
 * worktree(~/.hub/worktrees/<app>/<task>)나 저장소 안 하위 폴더에서도 찾을 수 있다.
 * 폴더 이름이 folder_names에 없어도 앱 폴더 안이면 그 앱이다.
 */
export function matchAppByPath<T extends Pick<App, 'folderNames'> & Partial<Pick<App, 'repoPath'>>>(apps: T[], cwd: string): T | null {
  const parts = cwd.split(sep).filter(Boolean);
  const trim = (p: string) => (p.length > 1 && p.endsWith(sep) ? p.slice(0, -1) : p);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const dir = sep + parts.slice(0, i + 1).join(sep);
    const found = apps.find((a) => a.repoPath && trim(a.repoPath) === dir) ?? apps.find((a) => a.folderNames.includes(parts[i]));
    if (found) return found;
  }
  return null;
}

@Injectable()
export class AppsService {
  constructor(
    @InjectRepository(App) private readonly repo: Repository<App>,
    private readonly events: HubEventsService,
    private readonly activities: ActivitiesService,
  ) {}

  list(): Promise<App[]> {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  async get(id: number): Promise<App> {
    const app = await this.repo.findOneBy({ id });
    if (!app) throw new NotFoundException(`앱 ${id}이 없다`);
    return app;
  }

  async getByCode(code: string): Promise<App> {
    const app = await this.repo.findOneBy({ code: code.toUpperCase() });
    if (!app) throw new NotFoundException(`앱 ${code}가 없다`);
    return app;
  }

  async create(input: CreateAppInput): Promise<App> {
    if (await this.repo.existsBy({ code: input.code })) throw new ConflictException(`앱 ${input.code}가 이미 있다`);
    if (input.stage && input.stages && !input.stages.some((s) => s.key === input.stage)) {
      throw new BadRequestException(`단계 ${input.stage}가 단계 목록에 없다`);
    }
    const app = await this.repo.save(this.repo.create({ ...input, folderNames: input.folderNames ?? [] }));
    this.events.emit('app.updated', { app: toAppDto(app) });
    await this.activities.record({ appId: app.id, kind: 'app.created', actor: 'me', summary: `앱 등록: ${app.code} ${app.name}` });
    return app;
  }

  /**
   * 단계 목록을 바꾸면 없어진 단계에 묶인 task는 "단계 없음"이 되고, 현재 단계가 없어지면 비운다.
   * 단계·진행 상태가 바뀌면 히스토리에 남긴다.
   */
  async update(id: number, input: UpdateAppInput, actor: ActivityActor = 'me'): Promise<App> {
    const app = await this.get(id);
    const before = { stage: app.stage, lifecycle: app.lifecycle, stages: app.stages };
    const stages = input.stages ?? app.stages;
    if (input.stage && !stages.some((s) => s.key === input.stage)) throw new BadRequestException(`단계 ${input.stage}가 단계 목록에 없다`);

    Object.assign(app, input);
    if (input.stages) {
      const keys = input.stages.map((s) => s.key);
      const removed = before.stages.map((s) => s.key).filter((k) => !keys.includes(k));
      if (removed.length) await this.repo.query('UPDATE tasks SET stage = NULL WHERE app_id = $1 AND stage = ANY($2)', [app.id, removed]);
      if (app.stage && !keys.includes(app.stage)) app.stage = null;
    }
    const saved = await this.repo.save(app);
    this.events.emit('app.updated', { app: toAppDto(saved) });

    const nameOf = (key: string | null, list = saved.stages) => (key ? (list.find((s) => s.key === key)?.name ?? key) : '없음');
    if (input.stages && JSON.stringify(input.stages) !== JSON.stringify(before.stages)) {
      await this.activities.record({
        appId: saved.id, kind: 'app.stages', actor,
        summary: `단계 목록 변경: ${saved.stages.map((s) => s.name).join(' → ')}`,
        data: { before: before.stages, after: saved.stages },
      });
    }
    if (saved.stage !== before.stage) {
      await this.activities.record({
        appId: saved.id, kind: 'app.stage', actor,
        summary: `단계 이동: ${nameOf(before.stage, before.stages)} → ${nameOf(saved.stage)}`,
        data: { from: before.stage, to: saved.stage },
      });
    }
    if (saved.lifecycle !== before.lifecycle) {
      await this.activities.record({
        appId: saved.id, kind: 'app.lifecycle', actor,
        summary: `진행 상태: ${LIFECYCLE_LABEL[before.lifecycle]} → ${LIFECYCLE_LABEL[saved.lifecycle]}`,
        data: { from: before.lifecycle, to: saved.lifecycle },
      });
    }
    return saved;
  }

  async findByCwd(cwd: string): Promise<App | null> {
    if (!cwd) return null;
    return matchAppByPath(await this.list(), cwd);
  }
}
