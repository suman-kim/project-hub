import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { App } from '../apps/app.entity';
import { AppsService } from '../apps/apps.service';
import { Idea } from '../ideas/idea.entity';
import { IdeasService, renderIdeaSpec } from '../ideas/ideas.service';
import { ReposService } from '../repos/repos.service';
import { SettingsService } from '../settings/settings.service';
import { Task } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { buildBootstrapPrompt, hubMcpRegistered, markWorkspaceTrusted, RC_EXTRA_TOOLS, renderClaudeMd, renderReadme } from './bootstrap';
import { APP_CODE, APP_FOLDER } from './concept-gen';
import { extractRemoteLink } from '../overview/bg-sessions.service';
import { run } from './git';

/** 승인할 때 기획이 제안한 앱 코드·이름·폴더를 바꿀 수 있다. */
export interface AppOverrides {
  code?: string;
  name?: string;
  folder?: string;
}

export interface BootstrapOutcome {
  repoUrl: string;
  firstTaskId: string;
  /** claude --rc 세션을 띄웠는지. 못 띄웠으면 runner가 첫 task를 대신 시작한다 */
  launched: boolean;
  rc?: { name: string; output: string; verified: boolean; id?: string; link?: string | null };
  reason?: string;
}

const writeIfMissing = (path: string, content: string) => {
  if (!existsSync(path)) writeFileSync(path, content);
};

/**
 * 새 앱 기획을 실제 앱으로 시작한다.
 * prepare(승인 요청 안에서): 앱 등록 → 기획 승인(task, 명세)
 * execute(큐 작업): 폴더 → git → GitHub 비공개 저장소 → 작업 공간 신뢰 → claude --bg --rc
 */
