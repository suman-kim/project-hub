import { Inject, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { App } from '../apps/app.entity';
import { CommandError, run, slugify } from './git';

/** task를 돌릴 저장소와 명령. 저장소 설정이 비어 있으면 앱 설정을 쓴다 */
export interface RepoTarget {
  path: string;
  defaultBranch: string;
  setupCmd: string | null;
  checkCmd: string | null;
}

export interface Worktree {
  path: string;
  branch: string;
}

/** 작업마다 git worktree 하나. 위치는 ~/.hub/worktrees/<app>/<task-id>, 브랜치는 hub/<task-id>-<slug> */
@Injectable()
export class WorktreeService {
  private readonly logger = new Logger('Worktree');

  constructor(@Inject(HUB_CONFIG) private readonly config: HubConfig) {}

  /** 앱에 worktree 위치를 정해 두었으면 그곳, 아니면 ~/.hub/worktrees */
  pathFor(app: Pick<App, 'code' | 'worktreeRoot'>, taskId: string): string {
    return join(app.worktreeRoot ?? join(this.config.hubHome, 'worktrees'), app.code, taskId);
  }

  branchFor(taskId: string, title: string): string {
    return `hub/${taskId}-${slugify(title)}`;
  }

  /** 이미 있으면 그대로 쓴다 (같은 task의 다음 run). 없으면 저장소 기준 브랜치의 최신 상태에서 만든다. */
  async ensure(app: Pick<App, 'code' | 'worktreeRoot'>, target: RepoTarget, taskId: string, title: string): Promise<Worktree & { created: boolean }> {
    const path = this.pathFor(app, taskId);
    if (existsSync(join(path, '.git'))) {
      const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], path);
      return { path, branch, created: false };
    }

    const branch = this.branchFor(taskId, title);
    const repo = target.path;
    const hasOrigin = (await run('git', ['remote'], repo)).split('\n').includes('origin');
    let base = target.defaultBranch;
    if (hasOrigin) {
      try {
        await run('git', ['fetch', 'origin', target.defaultBranch], repo);
        base = `origin/${target.defaultBranch}`;
      } catch (e) {
        this.logger.warn(`fetch 실패, 로컬 ${target.defaultBranch}에서 만든다: ${(e as Error).message}`);
      }
    }

    mkdirSync(dirname(path), { recursive: true });
    const branchExists = await run('git', ['branch', '--list', branch], repo);
    const args = branchExists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, base];
    await run('git', args, repo);
    return { path, branch, created: true };
  }

  /** setup_cmd(의존성 설치)나 check_cmd(push 전 검사). 앱 설정에서 오는 명령이라 셸로 돌린다. */
  runShell(label: 'setup_cmd' | 'check_cmd', cmd: string, path: string, onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', cmd], { cwd: path, stdio: ['ignore', 'pipe', 'pipe'] });
      const tail: string[] = [];
      const collect = (buf: Buffer) => {
        for (const line of buf.toString().split('\n').filter(Boolean)) {
          tail.push(line);
          if (tail.length > 20) tail.shift();
          onLine(line);
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', (e) => reject(new CommandError(label, e.message)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new CommandError(label, tail.join('\n')))));
    });
  }

  async commitsAhead(path: string, defaultBranch: string): Promise<number> {
    const hasOrigin = (await run('git', ['remote'], path)).split('\n').includes('origin');
    const base = hasOrigin ? `origin/${defaultBranch}` : defaultBranch;
    return Number(await run('git', ['rev-list', '--count', `${base}..HEAD`], path));
  }

  /**
   * 커밋하지 않은 변경. 추적 중인 파일만 실패 사유로 보고, 추적하지 않는 파일은 따로 돌려준다.
   * (setup_cmd 산출물처럼 .gitignore에 없는 파일이 생길 수 있어서)
   */
  async uncommitted(path: string): Promise<{ tracked: string[]; untracked: string[] }> {
    const lines = (await run('git', ['status', '--porcelain'], path)).split('\n').filter(Boolean);
    return {
      tracked: lines.filter((l) => !l.startsWith('??')).map((l) => l.slice(3)),
      untracked: lines.filter((l) => l.startsWith('??')).map((l) => l.slice(3)),
    };
  }

  async push(path: string, branch: string): Promise<void> {
    if (branch === 'main' || branch === 'master' || !branch.startsWith('hub/')) {
      throw new CommandError('git push', `hub/ 브랜치가 아니라서 push하지 않는다: ${branch}`);
    }
    await run('git', ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`], path);
  }

  /** 머지·취소된 task의 worktree를 지운다. 브랜치는 PR 기록을 위해 남긴다. */
  async remove(repoPath: string, path: string): Promise<void> {
    if (!existsSync(path)) return;
    await run('git', ['worktree', 'remove', '--force', path], repoPath);
  }
}
