import { canTransitionRun, canTransitionTask } from '@hub/shared';
import { redactDeep, redactText } from './common/redact';
import { matchAppByPath } from './modules/apps/apps.service';
import { currentMonth, summarizeCosts } from './modules/costs/costs.service';
import { buildContext, ContextInput } from './modules/context/build-context';
import { parseFrontmatter, parseMcpList } from './modules/environment/parse';
import { cleanFileName, contentDisposition, contentTypeOf, fileKindOf } from './modules/mine/doc-files';
import { SecretBox } from './modules/mine/secret-box';
import { renderSpecFile, specFileName } from './modules/knowledge/spec-file';
import { BRIEF_MAX, renderTaskBrief } from './modules/knowledge/task-brief';
import { QUIET_MS, sessionState, summarizeHookInput } from './modules/sessions/sessions.service';
import { deliveryOf, hubQuote } from './modules/sessions/hub-message';
import { TranscriptChat } from './modules/sessions/transcript';
import { composeDescription, mapTmStatus, parseTaskmasterFile } from './modules/tasks/taskmaster-import';

describe('task 상태 전이', () => {
  it.each([
    ['todo', 'doing'],
    ['doing', 'input'],
    ['input', 'doing'],
    ['input', 'review'],
    ['doing', 'review'],
    ['review', 'done'],
    ['done', 'cancelled'],
    ['todo', 'cancelled'],
    ['doing', 'doing'],
  ] as const)('%s → %s 허용', (from, to) => expect(canTransitionTask(from, to)).toBe(true));

  it.each([
    ['todo', 'review'],
    ['todo', 'done'],
    ['doing', 'done'],
    ['review', 'doing'],
    ['done', 'todo'],
    ['cancelled', 'todo'],
  ] as const)('%s → %s 거부', (from, to) => expect(canTransitionTask(from, to)).toBe(false));

  it('run 전이', () => {
    expect(canTransitionRun('queued', 'running')).toBe(true);
    expect(canTransitionRun('input', 'running')).toBe(true);
    expect(canTransitionRun('done', 'running')).toBe(false);
  });
});

describe('작업 폴더 → 앱 판별', () => {
  const apps = [
    { code: 'LK', folderNames: ['link'] },
    { code: 'CM', folderNames: ['cyphers-meta'] },
  ];
  it('저장소 하위 폴더', () => expect(matchAppByPath(apps, '/Users/me/project/link/backend/src')?.code).toBe('LK'));
  it('worktree 경로', () => expect(matchAppByPath(apps, '/Users/me/.hub/worktrees/cyphers-meta/CM-3')?.code).toBe('CM'));
  it('가장 안쪽 이름이 우선', () => expect(matchAppByPath(apps, '/x/link/vendor/cyphers-meta')?.code).toBe('CM'));
  it('등록되지 않은 폴더', () => expect(matchAppByPath(apps, '/Users/me/project/other')).toBeNull());
  it('폴더 이름이 달라도 앱 폴더 안이면 그 앱', () => {
    const withPath = [...apps, { code: 'OA', folderNames: ['today-alba'], repoPath: '/Users/me/project/daily-work/' }];
    expect(matchAppByPath(withPath, '/Users/me/project/daily-work/lib')?.code).toBe('OA');
    expect(matchAppByPath(withPath, '/Users/me/project/daily-work-old')).toBeNull();
  });
});

describe('Hub 문서 사본 파일', () => {
  it('번호 네 자리와 글자·숫자만 남긴 제목', () => {
    expect(specFileName(4, '인수인계: task 100% 강제 (가드)')).toBe('0004-인수인계-task-100-강제-가드.md');
    expect(specFileName(12, '!!!')).toBe('0012-doc.md');
  });

  it('머리에 출처, 본문이 제목으로 시작하지 않으면 제목을 넣는다', () => {
    const base = { id: 4, kind: 'handoff', title: '인수인계', taskId: 'HB-1', ideaId: null, updatedAt: new Date('2026-10-29T07:00:00Z') };
    const text = renderSpecFile({ ...base, body: '## 한 일\n- 가드' });
    expect(text).toContain('Hub 문서 #4의 사본');
    expect(text).toContain('# 인수인계\n\n> 인수인계 · task HB-1 · 2026-10-29 16:00 저장');
    expect(text.endsWith('## 한 일\n- 가드\n')).toBe(true);
    expect(renderSpecFile({ ...base, body: '# 이미 제목' })).not.toContain('# 인수인계');
  });
});

