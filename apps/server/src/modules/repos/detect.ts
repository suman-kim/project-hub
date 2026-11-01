import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ProjectCandidateDto } from '@hub/shared';

/** git 원격 주소에서 GitHub owner/repo를 뽑는다. GitHub가 아니면 null */
export function parseGithubRemote(url: string): string | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** 앱 폴더가 git 저장소면 그 폴더 하나, 아니면 바로 아래의 git 저장소들 */
export function findRepoDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  if (existsSync(join(root, '.git'))) return [root];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(root, d.name, '.git')))
    .map((d) => join(root, d.name))
    .sort();
}

type Git = (args: string[], cwd: string) => Promise<string>;

/** 기본 브랜치: origin/HEAD가 가리키는 것, 없으면 지금 브랜치 */
async function defaultBranch(git: Git, dir: string): Promise<string | null> {
  const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], dir).catch(() => '');
  if (head.trim()) return head.trim().replace(/^origin\//, '');
  // 커밋이 없는 저장소에서도 동작하도록 rev-parse 대신 symbolic-ref를 쓴다. 분리된 HEAD면 비운다.
  const cur = await git(['symbolic-ref', '--short', 'HEAD'], dir).catch(() => '');
  return cur.trim() || null;
}

/** root 바로 아래 폴더 가운데 git 저장소가 있는 것 (숨김 폴더 제외) */
export async function projectCandidates(root: string, git: Git, appByPath: (path: string) => string | null): Promise<ProjectCandidateDto[]> {
  if (!existsSync(root)) return [];
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => join(root, d.name))
    .sort();
  const out: ProjectCandidateDto[] = [];
  for (const path of dirs) {
    const repoDirs = findRepoDirs(path);
    if (!repoDirs.length) continue;
    const repos = await Promise.all(
      repoDirs.map(async (dir) => ({
        path: dir,
        name: basename(dir),
        github: parseGithubRemote(await git(['remote', 'get-url', 'origin'], dir).catch(() => '')),
        branch: await defaultBranch(git, dir),
      })),
    );
    out.push({ path, name: basename(path), repos, appCode: appByPath(path) });
  }
  return out;
}
