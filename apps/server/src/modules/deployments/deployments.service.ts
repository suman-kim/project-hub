import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { ActivityActor, DeployEnv, DeploymentDto, DeploySource, DeployStatus } from '@hub/shared';
import { Repository } from 'typeorm';
import { ActivitiesService } from '../activities/activities.service';
import { App } from '../apps/app.entity';
import { HubEventsService } from '../realtime/hub-events.service';
import { Deployment } from './deployment.entity';

export const DEPLOY_ENV_LABEL: Record<DeployEnv, string> = {
  production: '운영',
  staging: '스테이징',
  development: '개발',
  preview: '미리보기',
  store: '스토어',
};
export const DEPLOY_STATUS_LABEL: Record<DeployStatus, string> = {
  queued: '대기',
  in_progress: '진행 중',
  success: '성공',
  failure: '실패',
  cancelled: '취소',
  // Railway·Vercel은 새 배포가 나오면 예전 배포를 inactive로 바꾼다.
  inactive: '교체됨',
};

export function toDeploymentDto(d: Deployment, appCode: string): DeploymentDto {
  return {
    id: d.id,
    appCode,
    repoId: d.repoId,
    repoName: d.repo?.name ?? null,
    source: d.source,
    externalId: d.externalId,
    environment: d.environment,
    env: d.env,
    version: d.version,
    sha: d.sha,
    status: d.status,
    url: d.url,
    notes: d.notes,
    startedAt: d.startedAt?.toISOString() ?? null,
    finishedAt: d.finishedAt?.toISOString() ?? null,
  };
}

export interface DeployInput {
  env: DeployEnv;
  status: DeployStatus;
  environment?: string;
  version?: string | null;
  sha?: string | null;
  url?: string | null;
  notes?: string | null;
  repoId?: number | null;
}

/** 배포 기록. GitHub에서 가져온 것과 직접 남긴 것을 같은 곳에 둔다 */
@Injectable()
export class DeploymentsService {
  constructor(
    @InjectRepository(Deployment) private readonly repo: Repository<Deployment>,
    private readonly activities: ActivitiesService,
    private readonly events: HubEventsService,
  ) {}

  list(appId: number, q: { env?: DeployEnv; repoId?: number; limit: number }): Promise<Deployment[]> {
    const qb = this.repo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.repo', 'repo')
      .where('d.app_id = :appId', { appId })
      .orderBy('COALESCE(d.started_at, d.created_at)', 'DESC')
      .limit(q.limit);
    if (q.env) qb.andWhere('d.env = :env', { env: q.env });
    if (q.repoId) qb.andWhere('d.repo_id = :repoId', { repoId: q.repoId });
    return qb.getMany();
  }

  /** 저장소·환경마다 가장 최근 배포 하나 */
  async latest(appId: number): Promise<Deployment[]> {
    const ids: Array<{ id: number }> = await this.repo.query(
      `SELECT DISTINCT ON (COALESCE(repo_id, 0), env) id FROM deployments WHERE app_id = $1
       ORDER BY COALESCE(repo_id, 0), env, COALESCE(started_at, created_at) DESC`,
      [appId],
    );
    if (!ids.length) return [];
    return this.repo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.repo', 'repo')
      .where('d.id IN (:...ids)', { ids: ids.map((r) => r.id) })
      .orderBy("CASE d.env WHEN 'production' THEN 0 WHEN 'store' THEN 1 WHEN 'staging' THEN 2 ELSE 3 END", 'ASC')
      .getMany();
  }

  /** 화면이나 Claude가 직접 남기는 배포 (GitHub에 남지 않는 스토어 제출 등) */
  async record(app: App, input: DeployInput, actor: ActivityActor): Promise<Deployment> {
    const source = actor === 'claude' ? 'claude' : 'manual';
    const now = new Date();
    const saved = await this.repo.save(
      this.repo.create({
        appId: app.id,
        repoId: input.repoId ?? null,
        source,
        externalId: `${source}-${randomUUID()}`,
        environment: input.environment ?? DEPLOY_ENV_LABEL[input.env],
        env: input.env,
        status: input.status,
        version: input.version ?? null,
        sha: input.sha ?? null,
        url: input.url ?? null,
        notes: input.notes ?? null,
        startedAt: now,
        finishedAt: ['success', 'failure', 'cancelled'].includes(input.status) ? now : null,
      }),
    );
    return this.afterChange(saved.id, app.code, actor, null);
  }

  async update(id: number, appCode: string, input: Partial<DeployInput>, actor: ActivityActor): Promise<Deployment> {
    const d = await this.get(id);
    const before = d.status;
    Object.assign(d, input);
    if (input.status && ['success', 'failure', 'cancelled'].includes(input.status) && !d.finishedAt) d.finishedAt = new Date();
    await this.repo.save(d);
    return this.afterChange(d.id, appCode, actor, before);
  }

  findExternal(source: DeploySource, externalId: string): Promise<Deployment | null> {
    return this.repo.findOneBy({ source, externalId });
  }

  /** GitHub에서 가져온 배포를 넣거나 상태를 바꾼다. 히스토리 시각은 배포가 일어난 시각이다 */
  async upsertExternal(
    app: App,
    input: DeployInput & { source: DeploySource; externalId: string; environment: string; startedAt: Date; finishedAt: Date | null },
  ): Promise<Deployment> {
    const known = await this.findExternal(input.source, input.externalId);
    const saved = await this.repo.save(Object.assign(known ?? this.repo.create({ appId: app.id }), input));
    return this.afterChange(saved.id, app.code, 'github', known?.status ?? null);
  }

  async get(id: number): Promise<Deployment> {
    const d = await this.repo.findOne({ where: { id }, relations: { repo: true } });
    if (!d) throw new NotFoundException(`배포 ${id}가 없다`);
    return d;
  }

  /** 상태가 새로 생기거나 바뀌면 히스토리와 실시간 이벤트로 알린다 */
  private async afterChange(id: number, appCode: string, actor: ActivityActor, before: DeployStatus | null): Promise<Deployment> {
    const d = await this.get(id);
    this.events.emit('deployment.updated', { deployment: toDeploymentDto(d, appCode) });
    if (before !== d.status) {
      const what = [DEPLOY_ENV_LABEL[d.env], d.version ?? d.sha?.slice(0, 7), d.repo ? `(${d.repo.name})` : null].filter(Boolean).join(' ');
      await this.activities.record({
        appId: d.appId, kind: 'deploy', actor, refType: 'deployment', refId: String(d.id),
        at: d.source === 'github_deployment' || d.source === 'workflow_run' ? (d.finishedAt ?? d.startedAt ?? undefined) : undefined,
        summary: `배포 ${DEPLOY_STATUS_LABEL[d.status]} · ${what}${d.notes ? `: ${d.notes}` : ''}`,
        data: { env: d.env, status: d.status, version: d.version, source: d.source },
      });
    }
    return d;
  }
}
