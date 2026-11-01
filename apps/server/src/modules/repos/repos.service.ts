import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { basename } from 'node:path';
import type { ActivityActor, AppRepoDto } from '@hub/shared';
import { Repository } from 'typeorm';
import { ActivitiesService } from '../activities/activities.service';
import { App } from '../apps/app.entity';
import { AppsService } from '../apps/apps.service';
import { run } from '../runner/git';
import { AppRepo } from './app-repo.entity';
import { findRepoDirs, parseGithubRemote } from './detect';

export function toRepoDto(r: AppRepo, appCode: string): AppRepoDto {
  return {
    id: r.id,
    appCode,
    name: r.name,
    path: r.path,
    github: r.github,
    defaultBranch: r.defaultBranch,
    setupCmd: r.setupCmd,
    checkCmd: r.checkCmd,
    deployRules: r.deployRules,
  };
}

export type RepoInput = Partial<Pick<AppRepo, 'name' | 'github' | 'defaultBranch' | 'setupCmd' | 'checkCmd' | 'deployRules'>> & { path?: string };

/** 앱의 저장소 목록. 앱 폴더에서 git 저장소를 찾아 채우고, task를 어느 저장소에서 돌릴지 정한다. */
@Injectable()
export class ReposService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Repos');

  constructor(
    @InjectRepository(AppRepo) private readonly repo: Repository<AppRepo>,
    private readonly apps: AppsService,
    private readonly activities: ActivitiesService,
  ) {}

  /** 저장소가 하나도 등록되지 않은 앱은 시작할 때 앱 폴더에서 찾아 둔다. */
  async onApplicationBootstrap(): Promise<void> {
    for (const app of await this.apps.list()) {
      if (!app.repoPath || (await this.repo.countBy({ appId: app.id }))) continue;
      try {
        const found = await this.detect(app, 'hub');
        if (found.length) this.logger.log(`${app.code} 저장소 ${found.length}개: ${found.map((r) => r.name).join(', ')}`);
      } catch (e) {
        this.logger.warn(`${app.code} 저장소 찾기 실패: ${(e as Error).message}`);
      }
    }
  }

  list(appId: number): Promise<AppRepo[]> {
    return this.repo.find({ where: { appId }, order: { position: 'ASC', id: 'ASC' } });
  }

  async get(id: number): Promise<AppRepo> {
    const r = await this.repo.findOneBy({ id });
    if (!r) throw new NotFoundException(`저장소 ${id}가 없다`);
    return r;
  }

  /** 앱 폴더의 git 저장소 중 아직 등록되지 않은 것을 등록한다. 이미 있는 것은 그대로 둔다. */
  async detect(app: App, actor: ActivityActor = 'me'): Promise<AppRepo[]> {
    if (!app.repoPath) return [];
    const existing = await this.list(app.id);
    const dirs = findRepoDirs(app.repoPath);
    for (const [i, path] of dirs.entries()) {
      if (existing.some((r) => r.path === path)) continue;
      const added = await this.repo.save(
        this.repo.create({
          appId: app.id,
          name: basename(path),
          path,
          github: parseGithubRemote(await run('git', ['remote', 'get-url', 'origin'], path).catch(() => '')),
          defaultBranch: await this.defaultBranchOf(path, app.defaultBranch),
          // 비워 두면 앱의 setup_cmd·check_cmd를 쓴다. 저장소마다 다르면 따로 정한다.
          setupCmd: null,
          position: existing.length + i,
        }),
      );
      await this.activities.record({
        appId: app.id, kind: 'repo.added', actor, refType: 'repo', refId: String(added.id),
        summary: `저장소 등록: ${added.name}${added.github ? ` (${added.github})` : ''}`,
      });
    }
    return this.list(app.id);
  }

  async create(app: App, input: RepoInput & { path: string }): Promise<AppRepo> {
    const github = input.github ?? parseGithubRemote(await run('git', ['remote', 'get-url', 'origin'], input.path).catch(() => ''));
    const saved = await this.repo.save(
      this.repo.create({
        appId: app.id,
        name: input.name ?? basename(input.path),
        path: input.path,
        github,
        defaultBranch: input.defaultBranch ?? (await this.defaultBranchOf(input.path, app.defaultBranch)),
        setupCmd: input.setupCmd ?? null,
        checkCmd: input.checkCmd ?? null,
        deployRules: input.deployRules ?? [],
        position: await this.repo.countBy({ appId: app.id }),
      }),
    );
    await this.activities.record({ appId: app.id, kind: 'repo.added', actor: 'me', refType: 'repo', refId: String(saved.id), summary: `저장소 등록: ${saved.name}` });
    return saved;
  }

  async update(id: number, input: RepoInput): Promise<AppRepo> {
    const r = await this.get(id);
    Object.assign(r, input);
    return this.repo.save(r);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete({ id: (await this.get(id)).id });
  }

  /**
   * task를 돌릴 저장소. task에 정해 둔 저장소가 있으면 그것, 없으면 앱의 저장소가 하나일 때만 그것을 쓴다.
   * 아직 찾지 않은 앱이면 지금 찾는다.
   */
  async resolveFor(app: App, repoId: number | null): Promise<AppRepo> {
    if (repoId) return this.get(repoId);
    let repos = await this.list(app.id);
    if (!repos.length) repos = await this.detect(app, 'hub');
    if (repos.length === 1) return repos[0];
    if (!repos.length) throw new ConflictException(`앱 ${app.code}에 git 저장소가 없다. 앱 폴더나 저장소 목록을 확인하라`);
    throw new ConflictException(`앱 ${app.code}에는 저장소가 ${repos.length}개(${repos.map((r) => r.name).join(', ')}) 있어서 task에 저장소를 정해야 한다`);
  }

  private async defaultBranchOf(path: string, fallback: string): Promise<string> {
    const head = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], path).catch(() => '');
    if (head.startsWith('origin/')) return head.slice('origin/'.length);
    return fallback;
  }
}
