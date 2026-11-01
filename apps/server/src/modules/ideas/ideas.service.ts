import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { canTransitionIdea, IdeaDto, IdeaEstimate, IdeaKind, IdeaStatus, IdeaVersionDto, TaskSize } from '@hub/shared';
import { ActivitiesService } from '../activities/activities.service';
import { App } from '../apps/app.entity';
import { AppsService } from '../apps/apps.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { HubEventsService } from '../realtime/hub-events.service';
import { Task } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { IdeaBody, IdeaVersion } from './idea-version.entity';
import { Idea } from './idea.entity';

export function toIdeaVersionDto(v: IdeaVersion): IdeaVersionDto {
  return { version: v.version, body: v.body, revisionNote: v.revisionNote, runId: v.runId, createdAt: v.createdAt.toISOString() };
}

export function toIdeaDto(idea: Idea, versions?: IdeaVersion[]): IdeaDto {
  return {
    id: idea.id,
    kind: idea.kind,
    appCode: idea.app?.code ?? null,
    title: idea.title,
    status: idea.status,
    currentVersion: idea.currentVersion,
    rejectReason: idea.rejectReason,
    createdAt: idea.createdAt.toISOString(),
    updatedAt: idea.updatedAt.toISOString(),
    ...(versions ? { versions: versions.map(toIdeaVersionDto) } : {}),
  };
}

/** 승인할 때 기획 명세(spec)로 저장하는 markdown. 새 앱 기획은 저장소의 docs/concept.md로도 쓴다. */
export function renderIdeaSpec(title: string, body: IdeaBody): string {
  const c = body.concept;
  const parts = [`# ${title}`];
  if (c) parts.push('', `> ${c.oneLiner}`, '', '## 대상 사용자', c.targetUsers);
  parts.push('', '## 문제', body.problem, '', c ? '## 해결 방식' : '## 제안', body.proposal);
  if (c?.mvpFeatures.length) parts.push('', '## MVP 핵심 기능', ...c.mvpFeatures.map((f) => `- ${f}`));
  if (body.scenarios?.length) parts.push('', '## 시나리오', ...body.scenarios.map((s) => `- ${s}`));
  if (body.spec) parts.push('', c ? '## MVP 명세' : '## 명세', body.spec);
  if (c) {
    if (c.competitors.length) {
      parts.push('', '## 비슷한 서비스', ...c.competitors.map((x) => `- ${x.url ? `[${x.name}](${x.url})` : x.name}: ${x.difference}`));
    }
    parts.push('', '## 시장', c.market, '', '## 수익 모델', c.monetization, '', '## 기술 스택', c.techStack);
    if (c.risks.length) parts.push('', '## 리스크', ...c.risks.map((r) => `- ${r}`));
    parts.push('', '## 수요 검증', c.validation);
  }
  if (body.impact) parts.push('', '## 영향 범위', body.impact);
  if (body.expectedTasks?.length) {
    parts.push('', '## 예상 task', ...body.expectedTasks.map((t) => `- ${t.title}${t.size ? ` (${t.size})` : ''}`));
  }
  if (c?.sources.length) parts.push('', '## 참고한 자료', ...c.sources.map((u) => `- ${u}`));
  return parts.join('\n');
}

/** 지난 실행이 크기별로 3건이 안 되면 쓰는 값: [분], [달러] (낮은~높은) */
const DEFAULT_COST: Record<TaskSize, { minutes: [number, number]; usd: [number, number] }> = {
  S: { minutes: [10, 30], usd: [0.3, 0.8] },
  M: { minutes: [30, 90], usd: [0.8, 2] },
  L: { minutes: [90, 240], usd: [2, 5] },
};

export function estimateLabel(minutes: [number, number], usd: [number, number]): string {
  const time = minutes[1] < 60 ? `${minutes[0]}~${minutes[1]}분` : `${Math.max(1, Math.round(minutes[0] / 60))}~${Math.max(1, Math.round(minutes[1] / 60))}시간`;
  const money = (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n)));
  return `러너 약 ${time} · 예상 $${money(usd[0])}~${money(usd[1])}`;
}

/** 생성 프롬프트에 넣을 최근 기획 요약 */
export interface RecentIdea {
  id: number;
  title: string;
  status: IdeaStatus;
  rejectReason: string | null;
}

