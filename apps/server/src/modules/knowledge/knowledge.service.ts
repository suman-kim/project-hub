import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FindOptionsWhere, Repository } from 'typeorm';
import type { MistakeDto, SpecDto, SpecKind } from '@hub/shared';
import { AppsService } from '../apps/apps.service';
import { TasksService } from '../tasks/tasks.service';
import { Mistake } from './mistake.entity';
import { Spec } from './spec.entity';
import { renderSpecFile, SPEC_DIR, specFileName, specFilePrefix } from './spec-file';

export function toSpecDto(s: Spec): SpecDto {
  return {
    id: s.id,
    ideaId: s.ideaId,
    taskId: s.taskId,
    kind: s.kind,
    title: s.title,
    body: s.body,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toMistakeDto(m: Mistake, appCode: string): MistakeDto {
  return { id: m.id, appCode, what: m.what, correctWay: m.correctWay, active: m.active, createdAt: m.createdAt.toISOString() };
}

export interface SaveSpecInput {
  id?: number;
  taskId?: string | null;
  ideaId?: number | null;
  kind: SpecKind;
  title: string;
  body: string;
}

@Injectable()
export class KnowledgeService {
  private readonly log = new Logger(KnowledgeService.name);

  constructor(
    @InjectRepository(Mistake) private readonly mistakes: Repository<Mistake>,
    @InjectRepository(Spec) private readonly specs: Repository<Spec>,
    private readonly apps: AppsService,
    private readonly tasks: TasksService,
  ) {}

  async recordMistake(appCode: string, what: string, correctWay: string, sessionId: number | null = null): Promise<Mistake> {
    const app = await this.apps.getByCode(appCode);
    return this.mistakes.save(this.mistakes.create({ appId: app.id, what, correctWay, sessionId, active: true }));
  }

  listMistakes(appId: number): Promise<Mistake[]> {
    return this.mistakes.find({ where: { appId }, order: { id: 'DESC' } });
  }

  /** 끄면 새 세션 맥락에 넣지 않는다 */
  async setMistakeActive(id: number, active: boolean): Promise<Mistake> {
    const m = await this.mistakes.findOne({ where: { id }, relations: { app: true } });
    if (!m) throw new NotFoundException(`실수 기록 ${id}가 없다`);
    m.active = active;
    return this.mistakes.save(m);
  }

  activeMistakes(appId: number, limit = 5): Promise<Mistake[]> {
    return this.mistakes.find({ where: { appId, active: true }, order: { id: 'DESC' }, take: limit });
  }

  /** id가 있으면 그 문서를 고치고, 없으면 새로 만든다. task나 기획 중 하나에는 붙어 있어야 한다. */
  /** DB에 저장하고, 앱 폴더가 있으면 docs/hub/에도 md 사본을 쓴다 */
  async saveSpec(input: SaveSpecInput): Promise<Spec> {
    let saved: Spec;
    if (input.id) {
      const spec = await this.getSpec(input.id);
      Object.assign(spec, { kind: input.kind, title: input.title, body: input.body });
      saved = await this.specs.save(spec);
    } else {
      if (!input.taskId && !input.ideaId) throw new BadRequestException('task_id나 idea_id 중 하나는 있어야 한다');
      const taskId = input.taskId ? (await this.tasks.get(input.taskId)).id : null;
      saved = await this.specs.save(
        this.specs.create({ taskId, ideaId: input.ideaId ?? null, kind: input.kind, title: input.title, body: input.body }),
      );
    }
    await this.writeSpecFile(saved);
    return saved;
  }

  /**
   * 앱 폴더(repo_path)의 docs/hub/에 사본을 쓴다. 같은 번호의 예전 파일은 지운다.
   * 앱이 없는 문서(새 앱 기획)와 앱 폴더가 없는 앱은 건너뛴다. 실패해도 DB 저장은 그대로 둔다.
   */
  private async writeSpecFile(spec: Spec): Promise<void> {
    try {
      const appId = spec.taskId
        ? (await this.tasks.find(spec.taskId))?.appId
        : spec.ideaId
          ? ((await this.specs.query('SELECT app_id FROM ideas WHERE id = $1', [spec.ideaId])) as Array<{ app_id: number | null }>)[0]?.app_id
          : null;
      if (!appId) return;
      const app = await this.apps.get(appId);
      if (!app.repoPath || !existsSync(app.repoPath)) return;
      const dir = join(app.repoPath, ...SPEC_DIR);
      mkdirSync(dir, { recursive: true });
      const name = specFileName(spec.id, spec.title);
      for (const f of readdirSync(dir)) if (f !== name && f.startsWith(specFilePrefix(spec.id)) && f.endsWith('.md')) unlinkSync(join(dir, f));
      writeFileSync(join(dir, name), renderSpecFile(spec));
    } catch (e) {
      this.log.warn(`문서 #${spec.id}를 docs/hub/에 쓰지 못했다: ${(e as Error).message}`);
    }
  }

  async getSpec(id: number): Promise<Spec> {
    const spec = await this.specs.findOneBy({ id });
    if (!spec) throw new NotFoundException(`명세 ${id}가 없다`);
    return spec;
  }

  /** 화면의 문서 칸: task에 붙은 문서와 그 task를 만든 기획의 명세, 또는 기획의 문서. 본문까지 준다 */
  async specsFor(q: { taskId?: string; ideaId?: number }): Promise<Spec[]> {
    const where: FindOptionsWhere<Spec>[] = [];
    if (q.taskId) {
      const task = await this.tasks.get(q.taskId);
      where.push({ taskId: task.id });
      if (task.ideaId) where.push({ ideaId: task.ideaId, kind: 'spec' });
    }
    if (q.ideaId) where.push({ ideaId: q.ideaId });
    if (!where.length) throw new BadRequestException('task나 idea 중 하나는 있어야 한다');
    return this.specs.find({ where, order: { id: 'ASC' } });
  }

  /** task에 직접 붙은 문서와, task를 만든 기획의 명세를 함께 돌려준다. */
  specsForTask(taskId: string, ideaId: number | null): Promise<Spec[]> {
    const where: FindOptionsWhere<Spec>[] = [{ taskId }];
    if (ideaId) where.push({ ideaId, kind: 'spec' });
    return this.specs.find({ where, order: { id: 'ASC' }, select: { id: true, kind: true, title: true, taskId: true, ideaId: true, createdAt: true, updatedAt: true } });
  }
}