describe('세션 상태 짐작', () => {
  const now = Date.parse('2026-10-29T08:00:00Z');
  const at = (msAgo: number) => new Date(now - msAgo);
  const base = { endedAt: null, startedAt: at(3_600_000) };
  it('턴이 끝났거나 막 시작했으면 입력 대기', () => {
    expect(sessionState({ ...base, lastEvent: 'Stop', lastAt: at(86_400_000) }, now)).toBe('idle');
    expect(sessionState({ ...base, lastEvent: 'SessionStart', lastAt: at(1000) }, now)).toBe('idle');
    expect(sessionState({ ...base, lastEvent: null, lastAt: null }, now)).toBe('idle');
  });
  it('메시지·도구 기록 뒤면 일하는 중, 오래 조용하면 quiet, 끝남 기록이 있으면 ended', () => {
    expect(sessionState({ ...base, lastEvent: 'PostToolUse', lastAt: at(60_000) }, now)).toBe('working');
    expect(sessionState({ ...base, lastEvent: 'UserPromptSubmit', lastAt: at(QUIET_MS + 1) }, now)).toBe('quiet');
    expect(sessionState({ ...base, endedAt: at(0), lastEvent: 'SessionEnd', lastAt: at(0) }, now)).toBe('ended');
  });
});

describe('대화 기록 → 대화 화면', () => {
  const rows = [
    { type: 'user', isMeta: true, uuid: 'm', message: { content: '<local-command-caveat>…</local-command-caveat>' } },
    { type: 'user', uuid: 'c', timestamp: 't0', message: { content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } },
    { type: 'user', uuid: 'u1', timestamp: 't1', message: { content: '테스트 고쳐 줘 TOKEN=abcdef123456' } },
    { type: 'assistant', uuid: 'a0', message: { id: 'msg1', content: [{ type: 'thinking', thinking: '...' }] }, apiBlockIndex: 0 },
    { type: 'assistant', uuid: 'a1', timestamp: 't2', message: { id: 'msg1', content: [{ type: 'text', text: '고치겠습니다.' }] }, apiBlockIndex: 1 },
    { type: 'assistant', uuid: 'a2', timestamp: 't2', message: { id: 'msg1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'pnpm test', description: '테스트' } }] }, apiBlockIndex: 2 },
    { type: 'user', uuid: 'r1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '1 failed' }], is_error: true }] } },
    { type: 'attachment', uuid: 'q1', timestamp: 't3', attachment: { type: 'queued_command', origin: { kind: 'human' }, prompt: [{ type: 'image' }, { type: 'text', text: '이것도 봐 줘' }] } },
    { type: 'attachment', uuid: 'q2', attachment: { type: 'queued_command', origin: { kind: 'task-notification' }, prompt: '<task-notification>…' } },
    { type: 'user', uuid: 'n1', origin: { kind: 'task-notification' }, message: { content: '<task-notification>…' } },
    { type: 'assistant', uuid: 's1', isSidechain: true, message: { id: 'side', content: [{ type: 'text', text: '하위 에이전트' }] } },
    { type: 'assistant', uuid: 'a1-dup', message: { id: 'msg1', content: [{ type: 'text', text: '고치겠습니다.' }] }, apiBlockIndex: 1 },
  ];

  it('사람 메시지, 슬래시 명령, Claude 답변, 도구와 결과만 남기고 비밀값은 가린다', () => {
    const c = new TranscriptChat();
    rows.forEach((r) => c.add(r));
    expect(c.items.map((i) => (i.kind === 'tool' ? `tool:${i.name}:${i.summary}:${i.result}:${i.error}` : `${i.kind}:${'text' in i ? i.text : ''}`))).toEqual([
      'note:/clear 실행',
      'user:테스트 고쳐 줘 TOKEN=[REDACTED]',
      'assistant:고치겠습니다.',
      'tool:Bash:pnpm test:1 failed:true',
      'user:이것도 봐 줘',
    ]);
    expect(c.items[4]).toMatchObject({ kind: 'user', images: 1, from: 'me', at: 't3' });
  });

  it('대시보드 메시지 인용 줄은 Claude 답변에서 뺀다(사용자 말풍선으로 보여 준다)', () => {
    const c = new TranscriptChat();
    c.add({ type: 'assistant', uuid: 'h1', message: { id: 'm2', content: [{ type: 'text', text: '> 📨 Hub 메시지: 테스트도 / 문서도\n\n둘 다 하겠습니다.' }] }, apiBlockIndex: 0 });
    c.add({ type: 'assistant', uuid: 'h2', message: { id: 'm3', content: [{ type: 'text', text: '> 📨 Hub에서 보낸 메시지: 끝' }] }, apiBlockIndex: 0 });
    expect(c.items.map((i) => ('text' in i ? i.text : ''))).toEqual(['둘 다 하겠습니다.']);
  });
});

describe('대시보드 메시지 전달 글', () => {
  it('짧은 메시지는 인용 줄에 전부, 긴 메시지는 첫 줄과 줄 수만 싣는다. CLI 알림에는 본문을 보여 준다', () => {
    expect(hubQuote('테스트도\n문서도')).toBe('> 📨 Hub에서 보낸 메시지: 테스트도 / 문서도');
    expect(hubQuote(`Hub task LK-3를 진행해 줘.\n\n${'줄\n'.repeat(20)}`)).toBe('> 📨 Hub에서 보낸 메시지: Hub task LK-3를 진행해 줘. (전체 21줄)');
    const d = deliveryOf([{ id: 9, text: '둘째' }, { id: 8, text: '첫째' }]);
    expect(d.context.indexOf('[Hub 메시지 #8]')).toBeLessThan(d.context.indexOf('[Hub 메시지 #9]'));
    expect(d.context).toContain('\n> 📨 Hub에서 보낸 메시지: 첫째\n메시지:\n첫째');
    expect(d.display).toBe('📨 Hub에서 보낸 메시지 #8\n첫째\n\n📨 Hub에서 보낸 메시지 #9\n둘째');
  });
});

describe('세션 맥락', () => {
  const base: ContextInput = {
    cwd: '/p/link',
    source: 'startup',
    app: { code: 'LK', name: 'Link' },
    unknownTaskId: null,
    task: { id: 'LK-57', title: '마이크 프리뷰', status: 'doing', specs: [{ id: 3, kind: 'spec', title: '음성방 기획' }] },
    openTasks: [{ id: 'LK-58', title: '리소스 정리', status: 'todo' }],
    mistakes: [{ what: '실제 클라이언트 초기화', correctWay: 'fake 주입' }],
  };

  it('앱 → task → 열린 task → 실수 순서', () => {
    const text = buildContext(base, 8000);
    expect(text.startsWith('[Hub context]\n앱: Link (LK)')).toBe(true);
    const order = ['이 세션의 task: LK-57', 'spec id 3', 'LK-58', '실제 클라이언트 초기화'].map((s) => text.indexOf(s));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]))).toBe(true);
  });

  it('상한을 넘으면 뒤에서부터 자른다', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ what: `실수 ${i} ${'x'.repeat(300)}`, correctWay: 'y' }));
    const text = buildContext({ ...base, mistakes: many }, 2000);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain('이 세션의 task: LK-57');
    expect(text).not.toContain('실수 49');
  });

  it('등록되지 않은 폴더', () => {
    expect(buildContext({ ...base, app: null }, 8000)).toBe('[Hub context]\n이 작업 폴더(/p/link)는 Hub에 등록된 앱이 아니다.');
    expect(buildContext({ ...base, app: null, guard: 'register' }, 8000)).toContain('등록되기 전에는 파일 수정과 Bash가 막힌다');
  });

  it('가드가 켜진 앱에서 진행 중인 task가 없으면 막힌다고 알린다', () => {
    const text = buildContext({ ...base, task: null, guard: 'task' }, 8000);
    expect(text).toContain('이 세션에 연결된 task는 아직 없다.\n진행 중인 task가 연결되기 전에는 파일 수정과 Bash가 막힌다');
    expect(buildContext(base, 8000)).not.toContain('막힌다');
  });

  it('DB에 없는 HUB_TASK_ID', () => {
    expect(buildContext({ ...base, task: null, unknownTaskId: 'LK-999' }, 8000)).toContain('LK-999는 Hub에 없는 task');
  });
});

