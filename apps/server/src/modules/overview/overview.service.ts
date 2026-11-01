import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { AppOverviewDto, AppSignals, AppStatusDto } from '@hub/shared';
import { DataSource } from 'typeorm';
import { HUB_TIMEZONE } from '../../config/hub-config';
import { ActivitiesService } from '../activities/activities.service';
import { App } from '../apps/app.entity';
import { AppsService, toAppDto } from '../apps/apps.service';
import { currentMonth } from '../costs/costs.service';
import { DeploymentsService, toDeploymentDto } from '../deployments/deployments.service';
import { ReposService, toRepoDto } from '../repos/repos.service';
import { run } from '../runner/git';
import { TasksService, toTaskDto } from '../tasks/tasks.service';
import { BgSessionsService } from './bg-sessions.service';
import { dotOf, nudgeOf, quietDaysOf } from './signals';

const OPEN = ['todo', 'doing', 'input', 'review'];

/** 앱 페이지 개요와 사이드바용 앱 상태 */
@Injectable()
export class OverviewService {
  private readonly commitCache = new Map<number, { at: number; value: Date | null }>();

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly apps: AppsService,
    private readonly tasks: TasksService,
    private readonly repos: ReposService,
    private readonly deployments: DeploymentsService,
    private readonly activities: ActivitiesService,
    private readonly sessions: BgSessionsService,
  ) {}

  async status(): Promise<AppStatusDto[]> {
    const apps = await this.apps.list();
    return Promise.all(apps.map(async (a) => ({ code: a.code, name: a.name, lifecycle: a.lifecycle, signals: await this.signals(a) })));
  }

  async overview(app: App): Promise<AppOverviewDto> {
    const [counts] = await this.ds.query(
      `SELECT
         count(*) FILTER (WHERE assignee = 'claude' AND type <> 'bug' AND status = ANY($2))::int AS tasks,
         count(*) FILTER (WHERE type = 'bug' AND status = ANY($2))::int AS bugs,
         count(*) FILTER (WHERE assignee = 'me' AND status = ANY($2))::int AS todos,
         count(*) FILTER (WHERE assignee = 'me' AND status = ANY($2) AND due_date < (now() AT TIME ZONE '${HUB_TIMEZONE}')::date)::int AS overdue
       FROM tasks WHERE app_id = $1`,
      [app.id, OPEN],
    );
    const [cost] = await this.ds.query(
      `SELECT COALESCE(sum(r.cost_usd), 0)::float8 AS usd FROM runs r LEFT JOIN tasks t ON t.id = r.task_id
       WHERE COALESCE(t.app_id, (r.result->'idea'->>'appId')::int, (r.result->'bootstrap'->>'appId')::int) = $1
         AND to_char(COALESCE(r.started_at, r.created_at) AT TIME ZONE '${HUB_TIMEZONE}', 'YYYY-MM') = $2`,
      [app.id, currentMonth()],
    );
    const nextTodos = (await this.tasks.list({ app: app.code, assignee: 'me', status: ['todo', 'doing'] }))
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.priority ?? 9) - (b.priority ?? 9))
      .slice(0, 3);
    return {
      app: toAppDto(app),
      repos: (await this.repos.list(app.id)).map((r) => toRepoDto(r, app.code)),
      signals: await this.signals(app),
      counts: { tasks: counts.tasks, bugs: counts.bugs, todos: counts.todos, overdueTodos: counts.overdue },
      costThisMonthUsd: Math.round(cost.usd * 10000) / 10000,
      latestDeployments: (await this.deployments.latest(app.id)).map((d) => toDeploymentDto(d, app.code)),
      recentActivities: await this.activities.list({ appId: app.id, limit: 5 }),
      nextTodos: nextTodos.map((t) => toTaskDto(t, app.code)),
    };
  }

  async signals(app: App): Promise<AppSignals> {
    const [r] = await this.ds.query(
      `SELECT
         count(*) FILTER (WHERE r.status = 'input')::int AS waiting,
         count(*) FILTER (WHERE r.status IN ('queued', 'running'))::int AS running,
         count(*) FILTER (WHERE r.status = 'failed' AND r.id = (SELECT max(r2.id) FROM runs r2 WHERE r2.task_id = r.task_id)
                           AND t.status NOT IN ('done', 'cancelled') AND r.ended_at > now() - interval '14 days')::int AS failed
       FROM runs r JOIN tasks t ON t.id = r.task_id WHERE t.app_id = $1`,
      [app.id],
    );
    const [bugs] = await this.ds.query(
      `SELECT count(*)::int AS open, count(*) FILTER (WHERE metadata->'bug'->>'severity' IN ('critical', 'high'))::int AS critical
       FROM tasks WHERE app_id = $1 AND type = 'bug' AND status = ANY($2)`,
      [app.id, OPEN],
    );
    const repos = await this.repos.list(app.id);
    const sessions = await this.sessions.under([app.repoPath ?? '', ...repos.map((x) => x.path)]);
    const lastAt = await this.lastActivityAt(app, repos.map((x) => x.path));
    const quietDays = quietDaysOf(lastAt);
    const stageIdx = app.stage ? app.stages.findIndex((s) => s.key === app.stage) : -1;

    const base: Omit<AppSignals, 'dot' | 'nudge'> = {
      deploy: (await this.deployments.latest(app.id))
        .filter((d) => d.env === 'production' || d.env === 'store' || d.env === 'staging')
        .map((d) => ({ repoName: d.repo?.name ?? null, env: d.env, status: d.status, version: d.version ?? d.sha?.slice(0, 7) ?? null, at: (d.finishedAt ?? d.startedAt)?.toISOString() ?? null })),
      blocked: {
        waitingRuns: r.waiting,
        failedRuns: r.failed,
        waitingSessions: sessions
          .filter((s) => s.status === 'waiting')
          .map((s) => ({ id: s.id ?? s.sessionId, name: s.name ?? s.sessionId, waitingFor: s.waitingFor ?? null })),
      },
      running: r.running,
      bugs: { open: bugs.open, critical: bugs.critical },
      activity: { lastAt: lastAt?.toISOString() ?? null, quietDays },
      stage: stageIdx >= 0 ? { key: app.stages[stageIdx].key, name: app.stages[stageIdx].name, index: stageIdx + 1, total: app.stages.length } : null,
    };
    return { ...base, dot: dotOf(base, app.lifecycle), nudge: nudgeOf(app.lifecycle, quietDays) };
  }

  /** 히스토리와 로컬 git 커밋 중 가장 최근 시각. git 확인은 1분 동안 기억한다 */
  private async lastActivityAt(app: App, repoPaths: string[]): Promise<Date | null> {
    // Hub가 저절로 남긴 기록(저장소·앱 등록)은 작업한 것이 아니라서 뺀다.
    const [a] = await this.ds.query(`SELECT max(at) AS at FROM activities WHERE app_id = $1 AND kind NOT IN ('repo.added', 'app.created')`, [app.id]);
    let commit = this.commitCache.get(app.id);
    if (!commit || Date.now() - commit.at > 60_000) {
      const times = await Promise.all(
        repoPaths.map((p) => run('git', ['log', '-1', '--format=%cI'], p, 10_000).then((t) => (t ? new Date(t) : null), () => null)),
      );
      const value = times.filter((t): t is Date => !!t).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
      commit = { at: Date.now(), value };
      this.commitCache.set(app.id, commit);
    }
    const candidates = [a?.at ? new Date(a.at) : null, commit.value].filter((t): t is Date => !!t);
    return candidates.sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  }
}
