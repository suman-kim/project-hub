import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AppsService } from '../apps/apps.service';
import { ReposService } from '../repos/repos.service';
import { AppRepo } from '../repos/app-repo.entity';
import { run } from '../runner/git';
import { RunQueueService } from '../runner/run-queue.service';
import { TasksService } from '../tasks/tasks.service';
import { DeploymentsService } from './deployments.service';
import { deploymentStatusOf, envOf, guessDeployRule, versionOf, workflowStatusOf } from './github-map';

const SYNC_QUEUE = 'github-sync';
const FINAL = ['success', 'failure', 'cancelled', 'inactive'];

interface GhDeployment { id: number; environment: string; sha: string; created_at: string }
interface GhStatus { state: string; environment_url?: string; target_url?: string; created_at: string }
interface GhRun { id: number; name: string; status: string; conclusion: string | null; head_branch: string | null; head_sha: string; html_url: string; created_at: string; run_started_at?: string; updated_at: string; display_title?: string }

/**
 * GitHub에서 배포 상태를 가져온다. Hub는 맥북 안에서만 열려 있어 GitHub가 부를 수 없으므로 5분마다 묻는다.
 * - Railway·Vercel이 남긴 GitHub 배포 기록
 * - 저장소에 정한 배포 워크플로(GitHub Actions) 실행 결과
 * - 리뷰 중인 task의 PR이 머지되면 task를 done으로
 */
@Injectable()
export class GithubSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger('GithubSync');
  private running = false;

  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly apps: AppsService,
    private readonly repos: ReposService,
    private readonly tasks: TasksService,
    private readonly deployments: DeploymentsService,
    private readonly queue: RunQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.HUB_GITHUB_SYNC === '0') return;
    await this.queue.schedule(SYNC_QUEUE, '*/5 * * * *', {}, async () => {
      await this.syncAll();
    });
  }

  async syncAll(): Promise<{ deployments: number; merged: number }> {
    if (this.running) return { deployments: 0, merged: 0 };
    this.running = true;
    let deployments = 0;
    try {
      for (const app of await this.apps.list()) {
        for (const repo of await this.repos.list(app.id)) {
          if (!repo.github) continue;
          try {
            deployments += await this.syncRepo(app.code, repo);
          } catch (e) {
            this.logger.warn(`${repo.github} 배포 가져오기 실패: ${(e as Error).message}`);
          }
        }
      }
      return { deployments, merged: await this.syncMergedPrs() };
    } finally {
      this.running = false;
    }
  }

  /** 저장소 하나. 바뀐 배포 수를 돌려준다 */
  async syncRepo(appCode: string, repo: AppRepo): Promise<number> {
    const app = await this.apps.getByCode(appCode);
    let changed = 0;

    const list = await this.gh<GhDeployment[]>(`repos/${repo.github}/deployments?per_page=30`);
    for (const d of list) {
      const known = await this.deployments.findExternal('github_deployment', String(d.id));
      if (known && FINAL.includes(known.status)) continue;
      const [st] = await this.gh<GhStatus[]>(`repos/${repo.github}/deployments/${d.id}/statuses?per_page=1`);
      const status = deploymentStatusOf(st?.state);
      if (known?.status === status) continue;
      await this.deployments.upsertExternal(app, {
        repoId: repo.id, source: 'github_deployment', externalId: String(d.id), environment: d.environment, env: envOf(d.environment),
        status, version: d.sha.slice(0, 7), sha: d.sha, url: st?.environment_url || st?.target_url || null,
        startedAt: new Date(d.created_at), finishedAt: st && FINAL.includes(status) ? new Date(st.created_at) : null,
      });
      changed += 1;
    }

    // 배포 워크플로: 처음이면 이름으로 짐작해 저장소에 규칙을 남긴다(앱 설정에서 고칠 수 있다).
    let rules = repo.deployRules;
    if (!rules.length) {
      const wf = await this.gh<{ workflows: Array<{ name: string }> }>(`repos/${repo.github}/actions/workflows`);
      rules = wf.workflows.map((w) => ({ workflow: w.name, env: guessDeployRule(w.name) })).filter((r): r is { workflow: string; env: NonNullable<typeof r.env> } => !!r.env);
      if (rules.length) await this.repos.update(repo.id, { deployRules: rules });
    }
    if (rules.length) {
      const runs = await this.gh<{ workflow_runs: GhRun[] }>(`repos/${repo.github}/actions/runs?per_page=50`);
      for (const r of runs.workflow_runs) {
        const rule = rules.find((x) => x.workflow === r.name);
        if (!rule) continue;
        const status = workflowStatusOf(r.status, r.conclusion);
        const known = await this.deployments.findExternal('workflow_run', String(r.id));
        if (known?.status === status) continue;
        await this.deployments.upsertExternal(app, {
          repoId: repo.id, source: 'workflow_run', externalId: String(r.id), environment: r.name, env: rule.env, status,
          version: versionOf(r.head_branch, r.head_sha), sha: r.head_sha, url: r.html_url, notes: r.display_title?.slice(0, 200) ?? null,
          startedAt: new Date(r.run_started_at ?? r.created_at), finishedAt: r.status === 'completed' ? new Date(r.updated_at) : null,
        });
        changed += 1;
      }
    }
    return changed;
  }

  /** 리뷰 중인 task의 PR이 머지됐으면 done으로 바꾼다 (worktree도 정리된다) */
  private async syncMergedPrs(): Promise<number> {
    let merged = 0;
    for (const t of await this.tasks.list({ status: ['review'] })) {
      if (!t.prUrl) continue;
      try {
        const pr = JSON.parse(await run(this.config.runner.ghBin, ['pr', 'view', t.prUrl, '--json', 'state,mergedAt'], this.config.hubHome, 30_000)) as { state: string };
        if (pr.state !== 'MERGED') continue;
        await this.tasks.update(t.id, { status: 'done', note: `PR 머지됨: ${t.prUrl}` }, 'github');
        merged += 1;
      } catch (e) {
        this.logger.warn(`${t.id} PR 확인 실패: ${(e as Error).message}`);
      }
    }
    return merged;
  }

  private async gh<T>(path: string): Promise<T> {
    return JSON.parse(await run(this.config.runner.ghBin, ['api', path], this.config.hubHome, 30_000)) as T;
  }
}