describe('Task Master 가져오기 변환', () => {
  it('태그 형식과 예전 형식', () => {
    expect(parseTaskmasterFile({ master: { tasks: [{ id: 1, title: 'a' }] }, feat: { tasks: [] } }).map((t) => t.tag)).toEqual([
      'master',
      'feat',
    ]);
    expect(parseTaskmasterFile({ tasks: [{ id: 1, title: 'a' }] })[0].tag).toBe('master');
  });
  it('상태', () => {
    expect(mapTmStatus('pending')).toBe('todo');
    expect(mapTmStatus('in-progress')).toBe('doing');
    expect(mapTmStatus('deferred')).toBe('todo');
    expect(mapTmStatus('weird')).toBe('todo');
  });
  it('설명 합치기', () => {
    expect(composeDescription({ id: 1, title: 't', description: 'd', details: 'x', testStrategy: 'y' })).toBe(
      'd\n\n## 상세\n\nx\n\n## 테스트 전략\n\ny',
    );
  });
});

describe('비밀값 가리기', () => {
  it('키 패턴', () => {
    expect(redactText('key sk-ant-abcdefghijklmnopqrstuvwxyz')).toBe('key [REDACTED]');
    expect(redactText('GITHUB ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('GITHUB [REDACTED]');
    expect(redactText('DB_PASSWORD=supersecret1')).toBe('DB_PASSWORD=[REDACTED]');
  });
  it('중첩 객체', () => {
    expect(redactDeep({ tool_input: { command: 'export API_KEY=abcdef123456' } })).toEqual({
      tool_input: { command: 'export API_KEY=[REDACTED]' },
    });
  });
});

describe('hook 요약', () => {
  it('도구 사용', () => {
    expect(summarizeHookInput({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm   test' } })).toBe(
      'Bash pnpm test',
    );
  });
});

describe('비용 집계', () => {
  it('이번 달은 서울 시간 기준', () => {
    expect(currentMonth(new Date('2026-09-30T14:59:00Z'))).toBe('2026-09');
    expect(currentMonth(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10');
  });

  it('앱이 없는 run은 appCode null로 묶는다', () => {
    const s = summarizeCosts('2026-10', [
      { appCode: null, kind: 'implement', date: '2026-10-02', costUsd: 0.1, runs: 1 },
      { appCode: 'LK', kind: 'implement', date: '2026-10-01', costUsd: 0.30006, runs: 2 },
    ]);
    expect(s.costUsd).toBe(0.4001);
    expect(s.byApp).toEqual([
      { appCode: 'LK', costUsd: 0.3001, runs: 2 },
      { appCode: null, costUsd: 0.1, runs: 1 },
    ]);
    expect(s.byDay.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']);
  });
});

describe('task 정보 글', () => {
  const task = (over: Record<string, unknown> = {}) =>
    ({
      id: 'LK-3', title: '로그인', description: '설명', status: 'doing', type: 'bug', size: 'S', stage: 'develop', priority: 1, branch: null, prUrl: null, ideaId: 4,
      app: { code: 'LK', name: 'Link', repoPath: '/p/link', stages: [{ key: 'develop', name: '개발' }] },
      metadata: { bug: { severity: 'high', steps: '1. 누른다' } },
      ...over,
    }) as never;
  const spec = (id: number, body: string) => ({ id, kind: 'spec', title: `문서${id}`, body }) as never;

  it('선행 task, 버그 정보, 출처 기획을 싣고 긴 문서는 앞부분만 싣는다', () => {
    const text = renderTaskBrief({ task: task(), repo: null, deps: [{ id: 'LK-1', title: '앞 일', status: 'done' }], specs: [spec(7, 'a'.repeat(3000))] });
    expect(text).toContain('- 앱: Link (LK) · 폴더 /p/link');
    expect(text).toContain('- 상태: 진행 중 · 종류 버그 · 크기 S · 단계 개발 · 우선순위 높음');
    expect(text).toContain('- 출처 기획: #4');
    expect(text).toContain('- 재현 단계: 1. 누른다');
    expect(text).toContain('- LK-1 앞 일 (완료)');
    expect(text).toContain('(앞부분만 실었다 · 전문은 get_spec 7)');
  });

  it('전체가 길면 잘라서 get_task로 안내한다', () => {
    const text = renderTaskBrief({ task: task({ description: 'b'.repeat(BRIEF_MAX * 2) }), repo: { name: 'web', path: '/p/link/web' }, deps: [], specs: [] });
    expect(text.length).toBeLessThanOrEqual(BRIEF_MAX);
    expect(text).toContain('저장소 web (/p/link/web)');
    expect(text.endsWith('…(길어서 잘랐다 · get_task LK-3)')).toBe(true);
  });
});

describe('환경 화면 파서', () => {
  it('SKILL.md 앞머리: 한 줄, 따옴표, 접는 블록', () => {
    const fm = parseFrontmatter('---\nname: cyphers-api\ndescription: >-\n  사이퍼즈 데이터를\n  조회한다.\nallowed: "a, b"\n---\n\n# 본문');
    expect(fm).toEqual({ name: 'cyphers-api', description: '사이퍼즈 데이터를 조회한다.', allowed: 'a, b' });
    expect(parseFrontmatter('# 앞머리 없음')).toEqual({});
  });

  it('claude mcp list: claude.ai 커넥터, 플러그인 MCP, 직접 추가한 MCP와 상태', () => {
    const out = [
      'Checking MCP server health…',
      '',
      'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected',
      'claude.ai Canva: https://mcp.canva.com/mcp - ! Needs authentication',
      'plugin:desktop-commander:desktop-commander: npx -y @wonderwhy-er/desktop-commander@latest - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed',
      'plugin:sales:google calendar:  (HTTP) - - Not configured',
      'hub: http://127.0.0.1:2424/mcp (HTTP) - ✔ Connected',
    ].join('\n');
    expect(parseMcpList(out)).toEqual([
      { name: 'Gmail', source: 'claude_ai', plugin: null, target: 'https://gmailmcp.googleapis.com/mcp/v1', status: 'connected', detail: null, ko: null },
      { name: 'Canva', source: 'claude_ai', plugin: null, target: 'https://mcp.canva.com/mcp', status: 'needs_auth', detail: null, ko: null },
      { name: 'desktop-commander', source: 'plugin', plugin: 'desktop-commander', target: 'npx -y @wonderwhy-er/desktop-commander@latest', status: 'failed', detail: 'CONNECTION_CLOSED: Connection closed', ko: null },
      { name: 'google calendar', source: 'plugin', plugin: 'sales', target: '(HTTP)', status: 'not_configured', detail: null, ko: null },
      { name: 'hub', source: 'local', plugin: null, target: 'http://127.0.0.1:2424/mcp (HTTP)', status: 'connected', detail: null, ko: null },
    ]);
  });
});

describe('내 업무 키 값 암호화', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync, statSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('node:os') as typeof import('node:os');

  it('처음 저장할 때 0600 키 파일을 만들고, 같은 키로만 푼다. 고친 암호문은 풀리지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-secret-'));
    const file = join(dir, 'secret.key');
    const box = new SecretBox(file);
    const sealed = box.seal('a7f3c1e9b24d40f8');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('a7f3c1e9');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(new SecretBox(file).open(sealed)).toBe('a7f3c1e9b24d40f8');
    expect(box.seal('a7f3c1e9b24d40f8')).not.toBe(sealed);

    const [iv, tag, enc] = sealed.slice(3).split('.');
    const flipped = Buffer.from(enc, 'base64');
    flipped[0] ^= 1;
    expect(() => box.open(`v1:${iv}.${tag}.${flipped.toString('base64')}`)).toThrow();

    const other = join(dir, 'other.key');
    writeFileSync(other, Buffer.alloc(32, 7).toString('base64'));
    expect(() => new SecretBox(other).open(sealed)).toThrow();
    expect(() => new SecretBox(join(dir, 'none.key')).open(sealed)).toThrow('암호 키 파일');
  });
});

describe('내 업무 첨부 파일', () => {
  it('확장자로 보기 방식을 정한다. svg와 모르는 확장자는 내려받기만', () => {
    expect(['a.PDF', 'b.md', 'c.markdown', 'd.txt', 'e.json', 'f.png', 'g.JPEG', 'h.svg', 'i.zip', 'noext'].map(fileKindOf)).toEqual(['pdf', 'md', 'md', 'text', 'text', 'image', 'image', 'other', 'other', 'other']);
    expect(contentTypeOf('a.md', 'md')).toBe('text/plain; charset=utf-8');
    expect(contentTypeOf('a.webp', 'image')).toBe('image/webp');
    expect(contentTypeOf('a.html', 'other')).toBe('application/octet-stream');
  });

  it('이름은 폴더·제어 문자를 빼고 NFC로, 길면 확장자를 남기고 자른다', () => {
    expect(cleanFileName(`C:\\temp\\${'계약서'.normalize('NFD')}.pdf`)).toBe('계약서.pdf');
    expect(cleanFileName('  a\u0000b\n.txt ')).toBe('ab.txt');
    expect(cleanFileName('../')).toBe('');
    const long = cleanFileName(`${'가'.repeat(300)}.pdf`);
    expect(long).toHaveLength(200);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('Content-Disposition은 한글 이름을 filename*로, filename에는 ASCII만', () => {
    expect(contentDisposition('견적 "v2".pdf', true)).toBe(`attachment; filename="__ _v2_.pdf"; filename*=UTF-8''${encodeURIComponent('견적 "v2".pdf')}`);
    expect(contentDisposition("Suman's (1).pdf", true)).toContain("filename*=UTF-8''Suman%27s%20%281%29.pdf");
    expect(contentDisposition('a.md', false).startsWith('inline; ')).toBe(true);
  });
});
