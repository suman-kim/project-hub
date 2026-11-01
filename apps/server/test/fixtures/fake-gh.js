#!/usr/bin/env node
// e2e용 가짜 gh. pr create, repo create/view를 흉내 낸다.
// 저장소는 FAKE_GH_REMOTES/<이름>.git bare 저장소로 만든다.
const { execFileSync } = require('node:child_process');
const { appendFileSync, existsSync } = require('node:fs');
const { basename, join } = require('node:path');

const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
const remotes = process.env.FAKE_GH_REMOTES || '';
const bare = (fullName) => join(remotes, `${basename(fullName)}.git`);
const url = (name) => `https://github.com/test/${name}`;

// gh api <path>: FAKE_GH_API 파일(JSON: 경로 → 응답)에서 찾는다
if (args[0] === 'api') {
  const table = process.env.FAKE_GH_API && existsSync(process.env.FAKE_GH_API) ? JSON.parse(require('node:fs').readFileSync(process.env.FAKE_GH_API, 'utf8')) : {};
  if (!(args[1] in table)) process.exit(1);
  process.stdout.write(JSON.stringify(table[args[1]]));
  process.exit(0);
}

// gh pr view <url> --json state,mergedAt: FAKE_GH_PRS 파일(JSON: url → state)
if (args[0] === 'pr' && args[1] === 'view' && args[2] && args[2].startsWith('http')) {
  const prs = process.env.FAKE_GH_PRS && existsSync(process.env.FAKE_GH_PRS) ? JSON.parse(require('node:fs').readFileSync(process.env.FAKE_GH_PRS, 'utf8')) : {};
  process.stdout.write(JSON.stringify({ state: prs[args[2]] || 'OPEN', mergedAt: null }));
  process.exit(0);
}

if (args[0] === 'pr' && args[1] === 'create') {
  const head = args[args.indexOf('--head') + 1];
  process.stdout.write(`https://github.com/test/repo/pull/${encodeURIComponent(head)}\n`);
  process.exit(0);
}

if (args[0] === 'repo' && args[1] === 'create') {
  const name = args[2];
  const source = args[args.indexOf('--source') + 1];
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare(name)]);
  execFileSync('git', ['remote', 'add', 'origin', bare(name)], { cwd: source });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'HEAD'], { cwd: source });
  process.stdout.write(`${url(basename(name))}\n`);
  process.exit(0);
}

if (args[0] === 'repo' && args[1] === 'view') {
  if (args[2] && !args[2].startsWith('-')) {
    if (!existsSync(bare(args[2]))) {
      process.stderr.write(`GraphQL: Could not resolve to a Repository with the name '${args[2]}'.\n`);
      process.exit(1);
    }
    // -q '[.url, .defaultBranchRef.name] | @tsv': 원격으로 쓸 주소(.git을 뺀 bare 경로)와 기본 브랜치
    if (args.includes('-q') && args[args.indexOf('-q') + 1].includes('@tsv')) {
      const head = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: bare(args[2]) }).toString().trim();
      process.stdout.write(`${bare(args[2]).replace(/\.git$/, '')}\t${head}\n`);
      process.exit(0);
    }
    process.stdout.write(`${JSON.stringify({ url: url(basename(args[2])) })}\n`);
    process.exit(0);
  }
  const origin = execFileSync('git', ['remote', 'get-url', 'origin']).toString().trim();
  process.stdout.write(`${url(basename(origin, '.git'))}\n`);
  process.exit(0);
}
process.exit(1);