@Injectable()
export class IdeasService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Idea) private readonly ideas: Repository<Idea>,
    @InjectRepository(IdeaVersion) private readonly versions: Repository<IdeaVersion>,
    private readonly apps: AppsService,
    private readonly tasks: TasksService,
    private readonly knowledge: KnowledgeService,
    private readonly events: HubEventsService,
    private readonly activities: ActivitiesService,
  ) {}

  /** 예상 task 크기마다 지난 implement run의 비용·시간(25~75 백분위)을 더해 범위를 낸다 */
  async estimate(body: IdeaBody): Promise<IdeaEstimate | undefined> {
    const sizes = (body.expectedTasks ?? []).map((t) => t.size ?? 'M');
    if (!sizes.length) return undefined;
    const rows: Array<{ size: TaskSize; n: number; c25: number; c75: number; m25: number; m75: number }> = await this.ds.query(
      `SELECT t.size, count(*)::int AS n,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY r.cost_usd)::float8 AS c25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY r.cost_usd)::float8 AS c75,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY extract(epoch FROM r.ended_at - r.started_at) / 60)::float8 AS m25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY extract(epoch FROM r.ended_at - r.started_at) / 60)::float8 AS m75
       FROM runs r JOIN tasks t ON t.id = r.task_id
       WHERE r.kind = 'implement' AND r.status = 'done' AND t.size IS NOT NULL AND r.ended_at IS NOT NULL
       GROUP BY t.size`,
    );
    let basis: IdeaEstimate['basis'] = 'history';
    const minutes: [number, number] = [0, 0];
    const usd: [number, number] = [0, 0];
    for (const size of sizes) {
      const h = rows.find((r) => r.size === size && r.n >= 3);
      const d = DEFAULT_COST[size];
      if (!h) basis = 'default';
      minutes[0] += h ? h.m25 : d.minutes[0];
      minutes[1] += h ? h.m75 : d.minutes[1];
      usd[0] += h ? h.c25 : d.usd[0];
      usd[1] += h ? h.c75 : d.usd[1];
    }
    const m: [number, number] = [Math.round(minutes[0]), Math.max(Math.round(minutes[1]), Math.round(minutes[0]) + 1)];
    const u: [number, number] = [Math.round(usd[0] * 100) / 100, Math.round(usd[1] * 100) / 100];
    return { label: estimateLabel(m, u), minutes: m, costUsd: u, basis };
  }

  list(query: { app?: string; status?: IdeaStatus[]; kind?: IdeaKind }): Promise<Idea[]> {
    const qb = this.ideas.createQueryBuilder('i').leftJoinAndSelect('i.app', 'app').orderBy('i.id', 'DESC');
    if (query.app) qb.andWhere('app.code = :code', { code: query.app.toUpperCase() });
    if (query.kind) qb.andWhere('i.kind = :kind', { kind: query.kind });
    if (query.status?.length) qb.andWhere('i.status IN (:...status)', { status: query.status });
    return qb.getMany();
  }

  async get(id: number): Promise<Idea> {
    const idea = await this.ideas.findOne({ where: { id }, relations: { app: true } });
    if (!idea) throw new NotFoundException(`기획 ${id}가 없다`);
    return idea;
  }

  listVersions(ideaId: number): Promise<IdeaVersion[]> {
    return this.versions.find({ where: { ideaId }, order: { version: 'DESC' } });
  }

  async currentVersion(idea: Idea): Promise<IdeaVersion> {
    const v = await this.versions.findOneBy({ ideaId: idea.id, version: idea.currentVersion });
    if (!v) throw new NotFoundException(`기획 ${idea.id}의 v${idea.currentVersion}이 없다`);
    return v;
  }

  /** 생성 프롬프트에 넣을 최근 기획. 반려 사유를 다음 생성에 반영하기 위해 쓴다. */
  async recent(appId: number, limit = 10): Promise<RecentIdea[]> {
    const rows = await this.ideas.find({ where: { appId, kind: 'feature' }, order: { id: 'DESC' }, take: limit });
    return rows.map((i) => ({ id: i.id, title: i.title, status: i.status, rejectReason: i.rejectReason }));
  }

  /** 새 앱 기획 생성 프롬프트에 넣을 최근 새 앱 기획 */
  async recentConcepts(limit = 10): Promise<RecentIdea[]> {
    const rows = await this.ideas.find({ where: { kind: 'app' }, order: { id: 'DESC' }, take: limit });
    return rows.map((i) => ({ id: i.id, title: i.title, status: i.status, rejectReason: i.rejectReason }));
  }

  /** 직접 연 세션의 submit_idea나 생성 run의 결과를 pending v1로 저장한다. */
  async submit(appCode: string, title: string, body: IdeaBody, runId: number | null = null): Promise<Idea> {
    const app = await this.apps.getByCode(appCode);
    return this.create('feature', app, title, body, runId);
  }

  /** 새 앱 기획. 앱은 승인할 때 만든다. */
  submitConcept(title: string, body: IdeaBody, runId: number | null = null): Promise<Idea> {
    return this.create('app', null, title, body, runId);
  }

  private async create(kind: IdeaKind, app: App | null, title: string, body: IdeaBody, runId: number | null): Promise<Idea> {
    const idea = await this.ds.transaction(async (em) => {
      const created = await em.save(Idea, em.create(Idea, { kind, appId: app?.id ?? null, title, status: 'pending', currentVersion: 1 }));
      await em.save(IdeaVersion, em.create(IdeaVersion, { ideaId: created.id, version: 1, body, runId }));
      return created;
    });
    this.events.emit('idea.created', { ideaId: idea.id, kind, appCode: app?.code ?? null, title });
    await this.activities.record({
      appId: app?.id ?? null, kind: 'idea.created', actor: runId ? 'hub' : 'claude', refType: 'idea', refId: String(idea.id),
      summary: `${kind === 'app' ? '새 앱 기획' : '기획'} #${idea.id} 생성: ${title}`, data: { kind },
    });
    return Object.assign(idea, { app });
  }

  /** 수정 요청: 다음 버전이 생길 때까지 revising */
  async markRevising(id: number): Promise<Idea> {
    return this.transition(await this.get(id), 'revising');
  }

  /** 수정 run이 실패하거나 중지되면 원래 버전 그대로 pending으로 돌린다. */
  async revisionFailed(id: number): Promise<void> {
    const idea = await this.get(id);
    if (idea.status === 'revising') await this.transition(idea, 'pending');
  }

  async addVersion(id: number, title: string, body: IdeaBody, revisionNote: string | null, runId: number | null): Promise<Idea> {
    const idea = await this.get(id);
    if (idea.status !== 'revising') throw new ConflictException(`기획 ${id}는 수정 중이 아니다 (${idea.status})`);
    const next = idea.currentVersion + 1;
    await this.ds.transaction(async (em) => {
      await em.save(IdeaVersion, em.create(IdeaVersion, { ideaId: id, version: next, body, revisionNote, runId }));
      await em.update(Idea, id, { currentVersion: next, title });
    });
    idea.currentVersion = next;
    idea.title = title;
    const saved = await this.transition(idea, 'pending');
    await this.activities.record({
      appId: idea.appId, kind: 'idea.revised', actor: 'hub', refType: 'idea', refId: String(id),
      summary: `기획 #${id} v${next}: ${title}${body.changeSummary ? ` — ${body.changeSummary}` : ''}`,
    });
    return saved;
  }

  /**
   * 승인: 현재 버전의 예상 task를 만들고, 기획 명세를 task들이 볼 수 있게 저장한다.
   * 새 앱 기획은 먼저 만든 앱(newApp)을 받아 그 앱의 기획으로 묶는다.
   */
  async approve(id: number, newApp?: App): Promise<{ idea: Idea & { app: App }; tasks: Task[] }> {
    const idea = await this.get(id);
    if (!canTransitionIdea(idea.status, 'approved')) throw new ConflictException(`기획 ${id}는 ${idea.status} 상태라 승인할 수 없다`);
    if (idea.kind === 'app') {
      if (!newApp) throw new BadRequestException(`기획 ${id}는 새 앱 기획이라 앱을 만들면서 승인해야 한다`);
      idea.appId = newApp.id;
      idea.app = newApp;
    }
    if (!idea.app) throw new ConflictException(`기획 ${id}에 앱이 없다`);
    const app = idea.app;
    const { body } = await this.currentVersion(idea);

    const expected = body.expectedTasks?.length ? body.expectedTasks : [{ title: idea.title, description: body.proposal }];
    const tasks = await this.tasks.createMany(
      app.code,
      expected.map((t, i) => ({
        title: t.title,
        description: [t.description?.trim(), `기획 #${idea.id} "${idea.title}"에서 나온 task.`].filter(Boolean).join('\n\n'),
        size: t.size ?? null,
        ideaId: idea.id,
        // 생성 결과의 순번이 어긋나도 승인이 막히지 않게 앞선 task만 남긴다.
        dependsOnIndex: (t.dependsOnIndex ?? []).filter((d) => d >= 0 && d < i),
      })),
    );
    await this.knowledge.saveSpec({ ideaId: idea.id, kind: 'spec', title: idea.title, body: renderIdeaSpec(idea.title, body) });
    const approved = Object.assign(await this.transition(idea, 'approved'), { app });
    await this.activities.record({
      appId: app.id, kind: 'idea.approved', actor: 'me', refType: 'idea', refId: String(idea.id),
      summary: `기획 #${idea.id} 승인: ${idea.title} → ${tasks.map((t) => t.id).join(', ')}`,
    });
    return { idea: approved, tasks };
  }

  async reject(id: number, reason: string): Promise<Idea> {
    const idea = await this.get(id);
    if (!reason.trim()) throw new BadRequestException('반려 사유가 필요하다');
    idea.rejectReason = reason;
    const saved = await this.transition(idea, 'rejected');
    await this.activities.record({
      appId: idea.appId, kind: 'idea.rejected', actor: 'me', refType: 'idea', refId: String(id), summary: `기획 #${id} 반려: ${idea.title} — ${reason}`,
    });
    return saved;
  }

  private async transition(idea: Idea, to: IdeaStatus): Promise<Idea> {
    if (!canTransitionIdea(idea.status, to)) throw new ConflictException(`기획 ${idea.id}를 ${idea.status}에서 ${to}로 바꿀 수 없다`);
    idea.status = to;
    const saved = await this.ideas.save(idea);
    this.events.emit('idea.updated', {
      ideaId: saved.id,
      kind: saved.kind,
      appCode: idea.app?.code ?? null,
      status: saved.status,
      currentVersion: saved.currentVersion,
    });
    return saved;
  }
}
