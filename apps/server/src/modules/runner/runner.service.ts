import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { In, MoreThan, Repository } from 'typeorm';
import { canTransitionRun, IdeaBody, RunKind, RunListItemDto, RunStatus, TaskStatus, UsageDto, UsageWindowDto } from '@hub/shared';
import { redactDeep, redactText } from '../../common/redact';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { App } from '../apps/app.entity';
import { AppsService } from '../apps/apps.service';
import { IdeasService } from '../ideas/ideas.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { HubEventsService } from '../realtime/hub-events.service';
import { SessionsService } from '../sessions/sessions.service';
import { ActivitiesService } from '../activities/activities.service';
import { ReposService } from '../repos/repos.service';
import { SettingsService } from '../settings/settings.service';
import { Task } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { AppOverrides, BootstrapService } from './bootstrap.service';
import { CLAUDE_EXECUTOR, ClaudeExecutor, Execution } from './claude-executor';
import { buildConceptPrompt, buildConceptRevisePrompt, CONCEPT_SCHEMA, ConceptPromptContext, parseConceptOutput } from './concept-gen';
import { CommandError, run as runCmd } from './git';
import { buildIdeaPrompt, buildRevisePrompt, IDEA_SCHEMA, IdeaPromptContext, parseIdeaOutput } from './idea-gen';
import { buildAnswerPrompt, buildTaskPrompt, RESULT_SCHEMA } from './prompt';
import { RunLog } from './run-log.entity';
import { RunJob, RunQueueService } from './run-queue.service';
import { resolveEnded, Run, RunResult, toRunDto } from './run.entity';
import { RepoTarget, WorktreeService } from './worktree.service';
import { judge, judgeProcess, ProcessOutcome, StreamEvent, toLogEntries, Verdict } from './stream-parser';

const ACTIVE: RunStatus[] = ['queued', 'running', 'input'];
/** 아이디어 생성은 저장소 원본에서 읽기만 한다. */
const IDEA_TOOLS = ['Read', 'Grep', 'Glob'];
/** 새 앱 기획은 내 앱 저장소를 읽고, 비슷한 서비스와 시장을 웹에서 조사한다. */
const CONCEPT_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];
/** 자동 생성을 멈추는 사용량 (5시간·7일 창 중 하나라도) */
const AUTO_USAGE_LIMIT = 0.8;

interface RateLimitWindow {
  utilization?: number;
  resetsAt?: number;
  status?: string;
}
type RateLimitInfo = { status?: string; resetsAt?: number; unifiedWindows?: Record<string, RateLimitWindow> };

/** 이미 초기화 시각이 지난 창은 보지 않는다. */
function isUsageHigh(info: RateLimitInfo | undefined, now: number): boolean {
  if (!info) return false;
  const live = (resetsAt?: number) => !resetsAt || resetsAt * 1000 > now;
  if (info.status && info.status !== 'allowed' && live(info.resetsAt)) return true;
  return Object.values(info.unifiedWindows ?? {}).some(
    (w) => live(w.resetsAt) && ((w.utilization ?? 0) >= AUTO_USAGE_LIMIT || (w.status !== undefined && w.status !== 'allowed')),
  );
}

/** 프로세스 한 번을 어디서 어떤 권한으로 돌릴지 */
interface ExecTarget {
  cwd: string;
  resumeSessionId: string | null;
  env: Record<string, string>;
  allowedTools: string[];
  permissionMode: 'acceptEdits' | 'dontAsk';
  jsonSchema: object | null;
  appId: number | null;
  taskId: string | null;
}

type ParsedIdea = { title: string; body: IdeaBody };

/** 기획 생성 run 한 번에 필요한 것. 기능 기획과 새 앱 기획이 실행 방식은 같고 입력과 출력만 다르다 */
interface IdeaGenJob {
  prompt: string;
  cwd: string;
  tools: string[];
  schema: object;
  appId: number | null;
  parse(structured: unknown): ParsedIdea | null;
  submit(parsed: ParsedIdea, runId: number): Promise<{ id: number; currentVersion: number; title: string }>;
}

/**
 * run 하나 = claude 프로세스 여러 번(최초 실행 + 답변마다 재개).
 * 세션 ID를 run에 저장해 두므로, 질문에 답하면 --resume으로 같은 대화가 이어진다.
 */