@Injectable()
export class BootstrapService {
  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly apps: AppsService,
    private readonly tasks: TasksService,
    private readonly ideas: IdeasService,
    private readonly settings: SettingsService,
    private readonly repos: ReposService,
  ) {}

  async prepare(ideaId: number, overrides: AppOverrides = {}): Promise<{ idea: Idea & { app: App }; app: App; tasks: Task[] }> {
    const idea = await this.ideas.get(ideaId);
    if (idea.kind !== 'app') throw new BadRequestException(`기획 ${ideaId}는 새 앱 기획이 아니다`);
    if (idea.status !== 'pending') throw new ConflictException(`기획 ${ideaId}는 ${idea.status} 상태라 승인할 수 없다`);
    const { body } = await this.ideas.currentVersion(idea);

    const suggested = body.concept?.app;
    const code = (overrides.code ?? suggested?.code ?? '').trim().toUpperCase();
    const name = (overrides.name ?? suggested?.name ?? idea.title).trim();
    const folder = (overrides.folder ?? suggested?.folder ?? '').trim().toLowerCase();
    if (!APP_CODE.test(code)) throw new BadRequestException(`앱 코드 "${code}"는 대문자 2~4자여야 한다`);
    if (!APP_FOLDER.test(folder)) throw new BadRequestException(`폴더 이름 "${folder}"는 영문 소문자, 숫자, 하이픈만 쓴다`);

    const { projectRoot } = await this.settings.ideation();
    const repoPath = join(projectRoot, folder);
    // 폴더가 이미 있으면 그 폴더(있는 git·GitHub 저장소 포함)로 시작한다. 다른 앱이 쓰는 폴더만 막는다.
    if (existsSync(repoPath)) {
      const owner = (await this.apps.list()).find((a) => a.repoPath && (a.repoPath === repoPath || repoPath.startsWith(`${a.repoPath}/`) || a.repoPath.startsWith(`${repoPath}/`)));
      if (owner) throw new ConflictException(`${repoPath}는 이미 앱 ${owner.name}(${owner.code})이 쓰는 폴더다. 다른 폴더 이름으로 승인하라`);
    }

    const app = await this.apps.create({
      code,
      name,
      repoPath,
      folderNames: [folder],
      defaultBranch: 'main',
      directionNote: body.concept?.oneLiner ?? null,
    });
    const { idea: approved, tasks } = await this.ideas.approve(ideaId, app);
    return { idea: approved, app, tasks };
  }

  /** 다시 불러도 이미 끝난 단계는 건너뛴다. 폴더·git 저장소·GitHub 저장소가 이미 있으면 그것을 쓴다. */
  async execute(spec: { ideaId: number; appId: number }, runId: number, log: { hub(text: string): void }): Promise<BootstrapOutcome> {
    const app = await this.apps.get(spec.appId);
    const idea = await this.ideas.get(spec.ideaId);
    const { body } = await this.ideas.currentVersion(idea);
    const settings = await this.settings.ideation();
    if (!app.repoPath) throw new ConflictException(`앱 ${app.code}에 repo_path가 없다`);
    const dir = app.repoPath;
    let branch = app.defaultBranch;
    const gh = this.config.runner.ghBin;

    // 1. 폴더와 첫 커밋. 이미 커밋이 있는 저장소면 파일을 더하지 않고 그 저장소의 브랜치를 쓴다.
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, '.git'))) {
      await run('git', ['init', '-q', '-b', branch], dir);
      log.hub(`git 저장소 생성: ${dir}`);
    }
    const hasHead = () =>
      run('git', ['rev-parse', '--verify', '-q', 'HEAD'], dir).then(
        () => true,
        () => false,
      );
    const existingRepo = await hasHead();
    if (existingRepo) {
      branch = (await run('git', ['symbolic-ref', '--short', 'HEAD'], dir).catch(() => branch)) || branch;
      log.hub(`이미 있는 저장소로 시작: ${dir} (${branch}) · 기획 명세는 Hub에 있어서 파일은 더하지 않았다`);
    } else {
      mkdirSync(join(dir, 'docs'), { recursive: true });
      writeIfMissing(join(dir, 'README.md'), renderReadme(idea.title, body, app.code));
      writeIfMissing(join(dir, 'docs', 'concept.md'), renderIdeaSpec(idea.title, body));
      writeIfMissing(join(dir, 'CLAUDE.md'), renderClaudeMd(app, idea.id, body.concept));
      // 폴더에 원래 있던 파일(.env 등)이 딸려 올라가지 않게 Hub가 만든 파일만 커밋한다.
      await run('git', ['add', '--', 'README.md', 'CLAUDE.md', 'docs/concept.md'], dir);
      await run('git', ['commit', '-q', '-m', `${app.code}: 프로젝트 시작 (Hub 기획 #${idea.id})`], dir);
      const others = await run('git', ['status', '--porcelain'], dir).catch(() => '');
      log.hub(`첫 커밋: README.md, CLAUDE.md, docs/concept.md${others ? ' · 폴더에 원래 있던 파일은 커밋하지 않았다' : ''}`);
    }

    // 2. GitHub 비공개 저장소. 같은 이름의 저장소가 이미 있으면 그 저장소에 연결한다.
    const remote = await run('git', ['remote', 'get-url', 'origin'], dir).catch(() => '');
    if (!remote) {
      const fullName = settings.githubOwner ? `${settings.githubOwner}/${basename(dir)}` : basename(dir);
      const found = await run(gh, ['repo', 'view', fullName, '--json', 'url,defaultBranchRef', '-q', '[.url, .defaultBranchRef.name] | @tsv'], dir).catch(() => '');
      if (!found) {
        const description = body.concept?.oneLiner ?? idea.title;
        await run(gh, ['repo', 'create', fullName, '--private', '--source', dir, '--remote', 'origin', '--push', '--description', description], dir);
        log.hub(`GitHub 비공개 저장소 생성, ${branch} push: ${fullName}`);
      } else {
        const [url, remoteBranch] = found.split('\t');
        await run('git', ['remote', 'add', 'origin', `${url}.git`], dir);
        await run('git', ['fetch', '-q', 'origin'], dir);
        const target = remoteBranch || branch;
        const onRemote = !!(await run('git', ['ls-remote', '--heads', 'origin', target], dir));
        if (!onRemote) {
          await run('git', ['push', '-u', 'origin', branch], dir);
          log.hub(`GitHub의 빈 저장소 ${fullName}에 연결하고 ${branch} push`);
        } else if (!existingRepo) {
          // Hub가 방금 만든 첫 커밋은 버리고 GitHub 저장소의 기록을 그대로 쓴다. 작업 폴더의 파일은 건드리지 않는다.
          await run('git', ['symbolic-ref', 'HEAD', `refs/heads/${target}`], dir);
          await run('git', ['reset', '-q', '--mixed', `origin/${target}`], dir);
          if (target !== branch) await run('git', ['branch', '-D', branch], dir).catch(() => '');
          await run('git', ['branch', '-q', `--set-upstream-to=origin/${target}`], dir);
          branch = target;
          log.hub(`GitHub의 기존 저장소 ${fullName}(${target})로 시작 · Hub가 만든 README.md, CLAUDE.md, docs/concept.md는 커밋하지 않고 남겨 두었다`);
        } else {
          log.hub(`GitHub의 기존 저장소 ${fullName}를 origin으로 연결했다 · 로컬 기록과 맞는지는 직접 확인한다`);
        }
      }
    } else if (!(await run('git', ['ls-remote', '--heads', 'origin', branch], dir))) {
      await run('git', ['push', '-u', 'origin', branch], dir);
      log.hub(`${branch} push`);
    }
    if (branch !== app.defaultBranch) {
      await this.apps.update(app.id, { defaultBranch: branch }, 'hub');
      log.hub(`앱 기본 브랜치를 ${branch}로 바꿨다`);
    }
    const repoUrl = await run(gh, ['repo', 'view', '--json', 'url', '-q', '.url'], dir);
    // 저장소 목록에 올려 둔다 (GitHub 원격까지 붙은 뒤라 owner/repo가 같이 들어간다).
    await this.repos.detect(app, 'hub');

    // 3. 이 기획에서 나온 task 중 첫 번째부터 시작한다.
    const tasks = (await this.tasks.list({ app: app.code })).filter((t) => t.ideaId === idea.id);
    const first = tasks.find((t) => t.status === 'todo' || t.status === 'doing') ?? tasks[0];
    if (!first) throw new ConflictException(`앱 ${app.code}에 시작할 task가 없다`);

    // 4. 작업 공간 신뢰 → claude --bg --rc
    const realDir = realpathSync(dir);
    try {
      markWorkspaceTrusted(this.config.claudeJson, realDir);
      log.hub('작업 공간 신뢰 등록 (~/.claude.json)');
    } catch (e) {
      return { repoUrl, firstTaskId: first.id, launched: false, reason: `작업 공간 신뢰 등록 실패: ${(e as Error).message}` };
    }

    const name = `${app.code} ${app.name}`;
    const prompt = buildBootstrapPrompt({
      app,
      oneLiner: body.concept?.oneLiner ?? idea.title,
      repoUrl,
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, size: t.size, dependsOn: t.dependsOn })),
      first,
    });
    // 프롬프트를 맨 앞에 둔다. --allowedTools 같은 여러 값 옵션 뒤에 두면 도구 이름으로 읽힌다.
    const args = [prompt, '--bg', '--rc', name, '-n', name, '--permission-mode', settings.sessionPermissionMode];
    if (!hubMcpRegistered(this.config.claudeJson)) args.push('--mcp-config', this.writeMcpConfig(app.code));
    args.push('--allowedTools', [...(app.allowedTools ?? this.config.runner.allowedTools), ...RC_EXTRA_TOOLS].join(','));

    try {
      const output = await run(this.config.runner.claudeBin, args, realDir, 60_000, { HUB_TASK_ID: first.id, HUB_RUN_ID: String(runId) });
      log.hub(`claude --rc 세션 시작: "${name}" (claude.ai/code 또는 Claude 앱에서 이어서 본다)`);
      const verified = await this.findBackgroundSession(realDir);
      if (!verified) log.hub('claude agents 목록에서 세션을 아직 찾지 못했다. claude agents로 확인하라');
      // 원격 조종 링크는 세션 화면에 시작할 때만 찍히므로 지금 찾아 저장해 둔다.
      const id = /backgrounded · ([0-9a-f]{8})|session ([0-9a-z]+)/i.exec(output)?.slice(1).find(Boolean);
      const link = id ? await this.remoteLinkOf(id) : null;
      if (link) log.hub(`원격 조종: ${link}`);
      return { repoUrl, firstTaskId: first.id, launched: true, rc: { name, output: output.slice(-500), verified, id, link } };
    } catch (e) {
      return { repoUrl, firstTaskId: first.id, launched: false, reason: `claude --rc 실행 실패: ${(e as Error).message}` };
    }
  }

  /** hub MCP가 사용자 범위로 등록되어 있지 않으면 이 세션에만 붙인다. 토큰이 들어 있어 권한 600으로 쓴다. */
  private writeMcpConfig(appCode: string): string {
    const dir = join(this.config.hubHome, 'sessions');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${appCode.toLowerCase()}-mcp.json`);
    const config = {
      mcpServers: { hub: { type: 'http', url: `http://127.0.0.1:${this.config.port}/mcp`, headers: { 'X-Hub-Token': this.config.token } } },
    };
    writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    return file;
  }

  private async remoteLinkOf(id: string): Promise<string | null> {
    for (let i = 0; i < 5; i += 1) {
      const link = extractRemoteLink(await run(this.config.runner.claudeBin, ['logs', id], this.config.hubHome, 15_000).catch(() => ''));
      if (link) return link;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  /** claude agents --json에 이 폴더의 세션이 보이는지 몇 초 동안 확인한다. */
  private async findBackgroundSession(dir: string): Promise<boolean> {
    for (let i = 0; i < 5; i += 1) {
      try {
        const list = JSON.parse(await run(this.config.runner.claudeBin, ['agents', '--json'], dir, 15_000)) as unknown[];
        if (list.some((s) => JSON.stringify(s).includes(dir))) return true;
      } catch {
        // 목록 형식이 바뀌어도 시작 자체는 성공으로 본다.
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }
}
