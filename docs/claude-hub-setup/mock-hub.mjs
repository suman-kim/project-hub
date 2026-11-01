// 테스트용 가짜 Hub. 진짜 Hub를 만들기 전에 hook 연결이 되는지 확인하는 용도다.
// 의존성 없음 (Node 18 이상).
//
// 실행:  node mock-hub.mjs
//        GUARD=1 node mock-hub.mjs   -> task 없는 세션의 파일 수정을 막는다
//        PORT=2424 HUB_TOKEN=비밀값 node mock-hub.mjs
//
// 브라우저에서 http://127.0.0.1:2424 을 열면 등록된 세션과 최근 이벤트가 보인다.
// 아래 APPS, TASKS, MISTAKES는 샘플 데이터다. 진짜 Hub에서는 DB에서 읽는다.

import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT || 2424);
const TOKEN = process.env.HUB_TOKEN || '';
const GUARD = process.env.GUARD === '1';

// 저장소 폴더 이름 -> 앱. 실제 폴더 이름에 맞게 고칠 것.
const APPS = {
  chat: { code: 'LK', name: 'Link' },
  'daily-work': { code: 'HR', name: '하루알바' },
  'cyphers-meta': { code: 'CM', name: 'cyphers-meta' },
  'today-alba': { code: 'OA', name: '오늘알바' },
};

const TASKS = {
  'LK-57': { title: '음성방 마이크 프리뷰 화면', status: 'doing', spec: 'idea-lk-mic' },
  'LK-58': { title: '음성방 퇴장 시 미디어 리소스 정리', status: 'todo', spec: 'idea-lk-mic' },
  'HR-19': { title: '공고 지원 취소 API', status: 'todo' },
  'HR-21': { title: '구인 공고 필터 API 리팩터링', status: 'doing' },
  'CM-33': { title: '연도별 집계 배치 작업', status: 'doing', spec: 'idea-cm-yearly' },
  'CM-34': { title: '전년 대비 폼 비교 카드 UI', status: 'todo', spec: 'idea-cm-yearly' },
  'OA-08': { title: 'SMS 인증 연동', status: 'review' },
  'OA-09': { title: 'SMS 재전송 1분 제한', status: 'todo' },
};

const MISTAKES = {
  LK: [
    '위젯 테스트에서 LiveKit 클라이언트를 실제로 초기화해 테스트가 멈춘 적이 있다. 테스트에서는 fake 클라이언트를 주입한다.',
    'iOS Info.plist의 마이크 권한 문구를 빠뜨려 빌드가 거절된 적이 있다.',
  ],
  HR: ['TypeORM 마이그레이션 없이 엔티티만 바꿔 운영 DB와 어긋난 적이 있다. 엔티티를 바꾸면 마이그레이션을 같이 만든다.'],
  CM: ['Neople API 호출 한도를 넘겨 배치가 중간에 실패한 적이 있다. 호출 사이에 지연을 둔다.'],
  OA: [],
};

const sessions = new Map(); // session_id -> { app, task, cwd, source, startedAt }
const events = []; // 최근 이벤트 (최대 200개)

function detectApp(cwd) {
  // worktree가 저장소 안 하위 폴더에 있어도 찾도록 경로의 모든 조각을 본다.
  const parts = String(cwd || '').split(path.sep);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (APPS[parts[i]]) return APPS[parts[i]];
  }
  return null;
}

function contextFor(s) {
  const lines = ['[Hub context]'];
  if (!s.app) {
    lines.push(`이 작업 폴더(${s.cwd})는 Hub에 등록된 앱이 아니다.`);
    return lines.join('\n');
  }
  lines.push(`앱: ${s.app.name} (${s.app.code})`);
  lines.push(`세션 시작 방식: ${s.source}`);

  const t = s.task ? TASKS[s.task] : null;
  if (t) {
    lines.push(`이 세션의 task: #${s.task} ${t.title} (상태: ${t.status})`);
    if (t.spec) lines.push(`이 task의 기획 명세가 Hub에 있다. spec id: ${t.spec}`);
  } else {
    lines.push('이 세션에 연결된 task는 아직 없다.');
  }

  const open = Object.entries(TASKS)
    .filter(([id, x]) => id.startsWith(`${s.app.code}-`) && x.status !== 'done' && id !== s.task)
    .slice(0, 5);
  if (open.length) {
    lines.push('이 앱의 다른 열린 task:');
    for (const [id, x] of open) lines.push(`- #${id} ${x.title} (${x.status})`);
  }

  const ms = MISTAKES[s.app.code] || [];
  if (ms.length) {
    lines.push('이 앱에서 기록된 실수:');
    for (const m of ms.slice(0, 5)) lines.push(`- ${m}`);
  }
  return lines.join('\n');
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function log(kind, input, extra = '') {
  const line = `${new Date().toLocaleTimeString()} ${input.hook_event_name || kind} ${String(input.session_id || '').slice(0, 8)} ${input.tool_name || ''} ${extra}`.trim();
  events.push(line);
  if (events.length > 200) events.shift();
  console.log(line);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    const rows = [...sessions.entries()].map(([id, s]) => `${id.slice(0, 8)}  ${s.app ? s.app.code : '-'}  task=${s.task || '-'}  ${s.cwd}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Mock Hub (guard ${GUARD ? 'on' : 'off'})\n\n[sessions]\n${rows.join('\n') || '(없음)'}\n\n[events]\n${events.slice(-50).join('\n')}\n`);
    return;
  }

  if (TOKEN && req.headers['x-hub-token'] !== TOKEN) {
    res.writeHead(401).end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }

  const input = await readBody(req);
  const sessionId = input.session_id || 'unknown';

  if (url.pathname === '/api/hooks/session-start') {
    const prev = sessions.get(sessionId);
    const s = {
      app: detectApp(input.cwd),
      task: url.searchParams.get('task') || (prev && prev.task) || '',
      cwd: input.cwd || '',
      source: input.source || 'startup',
      startedAt: prev ? prev.startedAt : Date.now(),
    };
    sessions.set(sessionId, s);
    log('SessionStart', input, `app=${s.app ? s.app.code : '-'} task=${s.task || '-'}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(contextFor(s));
    return;
  }

  if (url.pathname === '/api/hooks/pre-tool-use') {
    const s = sessions.get(sessionId);
    const blocked = GUARD && s && s.app && !s.task;
    log('PreToolUse', input, blocked ? 'DENY' : 'ok');
    if (!blocked) {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '이 세션에 연결된 Hub task가 없어서 파일 수정을 막았다. 먼저 task를 지정하거나 create_tasks로 만든 뒤 다시 시도한다.',
      },
    }));
    return;
  }

  if (url.pathname === '/api/hooks/event') {
    log('event', input);
    if (input.hook_event_name === 'SessionEnd') sessions.delete(sessionId);
    res.writeHead(204).end();
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock Hub: http://127.0.0.1:${PORT}  (guard ${GUARD ? 'on' : 'off'})`);
});
