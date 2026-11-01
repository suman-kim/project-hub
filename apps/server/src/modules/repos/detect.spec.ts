import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectCandidates } from './detect';
import { run } from '../runner/git';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd });

describe('projectCandidates', () => {
  it('git 저장소가 있는 폴더만, 저장소마다 GitHub과 기본 브랜치를 붙여 돌려준다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hub-projects-'));
    const single = join(root, 'link');
    mkdirSync(single);
    git(single, 'init', '-q', '-b', 'main');
    git(single, 'remote', 'add', 'origin', 'git@github.com:me/link.git');
    for (const sub of ['backend', 'frontend']) {
      mkdirSync(join(root, 'multi', sub), { recursive: true });
      git(join(root, 'multi', sub), 'init', '-q', '-b', 'develop');
    }
    mkdirSync(join(root, 'notes'));
    mkdirSync(join(root, '.cache'));

    const list = await projectCandidates(root, (args, cwd) => run('git', args, cwd), (p) => (p === single ? 'LK' : null));
    expect(list.map((c) => c.name)).toEqual(['link', 'multi']);
    expect(list[0]).toMatchObject({ appCode: 'LK', repos: [{ name: 'link', github: 'me/link', branch: 'main' }] });
    expect(list[1].repos.map((r) => [r.name, r.github, r.branch])).toEqual([
      ['backend', null, 'develop'],
      ['frontend', null, 'develop'],
    ]);
    expect(await projectCandidates(join(root, 'nope'), (a, c) => run('git', a, c), () => null)).toEqual([]);
  });
});
