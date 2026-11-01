import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ActivityActor, BugInfo, canTransitionTask, TaskDto, TaskNote, TaskStatus } from '@hub/shared';
import { ActivitiesService } from '../activities/activities.service';
import { App } from '../apps/app.entity';
import { AppsService } from '../apps/apps.service';
import { HubEventsService } from '../realtime/hub-events.service';
import { Task } from './task.entity';
import { ListTasksQuery, NewTaskInput, UpdateTaskInput } from './tasks.schemas';

export function toTaskDto(task: Task, appCode: string): TaskDto {
  return {
    id: task.id,
    appCode,
    ideaId: task.ideaId,
    title: task.title,
    description: task.description,
    status: task.status,
    type: task.type,
    assignee: task.assignee,
    priority: task.priority,
    dueDate: task.dueDate,
    stage: task.stage,
    repoId: task.repoId,
    size: task.size,
    tag: task.tag,
    dependsOn: task.dependsOn,
    branch: task.branch,
    prUrl: task.prUrl,
    metadata: task.metadata,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '할 일',
  doing: '진행 중',
  input: '답변 대기',
  review: '리뷰',
  done: '완료',
  cancelled: '취소',
};

/** 히스토리에 남길 task 생성 문장 */
function createdSummary(t: Task): string {
  if (t.type === 'bug') return `버그 등록: ${t.id} ${t.title}`;
  if (t.assignee === 'me') return `할 일 추가: ${t.id} ${t.title}`;
  return `${t.id} 생성: ${t.title}`;
}

export function appCodeOf(taskId: string): string {
  return taskId.split('-')[0];
}

/** 앱의 순번을 count개 한 번에 잡는다. UPDATE ... RETURNING 한 문장이라 동시에 불려도 겹치지 않는다. */
export async function allocateTaskIds(em: EntityManager, app: App, count: number): Promise<string[]> {
  // postgres 드라이버는 UPDATE ... RETURNING 결과를 [rows, affected]로 돌려준다.
  const [rows]: [Array<{ next_task_seq: number }>, number] = await em.query(
    'UPDATE apps SET next_task_seq = next_task_seq + $2 WHERE id = $1 RETURNING next_task_seq',
    [app.id, count],
  );
  const end = rows[0].next_task_seq;
  return Array.from({ length: count }, (_, i) => `${app.code}-${end - count + i}`);
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly apps: AppsService,
    private readonly events: HubEventsService,
    private readonly activities: ActivitiesService,
  ) {}

  async list(query: ListTasksQuery, limit?: number): Promise<Task[]> {
    const qb = this.repo.createQueryBuilder('t').leftJoinAndSelect('t.app', 'app');
    if (query.app) qb.andWhere('app.code = :code', { code: query.app.toUpperCase() });
    if (query.status?.length) qb.andWhere('t.status IN (:...status)', { status: query.status });
    if (query.type) qb.andWhere('t.type = :type', { type: query.type });
    if (query.assignee) qb.andWhere('t.assignee = :assignee', { assignee: query.assignee });
    if (query.stage) qb.andWhere('t.stage = :stage', { stage: query.stage });
    if (query.repoId) qb.andWhere('t.repo_id = :repoId', { repoId: query.repoId });
    qb.orderBy('t.app_id', 'ASC').addOrderBy("CAST(split_part(t.id, '-', 2) AS int)", 'ASC');
    // app은 다대일 조인이라 행이 늘지 않으므로 take 대신 limit을 쓴다 (take는 식 ORDER BY와 함께 쓰면 깨진다).
    if (limit) qb.limit(limit);
    return qb.getMany();
  }

  /** 세션 맥락용 열린 task. 진행 중인 것을 먼저 보여 준다. */
  openForContext(appId: number, excludeId: string | null, limit = 5): Promise<Task[]> {
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.app_id = :appId', { appId })
      .andWhere("t.status IN ('doing', 'input', 'review', 'todo')");
    if (excludeId) qb.andWhere('t.id <> :excludeId', { excludeId });
    return qb
      .orderBy("CASE t.status WHEN 'doing' THEN 0 WHEN 'input' THEN 1 WHEN 'review' THEN 2 ELSE 3 END", 'ASC')
      .addOrderBy("CAST(split_part(t.id, '-', 2) AS int)", 'ASC')
      .limit(limit)
      .getMany();
  }

  async get(id: string): Promise<Task> {
    const task = await this.repo.findOne({ where: { id: id.toUpperCase() }, relations: { app: true } });
    if (!task) throw new NotFoundException(`task ${id}가 없다`);
    return task;
  }

  async find(id: string): Promise<Task | null> {
    return this.repo.findOne({ where: { id: id.toUpperCase() }, relations: { app: true } });
  }

  /** 여러 task를 한 트랜잭션으로 만든다. dependsOnIndex로 같은 묶음 안의 앞선 task를 가리킬 수 있다. */
  async createMany(appCode: string, items: NewTaskInput[], actor: ActivityActor = 'me'): Promise<Task[]> {
    if (!items.length) throw new BadRequestException('만들 task가 없다');
    const app = await this.apps.getByCode(appCode);
    for (const item of items) await this.checkPlanning(app, item);

    const referenced = [...new Set(items.flatMap((i) => i.dependsOn ?? []).map((d) => d.toUpperCase()))];
    if (referenced.length) {
      const found = await this.repo.find({ where: { id: In(referenced) }, select: { id: true } });
      const missing = referenced.filter((r) => !found.some((f) => f.id === r));
      if (missing.length) throw new BadRequestException(`없는 task를 의존한다: ${missing.join(', ')}`);
    }
    items.forEach((item, i) => {
      for (const idx of item.dependsOnIndex ?? []) {
        if (idx >= i) throw new BadRequestException(`${i}번 task의 dependsOnIndex ${idx}는 앞선 task가 아니다`);
      }
    });

    const saved = await this.ds.transaction(async (em) => {
      const ids = await allocateTaskIds(em, app, items.length);
      const rows = items.map((item, i) =>
        em.create(Task, {
          id: ids[i],
          appId: app.id,
          ideaId: item.ideaId ?? null,
          title: item.title,
          description: item.description ?? null,
          status: 'todo',
          type: item.type ?? 'feature',
          assignee: item.assignee ?? 'claude',
          priority: item.priority ?? null,
          dueDate: item.dueDate ?? null,
          stage: item.stage ?? null,
          repoId: item.repoId ?? null,
          size: item.size ?? null,
          tag: item.tag ?? null,
          dependsOn: [
            ...(item.dependsOn ?? []).map((d) => d.toUpperCase()),
            ...(item.dependsOnIndex ?? []).map((idx) => ids[idx]),
          ],
          metadata: item.bug ? { bug: item.bug } : {},
        }),
      );
      return em.save(Task, rows);
    });
    const created = saved.map((t) => Object.assign(t, { app }));
    for (const t of created) {
      this.events.emit('task.updated', { task: toTaskDto(t, app.code) });
      await this.activities.record({
        appId: app.id, kind: 'task.created', actor, refType: 'task', refId: t.id, summary: createdSummary(t),
        data: { type: t.type, assignee: t.assignee, ...(t.type === 'bug' ? { severity: (t.metadata.bug as BugInfo | undefined)?.severity } : {}) },
      });
    }
    return created;
  }

  /** 저장소는 같은 앱의 것이어야 하고, 단계는 앱의 단계 목록에 있어야 한다 */
  private async checkPlanning(app: App, f: { repoId?: number | null; stage?: string | null }): Promise<void> {
    if (f.stage && !app.stages.some((s) => s.key === f.stage)) {
      throw new BadRequestException(`단계 ${f.stage}가 앱 ${app.code}의 단계 목록에 없다 (${app.stages.map((s) => s.key).join(', ')})`);
    }
    if (f.repoId) {
      const rows: Array<{ app_id: number }> = await this.repo.query('SELECT app_id FROM app_repos WHERE id = $1', [f.repoId]);
      if (!rows.length || rows[0].app_id !== app.id) throw new BadRequestException(`저장소 ${f.repoId}는 앱 ${app.code}의 저장소가 아니다`);
    }
  }

  async update(id: string, input: UpdateTaskInput, actor: ActivityActor = 'me'): Promise<Task> {
    const task = await this.get(id);
    const { status, note, bug, ...fields } = input;
    await this.checkPlanning(task.app, fields);
    const from = task.status;

    if (fields.dependsOn) {
      fields.dependsOn = fields.dependsOn.map((d) => d.toUpperCase());
      if (fields.dependsOn.includes(task.id)) throw new BadRequestException('자기 자신을 의존할 수 없다');
      const found = await this.repo.countBy({ id: In(fields.dependsOn) });
      if (found !== new Set(fields.dependsOn).size) throw new BadRequestException('없는 task를 의존한다');
    }
    Object.assign(task, fields);
    if (bug) task.metadata = { ...task.metadata, bug: { ...((task.metadata.bug as BugInfo | undefined) ?? {}), ...bug } };

    if (status) this.applyStatus(task, status);
    if (note) this.addNote(task, note);
    const saved = await this.repo.save(task);
    this.events.emit('task.updated', { task: toTaskDto(saved, saved.app.code) });

    if (saved.status !== from) {
      const solved = saved.type === 'bug' && saved.status === 'done';
      await this.activities.record({
        appId: saved.appId, kind: 'task.status', actor, refType: 'task', refId: saved.id,
        summary: solved
          ? `버그 해결: ${saved.id} ${saved.title}`
          : `${saved.id} ${TASK_STATUS_LABEL[from]} → ${TASK_STATUS_LABEL[saved.status]}${note ? `: ${note}` : ''}`,
        data: { from, to: saved.status, type: saved.type },
      });
    } else if (note) {
      await this.activities.record({ appId: saved.appId, kind: 'task.note', actor, refType: 'task', refId: saved.id, summary: `${saved.id} 메모: ${note}` });
    }
    return saved;
  }

  changeStatus(id: string, status: TaskStatus, note?: string, actor: ActivityActor = 'hub'): Promise<Task> {
    return this.update(id, { status, note }, actor);
  }

  private applyStatus(task: Task, to: TaskStatus): void {
    if (!canTransitionTask(task.status, to, task.assignee)) {
      throw new ConflictException(`task ${task.id}를 ${task.status}에서 ${to}로 바꿀 수 없다`);
    }
    task.status = to;
  }

  private addNote(task: Task, note: string): void {
    const notes = Array.isArray(task.metadata.notes) ? (task.metadata.notes as TaskNote[]) : [];
    task.metadata = { ...task.metadata, notes: [...notes, { ts: new Date().toISOString(), status: task.status, note }] };
  }
}
