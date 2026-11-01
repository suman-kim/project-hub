#!/usr/bin/env node
// e2e용 가짜 claude. 진짜 claude -p와 같은 stream-json 이벤트를 낸다.
// 프롬프트(task 제목)에 든 표시로 동작을 고른다:
//   ASK_FIRST: 처음엔 질문으로 끝나고, --resume으로 답을 받으면 커밋하고 완료
//   SLOW: 오래 걸린다 (중지 시험)
//   NOCOMMIT: 커밋 없이 완료라고 한다
//   LIMIT: 사용량 한도에 걸린다
// claude --bg (새 앱 시작 세션)는 FAKE_CLAUDE_BG_STATE에 세션을 적고 끝난다. 프롬프트에 BG_FAIL이 있으면 신뢰 오류를 낸다.
// claude agents --json은 그 파일의 세션 목록을 낸다.
// claude mcp list는 커넥터·MCP 세 개의 상태를 낸다. --json-schema에 summaries가 있으면 한국어 요약 JSON을 낸다.
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');

const args = process.argv.slice(2);
const bgState = () => (existsSync(process.env.FAKE_CLAUDE_BG_STATE) ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_BG_STATE, 'utf8')) : []);

if (args[0] === 'agents' && args[1] === '--json') {
  process.stdout.write(JSON.stringify(bgState()));
  process.exit(0);
}

if (args[0] === 'mcp' && args[1] === 'list') {
  process.stdout.write(
    [
      'Checking MCP server health…',
      '',
      'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected',
      'plugin:tools:pdf: npx -y pdf-server --stdio - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed',
      'hub: http://127.0.0.1:2424/mcp (HTTP) - ✔ Connected',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (args[0] === 'logs') {
  process.stdout.write(`\x1b[2m/remote-control is active · Continue here, on your phone, or at https://claude.ai/code/session_fake${args[1]}\x1b[0m\n`);
  process.exit(0);
}

if (args.includes('--bg')) {
  if (process.env.FAKE_CLAUDE_ARGS_LOG) {
    appendFileSync(process.env.FAKE_CLAUDE_ARGS_LOG, `${JSON.stringify({ args, cwd: process.cwd(), env: { HUB_TASK_ID: process.env.HUB_TASK_ID, HUB_RUN_ID: process.env.HUB_RUN_ID } })}\n`);
  }
  if (args[0].includes('BG_FAIL')) {
    process.stdout.write(`Workspace not trusted. Run \`claude\` in ${process.cwd()} once and accept the trust prompt, then retry.\n`);
    process.exit(1);
  }
  const sessions = bgState();
  const id = `bg${sessions.length + 1}`;
  sessions.push({ id, name: args[args.indexOf('-n') + 1], cwd: process.cwd(), status: 'running' });
  writeFileSync(process.env.FAKE_CLAUDE_BG_STATE, JSON.stringify(sessions));
  process.stdout.write(`Started background session ${id}\n`);
  process.exit(0);
}

const prompt = args[args.indexOf('-p') + 1];

// 스킬·커넥터 한국어 요약: 프롬프트 끝의 JSON 배열 id마다 "요약: <이름>"을 돌려준다.
if (args.includes('--json-schema') && args[args.indexOf('--json-schema') + 1].includes('"summaries"')) {
  const items = JSON.parse(prompt.slice(prompt.indexOf('\n[') + 1));
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { summaries: items.map((i) => ({ id: i.id, ko: `요약: ${i.name}` })) } }));
  process.exit(0);
}

const resumeIdx = args.indexOf('--resume');
const sessionId = resumeIdx >= 0 ? args[resumeIdx + 1] : randomUUID();
const out = (ev) => process.stdout.write(`${JSON.stringify({ session_id: sessionId, ...ev })}\n`);

if (process.env.FAKE_CLAUDE_ARGS_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_ARGS_LOG, `${JSON.stringify({ args, cwd: process.cwd(), env: { HUB_TASK_ID: process.env.HUB_TASK_ID, HUB_RUN_ID: process.env.HUB_RUN_ID } })}\n`);
}

out({ type: 'system', subtype: 'init', model: 'fake' });
out({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    rateLimitType: 'five_hour',
    unifiedWindows: {
      five_hour: { status: 'allowed', utilization: 0.1, resetsAt: 1900000000 },
      seven_day: { status: 'allowed', utilization: 0.5, resetsAt: 1900000000 },
    },
  },
});

