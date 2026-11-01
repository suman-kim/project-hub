import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';

const TOKEN = 'test-token';
process.env.HUB_TOKEN = TOKEN;
// 진짜 ~/.claude(규칙 파일, 토큰)를 건드리지 않게 한다.
process.env.HUB_CLAUDE_HOME = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'hub-claude-'));
process.env.HUB_DATABASE_URL = process.env.HUB_TEST_DATABASE_URL || 'postgres://hub:hub@127.0.0.1:5434/hub_test';
// 빌드한 대시보드 대신 쓸 파일
const webDist = mkdtempSync(join(tmpdir(), 'hub-web-'));
mkdirSync(join(webDist, 'assets'));
writeFileSync(join(webDist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(webDist, 'assets', 'index-abc.js'), 'console.log(1)');
process.env.HUB_WEB_DIST = webDist;

// 환경변수를 먼저 정한 뒤 불러와야 설정에 반영된다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureApp } = require('../src/bootstrap');

describe('Hub e2e', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let baseUrl: string;
  let repo: string;
  const auth = { 'X-Hub-Token': TOKEN };

  beforeAll(async () => {
    // 매번 빈 스키마에서 마이그레이션부터 돌린다.
    const reset = new DataSource({ type: 'postgres', url: process.env.HUB_DATABASE_URL });
    await reset.initialize();
    await reset.query('DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const addr = app.getHttpServer().address() as import("node:net").AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    http = request(app.getHttpServer());

    const root = mkdtempSync(join(tmpdir(), 'hub-e2e-'));
    repo = join(root, 'link');
    mkdirSync(join(repo, '.taskmaster', 'tasks'), { recursive: true });
    writeFileSync(
      join(repo, '.taskmaster', 'tasks', 'tasks.json'),
      JSON.stringify({
        master: {
          tasks: [
            { id: 2, title: '두 번째', status: 'in-progress', dependencies: [1] },
            { id: 1, title: '첫 번째', description: '설명', details: '상세', status: 'done' },
            { id: 3, title: '세 번째', status: 'deferred', dependencies: [1, 2], subtasks: [{ id: 1, title: 'sub' }] },
            { id: 6, title: '번호가 빈 다음', status: 'pending' },
          ],
        },
        feature: { tasks: [{ id: 1, title: '다른 태그의 1번', status: 'pending' }] },
      }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('M0 기반', () => {
    it('health는 토큰 없이 200', () => http.get('/health').expect(200, { ok: true }));
    it('토큰이 없으면 401', () => http.get('/api/apps').expect(401));
    it('토큰이 틀리면 401', () => http.get('/api/apps').set('X-Hub-Token', 'nope').expect(401));
    it('대시보드: 화면 주소는 index.html, 빌드 파일은 그대로, 서버 경로는 화면으로 돌리지 않는다', async () => {
      const html = { Accept: 'text/html,application/xhtml+xml' };
      const page = await http.get('/tasks/LK-1').set(html).expect(200);
      expect(page.text).toContain('<div id="root">');
      expect(page.headers['cache-control']).toBe('no-cache');
      await http.get('/').set(html).expect(200).expect('Content-Type', /html/);
      // MCP 클라이언트의 OAuth 찾기와 브라우저가 아닌 요청은 화면으로 돌리지 않는다.
      await http.get('/.well-known/oauth-protected-resource').set(html).expect(404).expect('Content-Type', /json/);
      await http.get('/.well-known/oauth-authorization-server').expect(404).expect('Content-Type', /json/);
      await http.get('/tasks/LK-1').set('Accept', 'application/json').expect(404);
      const asset = await http.get('/assets/index-abc.js').expect(200);
      expect(asset.headers['cache-control']).toContain('immutable');
      await http.get('/api/nope').expect(404).expect('Content-Type', /json/);
      await http.get('/health').expect(200, { ok: true });
    });
  });

  describe('M1 앱·task', () => {
    it('앱 등록', async () => {
      await http
        .post('/api/apps')
        .set(auth)
        .send({ code: 'LK', name: 'Link', repoPath: repo, folderNames: ['link'], guardEnabled: true })
        .expect(201);
      await http.post('/api/apps').set(auth).send({ code: 'HR', name: '하루알바', folderNames: ['daily-work'] }).expect(201);
      await http.post('/api/apps').set(auth).send({ code: 'LK', name: 'dup' }).expect(409);
      await http.post('/api/apps').set(auth).send({ code: 'lk!', name: 'bad' }).expect(400);
    });

    it('Task Master 가져오기는 id 순서대로 채번하고 의존 관계를 옮긴다', async () => {
      const res = await http.post('/api/import/taskmaster').set(auth).send({ app: 'LK' }).expect(201);
      expect(res.body).toMatchObject({ imported: 5, skipped: 0 });

      const list = await http.get('/api/tasks?app=LK').set(auth).expect(200);
      expect(list.body.map((t: { id: string; title: string; status: string }) => [t.id, t.title, t.status])).toEqual([
        ['LK-1', '첫 번째', 'done'],
        ['LK-2', '두 번째', 'doing'],
        ['LK-3', '세 번째', 'todo'],
        ['LK-6', '번호가 빈 다음', 'todo'],
        ['LK-7', '다른 태그의 1번', 'todo'],
      ]);
      expect(list.body[4].tag).toBe('feature');
      expect(list.body[2].dependsOn).toEqual(['LK-1', 'LK-2']);
      expect(list.body[2].tag).toBe('master');
      expect(list.body[2].metadata.subtasks).toHaveLength(1);
      expect(list.body[0].description).toContain('## 상세');
    });

    it('다시 가져오면 건너뛴다', async () => {
      const res = await http.post('/api/import/taskmaster').set(auth).send({ app: 'LK' }).expect(201);
      expect(res.body).toMatchObject({ imported: 0, skipped: 5 });
    });

    it('저장소 밖 경로는 거부', () =>
      http.post('/api/import/taskmaster').set(auth).send({ app: 'LK', path: '../../etc/passwd' }).expect(400));

    it('task 생성과 상태 전이', async () => {
      const created = await http.post('/api/tasks').set(auth).send({ app: 'LK', title: '새 task', dependsOn: ['LK-1'] }).expect(201);
      expect(created.body).toMatchObject({ id: 'LK-8', status: 'todo', dependsOn: ['LK-1'] });

      await http.patch('/api/tasks/LK-8').set(auth).send({ status: 'review' }).expect(409);
      const doing = await http.patch('/api/tasks/LK-8').set(auth).send({ status: 'doing', note: '시작' }).expect(200);
      expect(doing.body.metadata.notes[0]).toMatchObject({ status: 'doing', note: '시작' });

      const filtered = await http.get('/api/tasks?app=LK&status=doing').set(auth).expect(200);
      expect(filtered.body.map((t: { id: string }) => t.id)).toEqual(['LK-2', 'LK-8']);
    });

    it('없는 task 의존은 거부', () =>
      http.post('/api/tasks').set(auth).send({ app: 'LK', title: 'x', dependsOn: ['LK-999'] }).expect(400));
  });

  describe('M2 hook 수신', () => {
    const cwd = () => join(repo, 'backend');

    it('session-start: 앱 판별, task 연결, 맥락', async () => {
      const res = await http
        .post('/api/hooks/session-start?kind=session-start&task=LK-8')
        .set(auth)
        .send({ session_id: 'sess-1', cwd: cwd(), source: 'startup', hook_event_name: 'SessionStart' })
        .expect(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('[Hub context]');
      expect(res.text).toContain('앱: Link (LK)');
      expect(res.text).toContain('이 세션의 task: LK-8 새 task (상태: doing)');
      expect(res.text).toContain('- LK-2 두 번째 (doing)');
      expect(res.text).not.toContain('LK-1 첫 번째');
    });

    it('resume이면 task 쿼리가 없어도 기존 연결을 쓴다', async () => {
      const res = await http
        .post('/api/hooks/session-start?kind=session-start&task=')
        .set(auth)
        .send({ session_id: 'sess-1', cwd: cwd(), source: 'resume' })
        .expect(200);
      expect(res.text).toContain('세션 시작 방식: resume');
      expect(res.text).toContain('이 세션의 task: LK-8');
    });

    it('등록되지 않은 폴더', async () => {
      const res = await http
        .post('/api/hooks/session-start?kind=session-start&task=')
        .set(auth)
        .send({ session_id: 'sess-x', cwd: '/tmp/nowhere', source: 'startup' })
        .expect(200);
      expect(res.text).toBe('[Hub context]\n이 작업 폴더(/tmp/nowhere)는 Hub에 등록된 앱이 아니다.');
    });

    it('pre-tool-use: task가 있으면 204', () =>
      http
        .post('/api/hooks/pre-tool-use?kind=pre-tool-use&task=')
        .set(auth)
        .send({ session_id: 'sess-1', cwd: cwd(), tool_name: 'Edit', tool_input: { file_path: 'a.ts' } })
        .expect(204));

    it('pre-tool-use: 가드가 켜진 앱에서 task 없는 세션은 deny', async () => {
      await http
        .post('/api/hooks/session-start?kind=session-start&task=')
        .set(auth)
        .send({ session_id: 'sess-2', cwd: cwd(), source: 'startup' })
        .expect(200);
      const res = await http
        .post('/api/hooks/pre-tool-use?kind=pre-tool-use&task=')
        .set(auth)
        .send({ session_id: 'sess-2', cwd: cwd(), tool_name: 'Write', tool_input: { file_path: 'a.ts' } })
        .expect(200);
      expect(res.body.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    });

    it('pre-tool-use: 가드가 꺼진 앱은 204', async () => {
      await http.patch('/api/apps/1').set(auth).send({ guardEnabled: false }).expect(200);
      await http
        .post('/api/hooks/pre-tool-use?kind=pre-tool-use&task=')
        .set(auth)
        .send({ session_id: 'sess-2', cwd: cwd(), tool_name: 'Write' })
        .expect(204);
    });

    it('event: 저장, 비밀값 가림, SessionEnd 처리', async () => {
      await http
        .post('/api/hooks/event?kind=event&task=')
        .set(auth)
        .send({ session_id: 'sess-1', cwd: cwd(), hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'TOKEN=abcdef123456 pnpm test' } })
        .expect(204);
      await http
        .post('/api/hooks/event?kind=event&task=')
        .set(auth)
        .send({ session_id: 'sess-1', cwd: cwd(), hook_event_name: 'SessionEnd', reason: 'exit' })
        .expect(204);
      // SessionStart 없이 처음 보는 세션
      await http
        .post('/api/hooks/event?kind=event&task=')
        .set(auth)
        .send({ session_id: 'sess-3', cwd: cwd(), hook_event_name: 'UserPromptSubmit', prompt: '안녕' })
        .expect(204);

      const ds = app.get(DataSource);
      const rows = await ds.query(
        `SELECT s.claude_session_id, s.ended_at, e.event, e.summary
           FROM session_events e JOIN sessions s ON s.id = e.session_id ORDER BY e.id`,
      );
      const bash = rows.find((r: { summary: string }) => r.summary.startsWith('Bash'));
      expect(bash.summary).toBe('Bash TOKEN=[REDACTED] pnpm test');
      expect(rows.find((r: { claude_session_id: string; event: string }) => r.event === 'SessionEnd').ended_at).not.toBeNull();
      expect(rows.some((r: { claude_session_id: string }) => r.claude_session_id === 'sess-3')).toBe(true);
    });

    describe('task 강제', () => {
      // 가드 시험용 앱. guardEnabled 없이 등록한다(다른 앱의 task 번호를 건드리지 않게 따로 둔다).
      const gdCwd = () => join(dirname(repo), 'guarded');
      const pre = (body: Record<string, unknown>, query = 'task=') =>
        http.post(`/api/hooks/pre-tool-use?kind=pre-tool-use&${query}`).set(auth).send(body);
      const statusCall = (sid: string, id: string) =>
        http
          .post('/api/hooks/event?kind=event&task=')
          .set(auth)
          .send({ session_id: sid, cwd: gdCwd(), hook_event_name: 'PostToolUse', tool_name: 'mcp__hub__update_task_status', tool_input: { id, status: 'doing' } })
          .expect(204);

      it('새 앱은 가드가 켜져 있다', async () => {
        const created = await http.post('/api/apps').set(auth).send({ code: 'GD', name: '가드', folderNames: ['guarded'] }).expect(201);
        expect(created.body.guardEnabled).toBe(true);
      });

      it('task가 없으면 Bash도 막고, 읽기 도구는 통과시킨다. 맥락에도 알린다', async () => {
        const ctx = await http
          .post('/api/hooks/session-start?kind=session-start&task=')
          .set(auth)
          .send({ session_id: 'sess-g1', cwd: gdCwd(), source: 'startup' })
          .expect(200);
        expect(ctx.text).toContain('진행 중인 task가 연결되기 전에는 파일 수정과 Bash가 막힌다');
        const res = await pre({ session_id: 'sess-g1', cwd: gdCwd(), tool_name: 'Bash', tool_input: { command: 'ls' } }).expect(200);
        expect(res.body.hookSpecificOutput.permissionDecision).toBe('deny');
        await pre({ session_id: 'sess-g1', cwd: gdCwd(), tool_name: 'Read' }).expect(204);
        await pre({ session_id: 'sess-g1', cwd: gdCwd(), tool_name: 'mcp__hub__create_tasks' }).expect(204);
      });

      it('Hub가 띄운 세션은 통과시킨다', async () => {
        await pre({ session_id: 'sess-g2', cwd: gdCwd(), tool_name: 'Bash' }, 'task=&run=12').expect(204);
        await pre({ session_id: 'sess-g2', cwd: gdCwd(), tool_name: 'Bash' }, 'task=HR-99&run=').expect(204);
      });

      it('update_task_status로 doing이 되면 세션에 연결되고, review로 넘기면 풀린다', async () => {
        const t = await http.post('/api/tasks').set(auth).send({ app: 'GD', title: '가드 시험' }).expect(201);
        const id = t.body.id as string;
        const bash = { session_id: 'sess-g1', cwd: gdCwd(), tool_name: 'Bash' };

        // 아직 todo라 연결하지 않는다(전이가 거부된 호출과 같다).
        await statusCall('sess-g1', id);
        await pre(bash).expect(200);

        await http.patch(`/api/tasks/${id}`).set(auth).send({ status: 'doing' }).expect(200);
        await statusCall('sess-g1', id.toLowerCase());
        await pre(bash).expect(204);
        // 다른 세션에는 연결되지 않는다.
        await pre({ ...bash, session_id: 'sess-g9' }).expect(200);

        // 대시보드에서 상태가 바뀌어도 진행 중이 아니면 막는다.
        await http.patch(`/api/tasks/${id}`).set(auth).send({ status: 'review' }).expect(200);
        await pre(bash).expect(200);
        await statusCall('sess-g1', id);
        const ds = app.get(DataSource);
        const [row] = await ds.query(`SELECT task_id FROM sessions WHERE claude_session_id = 'sess-g1'`);
        expect(row.task_id).toBeNull();
      });

      it('프로젝트 폴더 위치 안의 등록 안 된 폴더는 막고, 밖은 통과시킨다', async () => {
        const before = (await http.get('/api/settings/ideation').set(auth).expect(200)).body.projectRoot as string;
        const root = dirname(repo);
        await http.patch('/api/settings/ideation').set(auth).send({ projectRoot: root }).expect(200);
        try {
          const ctx = await http
            .post('/api/hooks/session-start?kind=session-start&task=')
            .set(auth)
            .send({ session_id: 'sess-g3', cwd: join(root, 'newbie', 'src'), source: 'startup' })
            .expect(200);
          expect(ctx.text).toContain('등록되기 전에는 파일 수정과 Bash가 막힌다');
          const res = await pre({ session_id: 'sess-g3', cwd: join(root, 'newbie', 'src'), tool_name: 'Write' }).expect(200);
          expect(res.body.hookSpecificOutput.permissionDecisionReason).toContain('이 폴더(newbie)는 Hub에 등록된 앱이 아니라서');
          await pre({ session_id: 'sess-g4', cwd: '/tmp/elsewhere', tool_name: 'Write' }).expect(204);
          // 등록된 앱 폴더는 그 앱의 가드를 따른다(LK는 위에서 가드를 껐다).
          await pre({ session_id: 'sess-g5', cwd: join(repo, 'src'), tool_name: 'Write' }).expect(204);
        } finally {
          await http.patch('/api/settings/ideation').set(auth).send({ projectRoot: before }).expect(200);
        }
      });
    });

    it('세션 탭: 진행 task, 시작한 쪽(나/Hub), 상태', async () => {
      // Hub가 띄운 세션은 run 번호가 같이 온다(이 DB에는 없는 run이라 연결은 하지 않는다).
      await http.post('/api/hooks/session-start?kind=session-start&task=&run=9999').set(auth).send({ session_id: 'sess-hub', cwd: cwd(), source: 'startup' }).expect(200);
      const ev = (body: Record<string, unknown>) => http.post('/api/hooks/event?kind=event&task=').set(auth).send({ session_id: 'sess-hub', cwd: cwd(), ...body }).expect(204);
      await ev({ hook_event_name: 'UserPromptSubmit', prompt: '테스트를 고쳐 줘' });
      await ev({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test' } });
      await ev({ hook_event_name: 'Stop' });

      const list = (await http.get('/api/apps/1/claude-sessions').set(auth).expect(200)).body;
      const by = (sid: string) => list.find((s: { claudeSessionId: string }) => s.claudeSessionId === sid);
      expect(by('sess-hub')).toMatchObject({ origin: 'hub', run: null, state: 'idle', open: true, lastPrompt: '테스트를 고쳐 줘', lastEvent: { event: 'Stop' } });
      expect(by('sess-1')).toMatchObject({ origin: 'local', task: { id: 'LK-8', status: 'doing' }, state: 'ended', open: false });
      expect(by('sess-3')).toMatchObject({ origin: 'local', task: null, state: 'working', open: true, lastPrompt: '안녕' });
      // 다른 앱 세션은 나오지 않는다.
      expect(by('sess-g1')).toBeUndefined();
    });

    it('앱을 등록하기 전에 시작한 세션은 등록 뒤 처음 오는 기록에서 앱이 채워진다', async () => {
      const dir = join(dirname(repo), 'late-app');
      const ev = (name: string) => http.post('/api/hooks/event?kind=event&task=').set(auth).send({ session_id: 'sess-late', cwd: dir, hook_event_name: name }).expect(204);
      await ev('UserPromptSubmit');
      const late = (await http.post('/api/apps').set(auth).send({ code: 'LA', name: '늦은 등록', folderNames: ['late-app'] }).expect(201)).body;
      expect((await http.get(`/api/apps/${late.id}/claude-sessions`).set(auth).expect(200)).body).toHaveLength(0);
      await ev('Stop');
      const list = (await http.get(`/api/apps/${late.id}/claude-sessions`).set(auth).expect(200)).body;
      expect(list.map((s: { claudeSessionId: string; state: string }) => `${s.claudeSessionId}:${s.state}`)).toEqual(['sess-late:idle']);
    });

    it('대화 보기: hook이 알려 준 대화 기록 파일을 대화 줄로, 전체 세션 목록에는 앱 코드가 붙는다', async () => {
      const projects = join(process.env.HUB_CLAUDE_HOME!, 'projects', '-x-link');
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, 'sess-chat.jsonl');
      const line = (o: unknown) => `${JSON.stringify(o)}\n`;
      writeFileSync(transcript, line({ type: 'user', uuid: 'u1', timestamp: '2026-10-29T07:00:00Z', message: { content: '안녕' } }));
      await http
        .post('/api/hooks/event?kind=event&task=')
        .set(auth)
        .send({ session_id: 'sess-chat', cwd: cwd(), hook_event_name: 'UserPromptSubmit', prompt: '안녕', transcript_path: transcript })
        .expect(204);
      const all = (await http.get('/api/sessions').set(auth).expect(200)).body;
      const view = all.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'sess-chat');
      expect(view).toMatchObject({ appCode: 'LK', origin: 'local', state: 'working' });

      const first = (await http.get(`/api/sessions/${view.id}/chat`).set(auth).expect(200)).body;
      expect(first).toMatchObject({ session: { id: view.id, appCode: 'LK' }, total: 1, missing: null, items: [{ kind: 'user', text: '안녕', from: 'me' }] });

      // 파일 끝에 붙은 줄만 이어 읽는다. 아직 줄바꿈이 없는 마지막 줄은 다음에 읽는다.
      const { appendFileSync } = await import('node:fs');
      appendFileSync(transcript, line({ type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'text', text: '반가워요' }] } }) + '{"type":"user","uuid":"u2","message":{"content":"반');
      const second = (await http.get(`/api/sessions/${view.id}/chat?limit=1`).set(auth).expect(200)).body;
      expect(second).toMatchObject({ total: 2, items: [{ kind: 'assistant', text: '반가워요' }] });
      appendFileSync(transcript, '쪽"}}\n');
      const third = (await http.get(`/api/sessions/${view.id}/chat`).set(auth).expect(200)).body;
      expect(third.items.map((i: { text: string }) => i.text)).toEqual(['안녕', '반가워요', '반쪽']);

      // projects 밖의 파일은 읽지 않는다.
      const outside = join(dirname(repo), 'evil.jsonl');
      writeFileSync(outside, line({ type: 'user', uuid: 'x', message: { content: '비밀' } }));
      await http
        .post('/api/hooks/event?kind=event&task=')
        .set(auth)
        .send({ session_id: 'sess-evil', cwd: cwd(), hook_event_name: 'Stop', transcript_path: outside })
        .expect(204);
      const evil = (await http.get('/api/sessions').set(auth).expect(200)).body.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'sess-evil');
      expect((await http.get(`/api/sessions/${evil.id}/chat`).set(auth).expect(200)).body).toMatchObject({ items: [], missing: expect.any(String) });
      await http.get('/api/sessions/999999/chat').set(auth).expect(404);
    });

    it('대시보드 메시지: 쌓아 두고 다음 hook 응답으로 한 번만 전달한다', async () => {
      const all = (await http.get('/api/sessions').set(auth).expect(200)).body;
      const chat = all.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'sess-chat');
      const ended = all.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'sess-1');
      const ev = (body: Record<string, unknown>) => http.post('/api/hooks/event?kind=event&task=').set(auth).send({ session_id: 'sess-chat', cwd: cwd(), ...body });

      await http.post(`/api/sessions/${chat.id}/messages`).set(auth).send({ text: '테스트도 같이 고쳐 줘' }).expect(201);
      let items = (await http.get(`/api/sessions/${chat.id}/chat`).set(auth).expect(200)).body.items;
      expect(items[items.length - 1]).toMatchObject({ kind: 'user', text: '테스트도 같이 고쳐 줘', delivery: 'pending' });

      // 하위 에이전트의 도구 사용에는 싣지 않는다.
      await ev({ hook_event_name: 'PostToolUse', tool_name: 'Read', agent_id: 'sub-1' }).expect(204);
      const res = await ev({ hook_event_name: 'PostToolUse', tool_name: 'Read' }).expect(200);
      expect(res.body.hookSpecificOutput).toMatchObject({ hookEventName: 'PostToolUse' });
      expect(res.body.hookSpecificOutput.additionalContext).toMatch(/^\[Hub 메시지 #\d+\] .*\n테스트도 같이 고쳐 줘$/s);
      // 사용자 화면: CLI에는 systemMessage로 보이고, Claude는 답 첫 줄에 인용 줄을 쓴다.
      expect(res.body.systemMessage).toMatch(/^📨 Hub에서 보낸 메시지 #\d+\n테스트도 같이 고쳐 줘$/);
      expect(res.body.hookSpecificOutput.additionalContext).toContain('\n> 📨 Hub에서 보낸 메시지: 테스트도 같이 고쳐 줘\n');
      await ev({ hook_event_name: 'PostToolUse', tool_name: 'Read' }).expect(204);
      items = (await http.get(`/api/sessions/${chat.id}/chat`).set(auth).expect(200)).body.items;
      expect(items.find((i: { text: string }) => i.text === '테스트도 같이 고쳐 줘').delivery).toBe('delivered');

      // 턴이 끝나면 block으로 이어서 일하게 한다.
      await http.post(`/api/sessions/${chat.id}/messages`).set(auth).send({ text: '끝나기 전에 문서도' }).expect(201);
      const stop = await ev({ hook_event_name: 'Stop' }).expect(200);
      expect(stop.body).toMatchObject({ decision: 'block', reason: expect.stringContaining('끝나기 전에 문서도'), systemMessage: expect.stringContaining('끝나기 전에 문서도') });

      await http.post(`/api/sessions/${ended.id}/messages`).set(auth).send({ text: '늦었다' }).expect(409);
      await http.post(`/api/sessions/${chat.id}/messages`).set(auth).send({ text: '  ' }).expect(400);
    });

    it('입력 대기 세션 깨우기: 대기 요청이 메시지를 받아 가고, 새 대기·다시 움직임이면 410으로 끝난다', async () => {
      const all = (await http.get('/api/sessions').set(auth).expect(200)).body;
      const chat = all.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'sess-chat');
      const wait = (ms: number) => http.get(`/api/hooks/wait?session=sess-chat&ms=${ms}`).set(auth);

      // 메시지가 오면 본문으로 돌려주고 전달한 것으로 표시한다.
      const sent = (await http.post(`/api/sessions/${chat.id}/messages`).set(auth).send({ text: '자고 있으면 일어나' }).expect(201)).body;
      const got = await wait(3000).expect(200);
      expect(got.text).toMatch(/^\[Hub 메시지 #\d+\] .*\n자고 있으면 일어나$/s);
      await http.delete(`/api/sessions/${chat.id}/messages/${sent.id}`).set(auth).expect(409);

      // 새 대기가 오면 이전 대기는 410, 메시지 없이 시간이 다 되면 204
      const first = wait(8000).then((r) => r.status);
      await new Promise((r) => setTimeout(r, 300));
      const second = wait(2500).then((r) => r.status);
      expect(await first).toBe(410);
      expect(await second).toBe(204);

      // 세션이 다시 움직이면(UserPromptSubmit) 대기를 끝낸다.
      const third = wait(8000).then((r) => r.status);
      await new Promise((r) => setTimeout(r, 300));
      await http.post('/api/hooks/event?kind=event&task=').set(auth).send({ session_id: 'sess-chat', cwd: cwd(), hook_event_name: 'UserPromptSubmit', prompt: '다시' }).expect(204);
      expect(await third).toBe(410);

      await http.get('/api/hooks/wait?session=nope&ms=1000').set(auth).expect(410);
      // 전달 전이면 보내기를 취소할 수 있다.
      const pending = (await http.post(`/api/sessions/${chat.id}/messages`).set(auth).send({ text: '취소할 말' }).expect(201)).body;
      await http.delete(`/api/sessions/${chat.id}/messages/${pending.id}`).set(auth).expect(204);
    }, 30000);

    it('이 세션에서 진행하기는 task 정보 글을 입력창에 채워 보낸다: 긴 메시지도 받는다', async () => {
      const all = (await http.get('/api/sessions').set(auth).expect(200)).body;
      const chat = all.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'sess-chat');
      const brief = (await http.get('/api/tasks/lk-8/brief').set(auth).expect(200)).body.text;
      const long = `${brief}\n\n${'가'.repeat(9000 - brief.length)}`;
      const sent = (await http.post(`/api/sessions/${chat.id}/messages`).set(auth).send({ text: long }).expect(201)).body;
      await http.post(`/api/sessions/${chat.id}/messages`).set(auth).send({ text: 'x'.repeat(10001) }).expect(400);
      await http.delete(`/api/sessions/${chat.id}/messages/${sent.id}`).set(auth).expect(204);
    });

    it('세션 종료: 터미널 세션은 끝난 것으로 표시해 열린 목록에서 내린다', async () => {
      await http.post('/api/hooks/session-start?kind=session-start&task=').set(auth).send({ session_id: 'sess-end', cwd: cwd(), source: 'startup' }).expect(200);
      const id = (await http.get('/api/sessions').set(auth).expect(200)).body.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'sess-end').id;
      expect((await http.post(`/api/sessions/${id}/end`).set(auth).expect(201)).body).toEqual({ stoppedRun: null, marked: true });
      const view = (await http.get('/api/sessions').set(auth).expect(200)).body.find((s: { id: number }) => s.id === id);
      expect(view).toMatchObject({ state: 'ended', open: false });
      await http.post('/api/sessions/999999/end').set(auth).expect(404);
    });
  });

  describe('M3 Hub MCP', () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ name: 'e2e', version: '0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: auth } }));
    });
    afterAll(() => client?.close());

    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as Array<{ text: string }>)[0].text;
      return { isError: Boolean(res.isError), text, json: res.isError ? null : JSON.parse(text) };
    };

    it('토큰 없이 /mcp는 401', () =>
      http.post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(401));

    it('도구 12개', async () => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        [
          'add_todo', 'create_tasks', 'get_spec', 'get_task', 'list_tasks', 'record_deploy', 'record_mistake', 'report_bug',
          'save_spec', 'set_stage', 'submit_idea', 'update_task_status',
        ].sort(),
      );
    });

    it('create_tasks: 묶음 안 의존 관계', async () => {
      const { json } = await call('create_tasks', {
        app: 'HR',
        tasks: [{ title: 'API', size: 'M' }, { title: 'UI', depends_on_index: [0] }],
      });
      expect(json).toEqual([
        { id: 'HR-1', title: 'API', status: 'todo', dependsOn: [] },
        { id: 'HR-2', title: 'UI', status: 'todo', dependsOn: ['HR-1'] },
      ]);
    });

    it('list_tasks는 기본으로 열린 task만', async () => {
      const { json } = await call('list_tasks', { app: 'LK' });
      expect(json.map((t: { id: string }) => t.id)).toEqual(['LK-2', 'LK-3', 'LK-6', 'LK-7', 'LK-8']);
    });

    it('update_task_status: 허용되지 않은 전이는 도구 오류', async () => {
      expect((await call('update_task_status', { id: 'HR-1', status: 'done' })).isError).toBe(true);
      const { json } = await call('update_task_status', { id: 'HR-1', status: 'doing', note: '시작' });
      expect(json).toEqual({ id: 'HR-1', status: 'doing' });
    });

    it('save_spec / get_spec / get_task', async () => {
      const saved = await call('save_spec', { task_id: 'HR-1', kind: 'handoff', title: '인수인계', body: '# 한 일' });
      const spec = await call('get_spec', { id: saved.json.id });
      expect(spec.json).toMatchObject({ taskId: 'HR-1', kind: 'handoff', body: '# 한 일' });
      const task = await call('get_task', { id: 'hr-1' });
      expect(task.json.specs).toEqual([{ id: saved.json.id, kind: 'handoff', title: '인수인계' }]);
      expect(task.json.metadata.notes[0].note).toBe('시작');
    });

    it('task 정보 복사: 설명, 진행 메모, 연결 문서, 진행 방법을 한 덩어리 글로', async () => {
      const { body } = await http.get('/api/tasks/hr-1/brief').set(auth).expect(200);
      expect(body.taskId).toBe('HR-1');
      expect(body.text).toMatch(/^아래 Hub task를 이 세션에서 진행해 줘\.\n\n## HR-1 · /);
      expect(body.text).toContain('### 진행 메모');
      expect(body.text).toContain('] 시작');
      expect(body.text).toContain('#### [인수인계] 인수인계 (spec ');
      expect(body.text).toContain('# 한 일');
      expect(body.text).toContain('update_task_status로 이 task(HR-1)를 doing으로');
      await http.get('/api/tasks/NOPE-1/brief').set(auth).expect(404);
    });

    it('save_spec은 앱 폴더의 docs/hub/에 사본을 쓰고, 제목이 바뀌면 파일도 바꾼다. 문서 탭이 그 파일을 보여 준다', async () => {
      const saved = await call('save_spec', { task_id: 'LK-2', kind: 'handoff', title: '첫 제목', body: '## 한 일\n- 무엇' });
      const dir = join(repo, 'docs', 'hub');
      const prefix = `${String(saved.json.id).padStart(4, '0')}-`;
      expect(readdirSync(dir)).toEqual([`${prefix}첫-제목.md`]);
      expect(readFileSync(join(dir, `${prefix}첫-제목.md`), 'utf8')).toContain('> 인수인계 · task LK-2');

      await call('save_spec', { id: saved.json.id, kind: 'handoff', title: '바뀐 제목', body: '## 한 일' });
      expect(readdirSync(dir)).toEqual([`${prefix}바뀐-제목.md`]);

      // 문서 탭: docs/·design/의 보여 줄 파일만, 보기 주소로 연다.
      mkdirSync(join(repo, 'design', 'node_modules'), { recursive: true });
      writeFileSync(join(repo, 'design', 'App.dc.html'), '<script src="./support.js"></script>');
      writeFileSync(join(repo, 'design', 'support.js'), 'window.x = 1');
      writeFileSync(join(repo, 'design', 'node_modules', 'skip.md'), 'x');
      writeFileSync(join(repo, 'design', '.secret.md'), 'x');
      writeFileSync(join(repo, 'outside.md'), 'x');
      const list = (await http.get('/api/apps/1/files').set(auth).expect(200)).body;
      expect(list.roots).toHaveLength(1);
      expect(list.files.map((f: { path: string; kind: string }) => `${f.path}:${f.kind}`)).toEqual([`docs/hub/${prefix}바뀐-제목.md:md`, 'design/App.dc.html:html']);

      const base = list.roots[0].viewBase as string;
      const page = await http.get(`${base}design/App.dc.html`).set('Accept', 'text/html').expect(200);
      expect(page.text).toContain('support.js');
      expect(page.headers['content-security-policy']).toContain('sandbox allow-scripts');
      expect(page.headers['referrer-policy']).toBe('no-referrer');
      // 목록에 없는 보조 파일도 같은 폴더면 열린다.
      await http.get(`${base}design/support.js`).expect(200).expect('Content-Type', /javascript/);
      await http.get(`${base}${encodeURI(`docs/hub/${prefix}바뀐-제목.md`)}`).expect(200);
      // 숨김 파일, 폴더 밖, 서명이 틀린 주소는 열지 않는다.
      await http.get(`${base}design/.secret.md`).expect(403);
      await http.get(`${base}design/..%2F..%2Foutside.md`).expect((r) => expect([403, 404]).toContain(r.status));
      await http.get(`${base}outside.md`).expect(404);
      await http.get(`${base.replace(/[0-9a-f]{4}\/$/, '0000/')}design/App.dc.html`).expect(403);
    });

    it('MCP update_task_status에 PR 주소를 남기면 task에 붙는다', async () => {
      const { json } = await call('update_task_status', { id: 'HR-1', status: 'doing', note: '세션에서 진행', pr_url: 'https://github.com/o/r/pull/9', branch: 'hub/hr-1-x' });
      expect(json).toMatchObject({ id: 'HR-1', prUrl: 'https://github.com/o/r/pull/9' });
    });

    it('record_mistake는 다음 세션 맥락에 들어간다', async () => {
      await call('record_mistake', { app: 'LK', what: '마이그레이션 없이 엔티티 변경', correct_way: '마이그레이션을 같이 만든다' });
      const res = await http
        .post('/api/hooks/session-start?kind=session-start&task=')
        .set(auth)
        .send({ session_id: 'sess-9', cwd: repo, source: 'startup' })
        .expect(200);
      expect(res.text).toContain('- 마이그레이션 없이 엔티티 변경 → 마이그레이션을 같이 만든다');
    });

    it('화면: 실수 기록을 보고 끄면 다음 세션 맥락에서 빠진다', async () => {
      const list = (await http.get('/api/mistakes?app=lk').set(auth).expect(200)).body;
      expect(list[0]).toMatchObject({ appCode: 'LK', what: '마이그레이션 없이 엔티티 변경', active: true });
      const off = await http.patch(`/api/mistakes/${list[0].id}`).set(auth).send({ active: false }).expect(200);
      expect(off.body.active).toBe(false);
      const res = await http.post('/api/hooks/session-start?kind=session-start&task=').set(auth).send({ session_id: 'sess-10', cwd: repo, source: 'startup' });
      expect(res.text).not.toContain('마이그레이션 없이 엔티티 변경');
      await http.patch('/api/mistakes/99999').set(auth).send({ active: true }).expect(404);
    });

    it('화면: task 문서 목록은 본문까지 준다', async () => {
      const specs = (await http.get('/api/specs?task=hr-1').set(auth).expect(200)).body;
      expect(specs).toEqual([expect.objectContaining({ taskId: 'HR-1', kind: 'handoff', title: '인수인계', body: '# 한 일' })]);
      await http.get(`/api/specs/${specs[0].id}`).set(auth).expect(200);
      await http.get('/api/specs').set(auth).expect(400);
    });

    it('화면: Hub 기본값', async () => {
      const d = (await http.get('/api/settings/defaults').set(auth).expect(200)).body;
      expect(d.allowedTools).toContain('Read');
      expect(d.worktreeRoot).toMatch(/worktrees$/);
    });

    it('submit_idea는 pending v1로 저장', async () => {
      const { json } = await call('submit_idea', { app: 'LK', body: { title: '알림', problem: 'p', proposal: 'q' } });
      expect(json.status).toBe('pending');
      const ds = app.get(DataSource);
      const [v] = await ds.query('SELECT version, body FROM idea_versions WHERE idea_id = $1', [json.id]);
      expect(v).toMatchObject({ version: 1, body: { problem: 'p', proposal: 'q' } });
    });

    it('없는 앱은 도구 오류', async () => {
      expect((await call('record_mistake', { app: 'ZZ', what: 'a', correct_way: 'b' })).isError).toBe(true);
    });
  });

  describe('M6 비용', () => {
    beforeAll(async () => {
      const ds = app.get(DataSource);
      const [hr] = await ds.query(`SELECT id FROM apps WHERE code = 'HR'`);
      const insert = (taskId: string | null, kind: string, cost: number, startedAt: string | null, result: object = {}, createdAt = startedAt) =>
        ds.query('INSERT INTO runs (task_id, kind, status, cost_usd, result, started_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          taskId, kind, startedAt ? 'done' : 'queued', cost, result, startedAt, createdAt,
        ]);
      // UTC 9월 30일 15:30은 서울 10월 1일 00:30이다.
      await insert('LK-8', 'implement', 0.5, '2026-09-30T15:30:00Z');
      await insert('LK-3', 'implement', 1, '2026-09-30T14:00:00Z');
      await insert('LK-2', 'implement', 0.25, '2026-10-15T03:00:00Z');
      await insert(null, 'idea_gen', 0.1, '2026-10-15T05:00:00Z', { idea: { appId: hr.id } });
      await insert('LK-6', 'implement', 0, null, {}, '2026-10-20T01:00:00Z');
    });

    it('월 합계와 앱·종류·날짜별 내역은 서울 시간 기준', async () => {
      const res = await http.get('/api/costs?month=2026-10').set(auth).expect(200);
      expect(res.body).toEqual({
        month: '2026-10',
        timezone: 'Asia/Seoul',
        costUsd: 0.85,
        runs: 4,
        byApp: [
          { appCode: 'LK', costUsd: 0.75, runs: 3 },
          { appCode: 'HR', costUsd: 0.1, runs: 1 },
        ],
        byKind: [
          { kind: 'implement', costUsd: 0.75, runs: 3 },
          { kind: 'idea_gen', costUsd: 0.1, runs: 1 },
        ],
        byDay: [
          { date: '2026-10-01', costUsd: 0.5, runs: 1 },
          { date: '2026-10-15', costUsd: 0.35, runs: 2 },
          { date: '2026-10-20', costUsd: 0, runs: 1 },
        ],
      });
    });

    it('월별 합계는 최근 달부터', async () => {
      const res = await http.get('/api/costs/monthly').set(auth).expect(200);
      expect(res.body).toEqual([
        { month: '2026-10', costUsd: 0.85, runs: 4 },
        { month: '2026-09', costUsd: 1, runs: 1 },
      ]);
      const one = await http.get('/api/costs/monthly?limit=1').set(auth).expect(200);
      expect(one.body).toHaveLength(1);
    });

    it('run이 없는 달은 0, 형식이 틀리면 400', async () => {
      const res = await http.get('/api/costs?month=2025-01').set(auth).expect(200);
      expect(res.body).toMatchObject({ costUsd: 0, runs: 0, byApp: [], byKind: [], byDay: [] });
      await http.get('/api/costs?month=2026-13').set(auth).expect(400);
      await http.get('/api/costs').set(auth).expect(200);
    });
  });

  describe('앱 관리 (화면)', () => {
    it('열린 내 세션: hook으로 기록된, 끝나지 않은 세션', async () => {
      const list = (await http.get('/api/apps/1/open-sessions').set(auth).expect(200)).body;
      expect(list.some((x: { claudeSessionId: string; cwd: string }) => x.claudeSessionId === 'sess-10' && x.cwd === repo)).toBe(true);
    });

    it('프로젝트 폴더 목록', async () => {
      const list = (await http.get('/api/project-candidates').set(auth).expect(200)).body;
      expect(Array.isArray(list)).toBe(true);
    });

    it('앱 삭제: task·규칙까지 지우고, 다른 앱 규칙과 run은 남긴다', async () => {
      const zz = (await http.post('/api/apps').set(auth).send({ code: 'ZZ', name: '지울 앱', folderNames: ['zz'] }).expect(201)).body;
      await http.post('/api/tasks').set(auth).send({ app: 'ZZ', title: '지워질 task' }).expect(201);
      const before = (await http.get('/api/rules').set(auth)).body.rules.map((r: { appCode: string | null; body: string }) => ({ app: r.appCode, body: r.body }));
      await http.put('/api/rules').set(auth).send({ rules: [...before, { app: 'ZZ', body: 'ZZ에서만' }] }).expect(200);

      await http.delete(`/api/apps/${zz.id}`).set(auth).expect(204);
      expect((await http.get('/api/apps').set(auth)).body.some((a: { code: string }) => a.code === 'ZZ')).toBe(false);
      const ds = app.get(DataSource);
      expect((await ds.query(`SELECT count(*)::int AS n FROM tasks WHERE id LIKE 'ZZ-%'`))[0].n).toBe(0);
      const after = (await http.get('/api/rules').set(auth)).body.rules.map((r: { appCode: string | null; body: string }) => ({ app: r.appCode, body: r.body }));
      expect(after).toEqual(before);
      await http.delete(`/api/apps/${zz.id}`).set(auth).expect(404);
    });
  });
});