@Injectable()
export class RunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Runner');
  /** 지금 돌고 있는 claude 프로세스 (중지용) */
  private readonly executions = new Map<number, Execution>();
  private readonly stopRequested = new Set<number>();

  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    @InjectRepository(Run) private readonly runs: Repository<Run>,
    @InjectRepository(RunLog) private readonly logs: Repository<RunLog>,
    @Inject(CLAUDE_EXECUTOR) private readonly executor: ClaudeExecutor,
    private readonly queue: RunQueueService,
    private readonly worktrees: WorktreeService,
    private readonly apps: AppsService,
    private readonly tasks: TasksService,
    private readonly knowledge: KnowledgeService,
    private readonly ideas: IdeasService,
    private readonly sessions: SessionsService,
    private readonly settings: SettingsService,
    private readonly bootstrap: BootstrapService,
    private readonly repos: ReposService,
    private readonly activities: ActivitiesService,
    private readonly events: HubEventsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Hub가 꺼지면서 끊긴 run은 이어 갈 프로세스가 없으므로 실패로 정리한다.
    const orphaned = await this.runs.find({ where: { status: 'running' } });
    for (const r of orphaned) {
      await this.finish(r, 'failed', { failure: 'hub_restart', reason: 'Hub가 다시 시작되어 실행이 끊겼다' });
    }
    await this.queue.workRuns((job) => this.process(job));

    // 머지(done)되거나 취소된 task의 worktree는 바로 정리한다.
    this.events.on('task.updated', ({ task }) => {
      if (task.status === 'done' || task.status === 'cancelled') void this.cleanupWorktree(task.id);
    });
  }

  // ---- 입구에서 부르는 동작 ----

  async startTaskRun(taskId: string): Promise<Run> {
    const task = await this.tasks.get(taskId);
    if (!['todo', 'doing', 'input'].includes(task.status)) {
      throw new ConflictException(`task ${task.id}는 ${task.status} 상태라 실행할 수 없다`);
    }
    if (task.assignee === 'me') throw new ConflictException(`task ${task.id}는 내 할 일이라 실행하지 않는다`);
    const active = await this.runs.findOne({ where: { taskId: task.id, status: In(ACTIVE) } });
    if (active) throw new ConflictException(`task ${task.id}에 진행 중인 run ${active.id}가 있다`);
    // 저장소가 여러 개인 앱에서 task에 저장소가 없으면 여기서 409로 알려 준다.
    const repo = await this.repos.resolveFor(task.app, task.repoId);

    const run = await this.runs.save(
      this.runs.create({ taskId: task.id, kind: 'implement', status: 'queued', result: { repo: { id: repo.id, name: repo.name, path: repo.path } } }),
    );
    this.emitStatus(run);
    await this.queue.send({ runId: run.id, mode: 'start' });
    return run;
  }

  /**
   * 아이디어 생성 run. ideaId가 있으면 그 기획의 수정 요청(다음 버전)이다.
   * 같은 앱의 새 기획 생성이 이미 돌고 있으면 겹쳐 만들지 않는다.
   */
  async startIdeaGen(appId: number, opts: { ideaId?: number; note?: string; auto?: boolean } = {}): Promise<Run> {
    const app = await this.apps.get(appId);
    if (!app.repoPath) throw new ConflictException(`앱 ${app.code}에 repo_path가 없다`);

    if (opts.ideaId) {
      const idea = await this.ideas.get(opts.ideaId);
      if (idea.appId !== app.id) throw new ConflictException(`기획 ${idea.id}는 앱 ${app.code}의 기획이 아니다`);
      await this.ideas.markRevising(idea.id);
    } else {
      const busy = await this.runs
        .createQueryBuilder('r')
        .where("r.kind = 'idea_gen'")
        .andWhere('r.status IN (:...active)', { active: ACTIVE })
        .andWhere("(r.result->'idea'->>'appId')::int = :appId", { appId: app.id })
        .andWhere("r.result->'idea'->>'ideaId' IS NULL")
        .getOne();
      if (busy) throw new ConflictException(`앱 ${app.code}의 아이디어 생성 run ${busy.id}가 이미 진행 중이다`);
    }

    const run = await this.runs.save(
      this.runs.create({
        taskId: null,
        kind: 'idea_gen',
        status: 'queued',
        result: { idea: { kind: 'feature', appId: app.id, ideaId: opts.ideaId ?? null, note: opts.note ?? null, auto: opts.auto ?? false } },
      }),
    );
    this.emitStatus(run);
    await this.queue.send({ runId: run.id, mode: 'idea' });
    return run;
  }

  /**
   * 새 앱 기획 생성 run. ideaId가 있으면 그 기획의 수정 요청, seed가 있으면 다른 기획의 후보를 깊게 쓴다.
   * 새 기획 생성은 한 번에 하나만 돈다.
   */
  async startConceptGen(
    opts: { ideaId?: number; note?: string; seed?: { title: string; oneLiner: string; fromIdeaId?: number }; auto?: boolean } = {},
  ): Promise<Run> {
    if (opts.ideaId) {
      const idea = await this.ideas.get(opts.ideaId);
      if (idea.kind !== 'app') throw new ConflictException(`기획 ${idea.id}는 새 앱 기획이 아니다`);
      await this.ideas.markRevising(idea.id);
    } else {
      const busy = await this.runs
        .createQueryBuilder('r')
        .where("r.kind = 'idea_gen'")
        .andWhere('r.status IN (:...active)', { active: ACTIVE })
        .andWhere("r.result->'idea'->>'kind' = 'app'")
        .andWhere("r.result->'idea'->>'ideaId' IS NULL")
        .getOne();
      if (busy) throw new ConflictException(`새 앱 기획 생성 run ${busy.id}가 이미 진행 중이다`);
    }

    const run = await this.runs.save(
      this.runs.create({
        taskId: null,
        kind: 'idea_gen',
        status: 'queued',
        result: {
          idea: { kind: 'app', appId: null, ideaId: opts.ideaId ?? null, note: opts.note ?? null, seed: opts.seed ?? null, auto: opts.auto ?? false },
        },
      }),
    );
    this.emitStatus(run);
    await this.queue.send({ runId: run.id, mode: 'idea' });
    return run;
  }

  /** 새 앱 기획 승인: 앱 등록과 task 생성은 바로 하고, 폴더·저장소·세션은 bootstrap run이 한다. */
  async approveConcept(ideaId: number, overrides: AppOverrides = {}) {
    const prepared = await this.bootstrap.prepare(ideaId, overrides);
    const run = await this.queueBootstrap(prepared.app, prepared.idea.id);
    return { ...prepared, run };
  }

  /** 실패한 시작 단계를 다시 돌린다. 이미 끝난 단계는 건너뛴다. */
  async retryBootstrap(appId: number): Promise<Run> {
    const app = await this.apps.get(appId);
    const idea = (await this.ideas.list({ kind: 'app', status: ['approved'] })).find((i) => i.appId === app.id);
    if (!idea) throw new NotFoundException(`앱 ${app.code}를 만든 새 앱 기획이 없다`);
    return this.queueBootstrap(app, idea.id);
  }

  private async queueBootstrap(app: App, ideaId: number): Promise<Run> {
    const busy = await this.runs
      .createQueryBuilder('r')
      .where("r.kind = 'bootstrap'")
      .andWhere('r.status IN (:...active)', { active: ACTIVE })
      .andWhere("(r.result->'bootstrap'->>'appId')::int = :appId", { appId: app.id })
      .getOne();
    if (busy) throw new ConflictException(`앱 ${app.code}의 시작 run ${busy.id}가 이미 진행 중이다`);
    const run = await this.runs.save(
      this.runs.create({ taskId: null, kind: 'bootstrap', status: 'queued', result: { bootstrap: { ideaId, appId: app.id } } }),
    );
    this.emitStatus(run);
    await this.queue.send({ runId: run.id, mode: 'bootstrap' });
    return run;
  }

  /**
   * 마지막으로 받은 사용량(rate_limit_event)이 한도의 80%를 넘었는지. 자동 생성을 멈추는 데 쓴다.
   * 이미 초기화 시각이 지난 창은 보지 않는다.
   */
  async usageHigh(now = Date.now()): Promise<boolean> {
    const last = await this.lastRateLimitRun();
    return isUsageHigh(last?.result.rateLimit as RateLimitInfo | undefined, now);
  }

  /** 사이드바와 비용 화면의 사용량: 가장 최근 run이 받은 5시간·7일 창 */
  async usage(now = Date.now()): Promise<UsageDto> {
    const last = await this.lastRateLimitRun();
    const info = last?.result.rateLimit as RateLimitInfo | undefined;
    const window = (w?: RateLimitWindow): UsageWindowDto | null =>
      w ? { utilization: w.utilization ?? null, resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : null, status: w.status ?? null } : null;
    return {
      at: last ? (last.endedAt ?? last.startedAt ?? last.createdAt).toISOString() : null,
      runId: last?.id ?? null,
      fiveHour: window(info?.unifiedWindows?.five_hour),
      sevenDay: window(info?.unifiedWindows?.seven_day),
      limit: AUTO_USAGE_LIMIT,
      high: isUsageHigh(info, now),
    };
  }

  private lastRateLimitRun(): Promise<Run | null> {
    return this.runs.createQueryBuilder('r').where("r.result ? 'rateLimit'").orderBy('r.id', 'DESC').getOne();
  }

  /**
   * 전체 run 목록. 앱은 task의 앱, 기획 생성·시작 run은 result에 적힌 앱이다.
   * latest면 task마다 가장 최근 run만 남긴다. 실패·중지 run에는 다시 실행해 완료한 run(resolvedBy)을 붙인다.
   */
  async list(q: { status?: RunStatus[]; app?: string; kind?: RunKind; latest?: boolean; limit: number }): Promise<RunListItemDto[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const param = (v: unknown) => `$${params.push(v)}`;
    if (q.status?.length) where.push(`r.status = ANY(${param(q.status)})`);
    if (q.kind) where.push(`r.kind = ${param(q.kind)}`);
    if (q.app) where.push(`upper(a.code) = upper(${param(q.app)})`);
    if (q.latest) where.push('(r.task_id IS NULL OR r.id = (SELECT max(r2.id) FROM runs r2 WHERE r2.task_id = r.task_id))');
    const rows: Array<{ id: number; app_code: string | null; task_title: string | null; task_status: TaskStatus | null }> = await this.runs.query(
      `SELECT r.id, a.code AS app_code, t.title AS task_title, t.status AS task_status
       FROM runs r
       LEFT JOIN tasks t ON t.id = r.task_id
       LEFT JOIN apps a ON a.id = COALESCE(t.app_id, (r.result->'idea'->>'appId')::int, (r.result->'bootstrap'->>'appId')::int)
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.id DESC LIMIT ${param(q.limit)}`,
      params,
    );
    const runs = new Map((await this.runs.findBy({ id: In(rows.map((r) => r.id)) })).map((r) => [r.id, r]));
    const resolved = await this.resolvedBy([...runs.values()].filter((r) => r.status === 'failed' || r.status === 'stopped'));
    return rows.map((row) => ({
      ...toRunDto(runs.get(row.id)!),
      appCode: row.app_code,
      taskTitle: row.task_title,
      taskStatus: row.task_status,
      resolvedBy: resolved.get(row.id) ?? null,
    }));
  }

  /** 실패·중지 run 중 같은 대상을 다시 실행해 완료한 것 → 그 완료 run id */
  private async resolvedBy(ended: Run[]): Promise<Map<number, number>> {
    if (!ended.length) return new Map();
    const done = await this.runs.find({
      select: { id: true, taskId: true, kind: true, result: true },
      where: { status: 'done', id: MoreThan(Math.min(...ended.map((r) => r.id))) },
      order: { id: 'ASC' },
    });
    return resolveEnded(ended, done);
  }

  async answer(runId: number, answer: string): Promise<Run> {
    const run = await this.get(runId);
    if (run.status !== 'input') throw new ConflictException(`run ${run.id}는 답변을 기다리는 상태가 아니다 (${run.status})`);
    if (!run.claudeSessionId) throw new ConflictException(`run ${run.id}에 이어 갈 세션이 없다`);
    run.result = {
      ...run.result,
      question: undefined,
      answers: [...(run.result.answers ?? []), { ts: new Date().toISOString(), answer }],
    };
    await this.runs.save(run);
    await this.queue.send({ runId: run.id, mode: 'resume', answer });
    return run;
  }

  async stop(runId: number): Promise<Run> {
    const run = await this.get(runId);
    if (!ACTIVE.includes(run.status)) throw new ConflictException(`run ${run.id}는 이미 끝났다 (${run.status})`);
    const exec = this.executions.get(run.id);
    if (exec) {
      // 프로세스가 끝나면 process()가 stopped로 정리한다.
      this.stopRequested.add(run.id);
      exec.stop();
      return run;
    }
    // 큐에서 기다리거나 답변을 기다리는 중이면 바로 끝낸다. 큐의 작업은 꺼낼 때 건너뛴다.
    await this.finish(run, 'stopped', { reason: '사용자가 중지했다' });
    return run;
  }

  async get(runId: number): Promise<Run> {
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) throw new NotFoundException(`run ${runId}가 없다`);
    return run;
  }

  listForTask(taskId: string): Promise<Run[]> {
    return this.runs.find({ where: { taskId: taskId.toUpperCase() }, order: { id: 'DESC' } });
  }

  logsAfter(runId: number, after: number, limit = 500): Promise<RunLog[]> {
    return this.logs.find({ where: { runId, seq: MoreThan(after) }, order: { seq: 'ASC' }, take: limit });
  }

  async logsTail(runId: number, n: number): Promise<RunLog[]> {
    return (await this.logs.find({ where: { runId }, order: { seq: 'DESC' }, take: n })).reverse();
  }

  // ---- 큐 작업 ----

  async process(job: RunJob): Promise<void> {
    const run = await this.runs.findOneBy({ id: job.runId });
    // 기다리는 동안 중지된 run은 건너뛴다.
    if (!run || !(run.status === 'queued' || run.status === 'input')) return;
    if (run.kind === 'idea_gen') return this.processIdeaGen(run);
    if (run.kind === 'bootstrap') return this.processBootstrap(run);
    if (run.kind === 'session') return this.processSession(run);
    if (!run.taskId) return;

    const task = await this.tasks.get(run.taskId);
    const app = task.app;
    const log = this.logWriter(run);

    try {
      await this.setStatus(run, 'running');
      if (task.status === 'todo' || task.status === 'input') {
        await this.tasks.changeStatus(task.id, 'doing', job.mode === 'start' ? `run ${run.id} 시작` : `run ${run.id} 답변 받아 재개`);
      }

      let prompt: string;
      if (job.mode === 'start') {
        const target = await this.targetFor(run, task);
        const wt = await this.worktrees.ensure(app, target, task.id, task.title);
        run.worktreePath = wt.path;
        run.branch = wt.branch;
        await this.runs.save(run);
        if (task.branch !== wt.branch) await this.tasks.update(task.id, { branch: wt.branch }, 'hub');
        log.hub(`worktree ${wt.created ? '생성' : '재사용'}: ${wt.path} (${wt.branch}, 저장소 ${run.result.repo?.name ?? target.path})`);
        if (wt.created && target.setupCmd) {
          log.hub(`setup_cmd 실행: ${target.setupCmd}`);
          await this.worktrees.runShell('setup_cmd', target.setupCmd, wt.path, (line) => log.add('setup', line));
        }
        prompt = buildTaskPrompt({ task, app, branch: wt.branch, specs: await this.specsFor(task) });
      } else {
        log.hub('답변을 받아 같은 세션으로 재개');
        prompt = buildAnswerPrompt(job.answer ?? '');
      }

      const outcome = await this.executeOnce(
        run,
        prompt,
        {
          cwd: run.worktreePath!,
          resumeSessionId: job.mode === 'resume' ? run.claudeSessionId : null,
          env: { HUB_TASK_ID: task.id, HUB_RUN_ID: String(run.id) },
          allowedTools: app.allowedTools ?? this.config.runner.allowedTools,
          permissionMode: 'acceptEdits',
          jsonSchema: RESULT_SCHEMA,
          appId: app.id,
          taskId: task.id,
        },
        log,
      );
      await log.flush();
      await this.apply(run, task, app, judge(outcome), log);
    } catch (e) {
      const failure = e instanceof CommandError ? 'git' : 'process';
      this.logger.error(`run ${run.id}: ${(e as Error).stack ?? e}`);
      log.hub(`실패: ${(e as Error).message}`);
      await log.flush();
      await this.finish(run, 'failed', { failure, reason: (e as Error).message });
    } finally {
      await log.flush();
    }
  }

  /**
   * 세션 이어서 하기: 끝났거나 닫은 세션을 그 폴더에서 claude -p --resume으로 이어 받아 메시지 하나를 처리한다.
   * worktree·push·PR은 하지 않는다(그 세션이 하던 대로 폴더에서 일한다). 결과는 마지막 답변이다.
   */
  async startSessionRun(sessionId: number, opts: { message: string; taskId?: string | null; force?: boolean }): Promise<Run> {
    const [view] = await this.sessions.views({ sessionId });
    const session = await this.sessions.findById(sessionId);
    if (!view || !session) throw new NotFoundException(`세션 ${sessionId}이 없다`);
    if (!session.appId) throw new ConflictException('Hub에 등록된 앱의 세션만 이어서 할 수 있다');
    if (!existsSync(session.cwd)) throw new ConflictException(`세션 폴더 ${session.cwd}가 없다`);
    // 터미널에 열려 있는 세션을 이어 받으면 대화가 두 갈래로 나뉜다. 닫았다고 확인한 경우만 이어 받는다.
    if (view.open && view.state !== 'ended' && !opts.force) throw new ConflictException('아직 열려 있는 세션이다. 터미널을 닫았으면 force로 다시 요청한다');
    const busy = await this.runs
      .createQueryBuilder('r')
      .where(`r.kind = 'session' AND r.status IN (:...active) AND (r.result->'session'->>'sessionId')::int = :id`, { active: ACTIVE, id: session.id })
      .getOne();
    if (busy) throw new ConflictException(`이 세션을 이어서 하는 run ${busy.id}가 이미 있다`);

    const taskId = opts.taskId ?? session.taskId;
    if (!taskId) throw new BadRequestException('이어서 할 task를 고른다');
    const task = await this.tasks.get(taskId);
    if (task.appId !== session.appId) throw new BadRequestException(`task ${task.id}는 이 세션의 앱 task가 아니다`);
    if (!['todo', 'doing', 'input'].includes(task.status)) throw new ConflictException(`task ${task.id}는 ${task.status} 상태라 이어서 할 수 없다`);

    const run = await this.runs.save(
      this.runs.create({
        taskId: task.id,
        kind: 'session',
        status: 'queued',
        result: { session: { sessionId: session.id, claudeSessionId: session.claudeSessionId, appId: session.appId, cwd: session.cwd, message: opts.message } },
      }),
    );
    await this.sessions.linkTask(session.id, task.id);
    this.emitStatus(run);
    await this.queue.send({ runId: run.id, mode: 'resume' });
    return run;
  }

  async endSession(sessionId: number): Promise<{ stoppedRun: number | null; marked: boolean }> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new NotFoundException(`세션 ${sessionId}이 없다`);
    const run = session.runId ? await this.runs.findOneBy({ id: session.runId }) : null;
    if (run && ACTIVE.includes(run.status)) {
      await this.stop(run.id);
      return { stoppedRun: run.id, marked: false };
    }
    await this.sessions.markEnded(session);
    return { stoppedRun: null, marked: true };
  }

  private async processSession(run: Run): Promise<void> {
    const spec = run.result.session!;
    const log = this.logWriter(run);
    try {
      const task = await this.tasks.get(run.taskId!);
      const app = await this.apps.get(spec.appId);
      await this.setStatus(run, 'running');
      if (task.status !== 'doing') await this.tasks.changeStatus(task.id, 'doing', `run ${run.id}: 세션 이어서 하기`);
      log.hub(`세션 ${spec.claudeSessionId.slice(0, 8)} 이어서 하기 · ${spec.cwd}`);
      const outcome = await this.executeOnce(
        run,
        spec.message,
        {
          cwd: spec.cwd,
          resumeSessionId: spec.claudeSessionId,
          env: { HUB_TASK_ID: task.id, HUB_RUN_ID: String(run.id) },
          allowedTools: app.allowedTools ?? this.config.runner.allowedTools,
          permissionMode: 'acceptEdits',
          jsonSchema: null,
          appId: app.id,
          taskId: task.id,
        },
        log,
      );
      await log.flush();
      const pv = judgeProcess(outcome);
      if (pv.kind === 'stopped') return void (await this.finish(run, 'stopped', { reason: pv.reason }));
      if (pv.kind === 'failed') {
        log.hub(`실패: ${pv.reason}`);
        return void (await this.finish(run, 'failed', { failure: pv.failure, reason: pv.reason }));
      }
      const text = typeof outcome.result?.result === 'string' ? outcome.result.result : '';
      await this.finish(run, 'done', { output: { status: 'done', summary: text || '이어서 한 대화를 마쳤다' } });
    } catch (e) {
      this.logger.error(`run ${run.id}: ${(e as Error).stack ?? e}`);
      log.hub(`실패: ${(e as Error).message}`);
      await log.flush();
      await this.finish(run, 'failed', { failure: 'process', reason: (e as Error).message });
    } finally {
      await log.flush();
    }
  }

  /** 기획 생성·수정: 읽기 도구(새 앱 기획은 웹 조사 포함)만으로 돌리고, 결과를 기획 pending으로 저장한다. */
  private async processIdeaGen(run: Run): Promise<void> {
    const spec = run.result.idea!;
    const log = this.logWriter(run);
    try {
      await this.setStatus(run, 'running');
      const job = spec.kind === 'app' ? await this.conceptJob(spec, log) : await this.featureJob(spec, log);

      const outcome = await this.executeOnce(
        run,
        job.prompt,
        {
          cwd: job.cwd,
          resumeSessionId: null,
          env: { HUB_RUN_ID: String(run.id) },
          allowedTools: job.tools,
          permissionMode: 'dontAsk',
          jsonSchema: job.schema,
          appId: job.appId,
          taskId: null,
        },
        log,
      );
      await log.flush();

      const pv = judgeProcess(outcome);
      if (pv.kind === 'stopped') return void (await this.finish(run, 'stopped', { reason: pv.reason }));
      if (pv.kind === 'failed') {
        log.hub(`실패: ${pv.reason}`);
        return void (await this.finish(run, 'failed', { failure: pv.failure, reason: pv.reason }));
      }
      const parsed = job.parse(pv.structured);
      if (!parsed) {
        return void (await this.finish(run, 'failed', { failure: 'no_output', reason: '기획 JSON 스키마에 맞는 출력을 받지 못했다' }));
      }

      const idea = spec.ideaId
        ? await this.ideas.addVersion(spec.ideaId, parsed.title, parsed.body, spec.note ?? null, run.id)
        : await job.submit(parsed, run.id);
      log.hub(`기획 #${idea.id} v${idea.currentVersion}: ${idea.title}`);
      await this.finish(run, 'done', { idea: { ...spec, resultIdeaId: idea.id } });
    } catch (e) {
      this.logger.error(`run ${run.id}: ${(e as Error).stack ?? e}`);
      log.hub(`실패: ${(e as Error).message}`);
      await this.finish(run, 'failed', { failure: 'process', reason: (e as Error).message });
    } finally {
      await log.flush();
    }
  }

  /** 등록된 앱의 기능 기획: 저장소 원본에서 돈다. */
  private async featureJob(spec: NonNullable<RunResult['idea']>, log: LogWriter): Promise<IdeaGenJob> {
    const app = await this.apps.get(spec.appId!);
    const ctx: IdeaPromptContext = {
      app,
      openTasks: (await this.tasks.list({ app: app.code, status: ['todo', 'doing', 'input', 'review'] }, 30)).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
      recentIdeas: await this.ideas.recent(app.id, 10),
    };
    let prompt: string;
    if (spec.ideaId) {
      const idea = await this.ideas.get(spec.ideaId);
      const current = await this.ideas.currentVersion(idea);
      prompt = buildRevisePrompt(ctx, { id: idea.id, title: idea.title, version: current.version, body: current.body }, spec.note ?? '');
      log.hub(`기획 #${idea.id} v${current.version} 수정: ${spec.note ?? ''}`);
    } else {
      prompt = buildIdeaPrompt(ctx);
      log.hub(`${app.code} 아이디어 생성${spec.auto ? ' (자동)' : ''}`);
    }
    return {
      prompt,
      cwd: app.repoPath!,
      tools: IDEA_TOOLS,
      schema: IDEA_SCHEMA,
      appId: app.id,
      parse: parseIdeaOutput,
      submit: (p, runId) => this.ideas.submit(app.code, p.title, p.body, runId),
    };
  }

  /** 새 앱 기획: 저장소가 없으니 ~/.hub/ideation에서 돈다. */
  private async conceptJob(spec: NonNullable<RunResult['idea']>, log: LogWriter): Promise<IdeaGenJob> {
    const settings = await this.settings.ideation();
    const apps = await this.apps.list();
    let takenFolders: string[] = [];
    try {
      takenFolders = readdirSync(settings.projectRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch {
      // 폴더가 아직 없으면 겹칠 이름도 없다.
    }
    const ctx: ConceptPromptContext = {
      directionNote: settings.directionNote,
      note: spec.ideaId ? null : (spec.note ?? null),
      seed: spec.seed ?? null,
      myApps: apps.map((a) => ({ code: a.code, name: a.name, repoPath: a.repoPath, directionNote: a.directionNote })),
      takenFolders,
      recentConcepts: await this.ideas.recentConcepts(10),
    };
    let prompt: string;
    if (spec.ideaId) {
      const idea = await this.ideas.get(spec.ideaId);
      const current = await this.ideas.currentVersion(idea);
      prompt = buildConceptRevisePrompt(ctx, { id: idea.id, title: idea.title, version: current.version, body: current.body }, spec.note ?? '');
      log.hub(`새 앱 기획 #${idea.id} v${current.version} 수정: ${spec.note ?? ''}`);
    } else {
      prompt = buildConceptPrompt(ctx);
      log.hub(`새 앱 기획 생성${spec.seed ? `: 후보 "${spec.seed.title}"` : ''}${spec.auto ? ' (자동)' : ''}`);
    }
    const cwd = join(this.config.hubHome, 'ideation');
    mkdirSync(cwd, { recursive: true });
    return {
      prompt,
      cwd,
      tools: CONCEPT_TOOLS,
      schema: CONCEPT_SCHEMA,
      appId: null,
      parse: parseConceptOutput,
      // 어느 기획의 후보에서 왔는지, 생성할 때 덧붙인 요청을 기획에 같이 남긴다.
      submit: (p, runId) =>
        this.ideas.submitConcept(
          p.title,
          {
            ...p.body,
            concept: p.body.concept && {
              ...p.body.concept,
              ...(spec.seed?.fromIdeaId ? { sourceIdeaId: spec.seed.fromIdeaId } : {}),
              ...(spec.note ? { requestNote: spec.note } : {}),
            },
          },
          runId,
        ),
    };
  }

  /** 새 앱 시작: 폴더·저장소·세션. claude --rc를 못 띄우면 runner로 첫 task를 대신 시작한다. */
  private async processBootstrap(run: Run): Promise<void> {
    const spec = run.result.bootstrap!;
    const log = this.logWriter(run);
    try {
      await this.setStatus(run, 'running');
      const out = await this.bootstrap.execute(spec, run.id, log);
      let fallbackRunId: number | undefined;
      if (out.launched) {
        const first = await this.tasks.get(out.firstTaskId);
        if (first.status === 'todo') {
          await this.tasks.changeStatus(first.id, 'doing', `Remote Control 세션 "${out.rc!.name}"에서 시작 (run ${run.id}) · ${out.repoUrl}`);
        }
      } else {
        log.hub(`${out.reason} → runner로 ${out.firstTaskId}를 대신 시작한다`);
        fallbackRunId = (await this.startTaskRun(out.firstTaskId)).id;
        log.hub(`runner run ${fallbackRunId}`);
      }
      await this.finish(run, 'done', {
        bootstrap: { ...spec, repoUrl: out.repoUrl, firstTaskId: out.firstTaskId, rc: out.rc, fallbackRunId, fallbackReason: out.reason },
      });
    } catch (e) {
      const failure = e instanceof CommandError ? 'git' : 'process';
      this.logger.error(`run ${run.id}: ${(e as Error).stack ?? e}`);
      log.hub(`실패: ${(e as Error).message}`);
      await this.finish(run, 'failed', { failure, reason: (e as Error).message });
    } finally {
      await log.flush();
    }
  }

  private async executeOnce(run: Run, prompt: string, target: ExecTarget, log: LogWriter): Promise<ProcessOutcome> {
    const outcome: ProcessOutcome = { result: null, rateLimit: null, exitCode: null, stopped: false, stderr: '' };

    const exec = this.executor.execute({
      cwd: target.cwd,
      prompt,
      resumeSessionId: target.resumeSessionId,
      env: target.env,
      allowedTools: target.allowedTools,
      permissionMode: target.permissionMode,
      jsonSchema: target.jsonSchema,
      model: this.config.runner.model,
      onEvent: (ev: StreamEvent) => {
        log.raw(ev);
        if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id && ev.session_id !== run.claudeSessionId) {
          run.claudeSessionId = ev.session_id;
          log.task(() => this.runs.update(run.id, { claudeSessionId: ev.session_id }));
          log.task(() => this.sessions.linkRun(ev.session_id!, run.id, target.appId, target.taskId, target.cwd, run.kind === 'session'));
        }
        if (ev.type === 'rate_limit_event') outcome.rateLimit = ev.rate_limit_info as ProcessOutcome['rateLimit'];
        if (ev.type === 'result') outcome.result = ev;
        for (const entry of toLogEntries(ev)) log.add(entry.kind, entry.text, ev);
      },
      onStderr: (line) => {
        outcome.stderr += `${line}\n`;
        log.add('stderr', line);
      },
    });
    this.executions.set(run.id, exec);
    try {
      const { exitCode } = await exec.done;
      outcome.exitCode = exitCode;
    } finally {
      this.executions.delete(run.id);
    }
    outcome.stopped = this.stopRequested.delete(run.id);

    const cost = Number(outcome.result?.total_cost_usd ?? 0);
    if (cost) {
      run.costUsd = Number(run.costUsd) + cost;
      await this.runs.update(run.id, { costUsd: run.costUsd });
    }
    if (outcome.rateLimit) run.result = { ...run.result, rateLimit: outcome.rateLimit };
    return outcome;
  }

  /** 판정에 따라 run과 task 상태를 바꾼다. */
  private async apply(run: Run, task: Task, app: App, verdict: Verdict, log: LogWriter): Promise<void> {
    switch (verdict.kind) {
      case 'stopped':
        await this.finish(run, 'stopped', { reason: verdict.reason });
        return;
      case 'failed':
        log.hub(`실패: ${verdict.reason}`);
        await this.finish(run, 'failed', { failure: verdict.failure, reason: verdict.reason });
        return;
      case 'needs_input':
        run.result = { ...run.result, output: verdict.output, question: verdict.question };
        await this.setStatus(run, 'input');
        await this.tasks.changeStatus(task.id, 'input', `질문: ${verdict.question}`);
        log.hub(`답변 대기: ${verdict.question}`);
        return;
      case 'done':
        run.result = { ...run.result, output: verdict.output };
        await this.complete(run, task, app, verdict.output.summary, log);
    }
  }

  /** 완료: 커밋 확인 → push → PR → task를 review로 */
  private async complete(run: Run, task: Task, app: App, summary: string, log: LogWriter): Promise<void> {
    const path = run.worktreePath!;
    const { tracked, untracked } = await this.worktrees.uncommitted(path);
    if (tracked.length) {
      await this.finish(run, 'failed', { failure: 'no_commit', reason: `커밋하지 않은 변경이 worktree에 남아 있다: ${tracked.slice(0, 10).join(', ')}` });
      return;
    }
    if (untracked.length) log.hub(`추적하지 않는 파일은 PR에 넣지 않는다: ${untracked.slice(0, 10).join(', ')}`);
    const target = await this.targetFor(run, task);
    const commits = await this.worktrees.commitsAhead(path, target.defaultBranch);
    run.result = { ...run.result, commits };
    if (commits === 0) {
      await this.finish(run, 'failed', { failure: 'no_commit', reason: '완료라고 했지만 기준 브랜치 대비 커밋이 없다' });
      return;
    }

    // push 전 검사(화면의 "가드"). 실패하면 push와 PR을 하지 않는다.
    if (target.checkCmd) {
      log.hub(`push 전 검사: ${target.checkCmd}`);
      try {
        await this.worktrees.runShell('check_cmd', target.checkCmd, path, (line) => log.add('check', line));
      } catch (e) {
        await this.finish(run, 'failed', { failure: 'check', reason: `push 전 검사 실패: ${(e as Error).message}` });
        return;
      }
    }

    log.hub(`커밋 ${commits}개 push: ${run.branch}`);
    await this.worktrees.push(path, run.branch!);
    const prUrl = await this.createPr(run, task, target.defaultBranch, summary);
    log.hub(`PR: ${prUrl}`);

    await this.tasks.update(task.id, { status: 'review', prUrl, note: `PR 생성 (run ${run.id}): ${prUrl}\n${summary}` }, 'hub');
    await this.finish(run, 'done', {});
  }

  /** run을 돌릴 저장소. 큐에 넣을 때 정한 저장소를 쓰고, 예전 run이면 다시 정한다 */
  private async targetFor(run: Run, task: Task): Promise<RepoTarget> {
    const repo = run.result.repo ? await this.repos.get(run.result.repo.id) : await this.repos.resolveFor(task.app, task.repoId);
    return {
      path: repo.path,
      defaultBranch: repo.defaultBranch,
      setupCmd: repo.setupCmd ?? task.app.setupCmd,
      checkCmd: repo.checkCmd ?? task.app.checkCmd,
    };
  }

  private async createPr(run: Run, task: Task, baseBranch: string, summary: string): Promise<string> {
    const gh = this.config.runner.ghBin;
    const cwd = run.worktreePath!;
    const body = [
      `Hub task **${task.id}** ${task.title}`,
      '',
      '## 요약',
      summary,
      '',
      `run ${run.id} · 비용 $${Number(run.costUsd).toFixed(2)}`,
      '',
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    ].join('\n');
    try {
      const out = await runCmd(
        gh,
        ['pr', 'create', '--base', baseBranch, '--head', run.branch!, '--title', `${task.id}: ${task.title}`, '--body', body],
        cwd,
      );
      return out.split('\n').filter(Boolean).pop()!;
    } catch (e) {
      // 같은 브랜치로 이미 PR이 있으면(실패 뒤 다시 돌린 경우) 그 PR을 쓴다.
      if (/already exists/i.test((e as Error).message)) {
        return runCmd(gh, ['pr', 'view', run.branch!, '--json', 'url', '-q', '.url'], cwd);
      }
      throw e;
    }
  }

  private async specsFor(task: Task): Promise<Array<{ kind: string; title: string; body: string }>> {
    const list = await this.knowledge.specsForTask(task.id, task.ideaId);
    return Promise.all(list.map(async (s) => this.knowledge.getSpec(s.id)));
  }

  private async cleanupWorktree(taskId: string): Promise<void> {
    try {
      const last = await this.runs.findOne({ where: { taskId }, order: { id: 'DESC' } });
      if (!last?.worktreePath || ACTIVE.includes(last.status)) return;
      const task = await this.tasks.find(taskId);
      if (!task) return;
      const repoPath = last.result.repo?.path ?? task.app.repoPath;
      if (!repoPath) return;
      await this.worktrees.remove(repoPath, last.worktreePath);
      this.logger.log(`worktree 정리: ${last.worktreePath}`);
    } catch (e) {
      this.logger.warn(`worktree 정리 실패 (${taskId}): ${(e as Error).message}`);
    }
  }

  // ---- 상태 ----

  private async setStatus(run: Run, to: RunStatus): Promise<void> {
    if (!canTransitionRun(run.status, to)) throw new ConflictException(`run ${run.id}를 ${run.status}에서 ${to}로 바꿀 수 없다`);
    run.status = to;
    if (to === 'running' && !run.startedAt) run.startedAt = new Date();
    await this.runs.save(run);
    this.emitStatus(run);
  }

  /** failed, stopped면 task는 doing에 남기고 사유를 메모로 붙인다. */
  private async finish(run: Run, to: 'done' | 'failed' | 'stopped', result: Partial<RunResult>): Promise<void> {
    const fresh = await this.get(run.id);
    run.status = fresh.status;
    run.result = { ...run.result, ...result };
    if (!canTransitionRun(run.status, to)) return;
    run.status = to;
    run.endedAt = new Date();
    await this.runs.save(run);
    this.emitStatus(run, result.reason);
    await this.recordRunActivity(run);

    // 수정 run이 끝까지 가지 못하면 기획을 원래 버전 그대로 pending으로 돌린다.
    if (to !== 'done' && run.kind === 'idea_gen' && run.result.idea?.ideaId) {
      await this.ideas.revisionFailed(run.result.idea.ideaId);
    }

    if (to !== 'done' && run.taskId) {
      const task = await this.tasks.find(run.taskId);
      if (task && (task.status === 'doing' || task.status === 'input')) {
        await this.tasks.update(
          task.id,
          {
            status: task.status === 'input' ? 'doing' : undefined,
            note: `run ${run.id} ${to === 'failed' ? '실패' : '중지'}: ${result.reason ?? ''}`,
          },
          'hub',
        );
      }
    }
  }

  /** 끝난 run을 히스토리에 남긴다 */
  private async recordRunActivity(run: Run): Promise<void> {
    const appId = run.taskId
      ? ((await this.tasks.find(run.taskId))?.appId ?? null)
      : (run.result.idea?.appId ?? run.result.bootstrap?.appId ?? null);
    const kindLabel = run.kind === 'implement' ? '구현' : run.kind === 'bootstrap' ? '새 앱 시작' : run.result.idea?.kind === 'app' ? '새 앱 기획 생성' : '기획 생성';
    const statusLabel = run.status === 'done' ? '완료' : run.status === 'failed' ? '실패' : '중지';
    await this.activities.record({
      appId, kind: 'run.finished', actor: 'hub', refType: 'run', refId: String(run.id),
      summary: `run ${run.id} ${kindLabel} ${statusLabel}${run.taskId ? ` (${run.taskId})` : ''}${Number(run.costUsd) ? ` · $${Number(run.costUsd).toFixed(2)}` : ''}${run.status !== 'done' && run.result.reason ? `: ${run.result.reason}` : ''}`,
      data: { status: run.status, kind: run.kind, costUsd: Number(run.costUsd), taskId: run.taskId },
    });
  }

  private emitStatus(run: Run, reason?: string): void {
    this.events.emit('run.status', { runId: run.id, taskId: run.taskId, status: run.status, ...(reason ? { reason } : {}) });
  }

  // ---- 로그 ----

  /** run_logs에 순서대로 쓰고, 원본은 ~/.hub/logs/run-<id>.jsonl에도 남긴다. */
  private logWriter(run: Run): LogWriter {
    const logsDir = join(this.config.hubHome, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const rawFile = join(logsDir, `run-${run.id}.jsonl`);
    let chain: Promise<unknown> = this.logs.maximum('seq', { runId: run.id }).then((max) => (seq = max ?? 0));
    let seq = 0;

    const enqueue = (fn: () => Promise<unknown>) => {
      chain = chain.then(fn).catch((e) => this.logger.error(`run ${run.id} 로그 저장 실패: ${(e as Error).message}`));
    };

    const writer: LogWriter = {
      add: (kind, text, raw) =>
        enqueue(async () => {
          seq += 1;
          const entry = { runId: run.id, seq, ts: new Date(), kind, text: redactText(text), raw: raw ? (redactDeep(raw) as Record<string, any>) : null };
          await this.logs.insert(entry);
          this.events.emit('run.log', { runId: run.id, seq, ts: entry.ts.toISOString(), kind, text: entry.text });
        }),
      hub: (text) => writer.add('hub', text),
      raw: (ev) => {
        try {
          appendFileSync(rawFile, `${JSON.stringify(redactDeep(ev))}\n`);
        } catch {
          // 원본 파일은 보조 기록이라 실패해도 run을 멈추지 않는다.
        }
      },
      task: (fn) => enqueue(fn),
      flush: async () => {
        await chain;
      },
    };
    return writer;
  }
}

export interface LogWriter {
  add(kind: string, text: string, raw?: StreamEvent): void;
  hub(text: string): void;
  raw(ev: StreamEvent): void;
  /** 로그와 같은 순서로 처리할 DB 작업 */
  task(fn: () => Promise<unknown>): void;
  flush(): Promise<void>;
}