const result = (structured_output, extra = {}) =>
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.5, structured_output, ...extra });

function commit(text) {
  const file = `hub-${process.env.HUB_TASK_ID}.txt`;
  // 같은 worktree에서 다시 돌아도 커밋할 변경이 생기게 매번 내용을 바꾼다.
  writeFileSync(file, `${text} ${Date.now()}\n`);
  execFileSync('git', ['add', file]);
  execFileSync('git', ['-c', 'user.email=hub@test', '-c', 'user.name=hub', 'commit', '-qm', `${process.env.HUB_TASK_ID}: ${text}`]);
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit' } }] } });
}

const schemaIdx = args.indexOf('--json-schema');

// 새 앱 기획 run (출력 스키마에 one_liner가 있다). 이번 요청에 "code:XX folder:yy"가 있으면 그 값을 제안한다.
if (schemaIdx >= 0 && args[schemaIdx + 1].includes('"one_liner"')) {
  const note = (/## 이번 요청\n(.*)/.exec(prompt) || [])[1] || '';
  const revise = /## 수정 요청\n(.*)/.exec(prompt);
  const seed = /다음 후보를 깊게 기획한다: "([^"]+)"/.exec(prompt);
  const code = (/code:(\w+)/.exec(note) || [])[1] || 'NA';
  const folder = (/folder:([\w-]+)/.exec(note) || [])[1] || 'new-app';
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: '비슷한 서비스' } }] } });
  result({
    title: revise ? `수정됨: ${revise[1]}` : seed ? seed[1] : '새 앱',
    one_liner: `한 줄 소개 ${note}`.trim(),
    target_users: '1인 개발자',
    problem: '문제',
    solution: '해결',
    mvp_features: ['기능 A', '기능 B'],
    scenarios: ['시나리오'],
    mvp_spec: '# MVP',
    competitors: [{ name: '경쟁 서비스', url: 'https://example.com', difference: '더 단순하다' }],
    market: '시장 요약',
    monetization: '구독',
    tech_stack: 'Node',
    risks: ['리스크'],
    validation: '랜딩 페이지',
    app: { code, name: '새 앱', folder },
    expected_tasks: [
      { title: '프로젝트 뼈대', description: '실행되는 최소 앱', size: 'S' },
      { title: '핵심 기능', description: '기능 A', size: 'M', depends_on_index: [0] },
    ],
    alternatives: [{ title: '다른 후보', one_liner: '다른 한 줄' }],
    sources: ['https://example.com'],
  });
  return;
}

// 아이디어 생성·수정 run (출력 스키마에 proposal이 있다)
if (schemaIdx >= 0 && args[schemaIdx + 1].includes('"proposal"')) {
  if (prompt.includes('IDEA_FAIL')) process.exit(1);
  const revise = /## 수정 요청\n(.*)/.exec(prompt);
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } });
  result({
    title: revise ? `수정됨: ${revise[1]}` : '자동 기획',
    problem: '문제',
    proposal: '제안',
    scenarios: ['시나리오'],
    spec: '# 명세',
    impact: '영향 없음',
    expected_tasks: [
      { title: '첫 task', description: '완료 조건 A', size: 'S' },
      { title: '둘째 task', description: '완료 조건 B', size: 'M', depends_on_index: [0, 5] },
    ],
  });
  return;
}

if (prompt.includes('LIMIT')) {
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1900000000 } });
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'usage limit reached' });
  process.exit(1);
}

if (prompt.includes('SLOW')) {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: '오래 걸리는 작업' }] } });
  process.on('SIGINT', () => process.exit(130));
  setTimeout(() => process.exit(0), 30000);
  return;
}

if (prompt.includes('NOCOMMIT')) {
  result({ status: 'done', summary: '커밋을 잊었다' });
  return;
}

if (prompt.includes('ASK_FIRST') && resumeIdx < 0) {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: '언어를 정해야 한다. secret token=abcdef123456' }] } });
  result({ status: 'needs_input', summary: '언어가 필요', question: '어느 언어로 쓸까?' });
  return;
}

commit(resumeIdx >= 0 ? `answer ${prompt.split('\n')[1]}` : 'done');
result({ status: 'done', summary: '구현하고 테스트를 통과했다' });
