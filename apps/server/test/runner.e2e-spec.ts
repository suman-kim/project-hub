import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { WebSocket } from 'ws';

const TOKEN = 'test-token';
const root = mkdtempSync(join(tmpdir(), 'hub-runner-'));
process.env.HUB_TOKEN = TOKEN;
// 진짜 ~/.claude(규칙 파일, 토큰)를 건드리지 않게 한다.
process.env.HUB_CLAUDE_HOME = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'hub-claude-'));
process.env.HUB_DATABASE_URL = process.env.HUB_TEST_DATABASE_URL || 'postgres://hub:hub@127.0.0.1:5434/hub_test';
process.env.HUB_HOME = join(root, 'hub-home');
process.env.HUB_CLAUDE_BIN = join(__dirname, 'fixtures', 'fake-claude.js');
process.env.HUB_GH_BIN = join(__dirname, 'fixtures', 'fake-gh.js');
process.env.HUB_CAFFEINATE = '0';
process.env.FAKE_CLAUDE_ARGS_LOG = join(root, 'claude-args.jsonl');
process.env.FAKE_GH_LOG = join(root, 'gh-args.jsonl');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureApp } = require('../src/bootstrap');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd }).toString().trim();

describe('runner e2e', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let baseUrl: string;
  const auth = { 'X-Hub-Token': TOKEN };
  const repo = join(root, 'link');
  const origin = join(root, 'origin.git');

  const waitRun = async (id: number, statuses: string[], timeoutMs = 15000) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const res = await http.get(`/api/runs/${id}`).set(auth).expect(200);
      if (statuses.includes(res.body.status)) return res.body;
      if (Date.now() > until) throw new Error(`run ${id}: ${res.body.status} (기대: ${statuses.join(',')})`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const newTask = async (title: string) =>
    (await http.post('/api/tasks').set(auth).send({ app: 'LK', title, description: '설명' }).expect(201)).body.id as string;

  beforeAll(async () => {
    const reset = new DataSource({ type: 'postgres', url: process.env.HUB_DATABASE_URL });
    await reset.initialize();
    await reset.query('DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    // 원격(origin) 역할의 bare 저장소와 앱 저장소
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), '# link\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    http = request(app.getHttpServer());

    await http
      .post('/api/apps')
      .set(auth)
      .send({ code: 'LK', name: 'Link', repoPath: repo, folderNames: ['link'], setupCmd: 'echo setup-ok > .setup-done' })
      .expect(201);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  it('POST /api/tasks/:id/run 하나로 worktree → 실행 → 커밋 확인 → push → PR → review', async () => {
    const taskId = await newTask('Simple feature');
    const events: Array<{ event: string; data: { status?: string } }> = [];
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?token=${TOKEN}`);
    await new Promise((r) => ws.on('open', r));
    ws.on('message', (m) => events.push(JSON.parse(m.toString())));

    const started = await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201);
    expect(started.body.status).toBe('queued');
    const run = await waitRun(started.body.id, ['done', 'failed']);
    expect(run.result.reason).toBeUndefined();
    expect(run.status).toBe('done');
    expect(run.branch).toBe(`hub/${taskId}-simple-feature`);
    expect(run.worktreePath).toBe(join(process.env.HUB_HOME!, 'worktrees', 'LK', taskId));
    expect(run.costUsd).toBe(0.5);
    expect(run.claudeSessionId).toBeTruthy();

    // setup_cmd가 worktree에서 돌았고, 브랜치가 origin에 push됐다.
    expect(existsSync(join(run.worktreePath, '.setup-done'))).toBe(true);
    expect(git(origin, 'log', '--format=%s', run.branch)).toContain(`${taskId}: done`);

    const task = (await http.get(`/api/tasks/${taskId}`).set(auth).expect(200)).body;
    expect(task.status).toBe('review');
    expect(task.prUrl).toBe(`https://github.com/test/repo/pull/${encodeURIComponent(run.branch)}`);
    expect(task.branch).toBe(run.branch);

    const gh = readFileSync(process.env.FAKE_GH_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    expect(gh.slice(0, 6)).toEqual(['pr', 'create', '--base', 'main', '--head', run.branch]);

    const claudeCall = readFileSync(process.env.FAKE_CLAUDE_ARGS_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    expect(claudeCall.env).toEqual({ HUB_TASK_ID: taskId, HUB_RUN_ID: String(run.id) });
    expect(claudeCall.args).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--json-schema']));
    expect(claudeCall.args).not.toContain('--bare');

    const logs = (await http.get(`/api/runs/${run.id}/logs?after=0`).set(auth).expect(200)).body;
    expect(logs.map((l: { seq: number }) => l.seq)).toEqual(logs.map((_: unknown, i: number) => i + 1));
    expect(logs.some((l: { kind: string; text: string }) => l.kind === 'hub' && l.text.startsWith('PR: '))).toBe(true);
    const tail = (await http.get(`/api/runs/${run.id}/logs?after=${logs.length - 1}`).set(auth).expect(200)).body;
    expect(tail).toHaveLength(1);

    // runner가 띄운 세션은 hub 세션으로 run에 묶인다.
    const ds = app.get(DataSource);
    const [session] = await ds.query('SELECT origin, run_id, task_id FROM sessions WHERE claude_session_id = $1', [run.claudeSessionId]);
    expect(session).toEqual({ origin: 'hub', run_id: run.id, task_id: taskId });

    ws.close();
    expect(events.some((e) => e.event === 'run.status' && e.data.status === 'running')).toBe(true);
    expect(events.some((e) => e.event === 'run.log')).toBe(true);
    expect(events.some((e) => e.event === 'task.updated')).toBe(true);
  }, 30000);

  it('질문으로 끝난 run에 답하면 같은 세션으로 이어진다', async () => {
    const taskId = await newTask('ASK_FIRST greeting');
    const { body } = await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201);
    const waiting = await waitRun(body.id, ['input', 'failed']);
    expect(waiting.status).toBe('input');
    expect(waiting.result.question).toBe('어느 언어로 쓸까?');
    expect((await http.get(`/api/tasks/${taskId}`).set(auth)).body.status).toBe('input');

    // 같은 task에 run을 또 만들 수 없다.
    await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(409);

    await http.post(`/api/runs/${body.id}/answer`).set(auth).send({ answer: '한국어' }).expect(201);
    const done = await waitRun(body.id, ['done', 'failed']);
    expect(done.status).toBe('done');
    expect(done.claudeSessionId).toBe(waiting.claudeSessionId);
    expect(done.costUsd).toBe(1);
    expect(done.result.answers[0].answer).toBe('한국어');

    const calls = readFileSync(process.env.FAKE_CLAUDE_ARGS_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const resumed = calls.pop();
    expect(resumed.args).toEqual(expect.arrayContaining(['--resume', waiting.claudeSessionId]));
    expect(git(origin, 'log', '--format=%s', done.branch)).toContain(`${taskId}: answer 한국어`);
    expect((await http.get(`/api/tasks/${taskId}`).set(auth)).body.status).toBe('review');

    // 로그에 비밀값이 남지 않는다.
    const logs = (await http.get(`/api/runs/${body.id}/logs`).set(auth)).body;
    const all = JSON.stringify(logs);
    expect(all).not.toContain('abcdef123456');
  }, 30000);

  it('답변 대기가 아닌 run에 답하면 409', async () => {
    const runs = (await http.get('/api/tasks/LK-1/runs').set(auth)).body;
    await http.post(`/api/runs/${runs[0].id}/answer`).set(auth).send({ answer: 'x' }).expect(409);
  });

  it('실행 중지', async () => {
    const taskId = await newTask('SLOW job');
    const { body } = await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201);
    await waitRun(body.id, ['running']);
    // 프로세스가 뜰 때까지 잠깐 기다린다.
    await new Promise((r) => setTimeout(r, 500));
    await http.post(`/api/runs/${body.id}/stop`).set(auth).expect(201);
    const stopped = await waitRun(body.id, ['stopped', 'failed', 'done']);
    expect(stopped.status).toBe('stopped');
    const task = (await http.get(`/api/tasks/${taskId}`).set(auth)).body;
    expect(task.status).toBe('doing');
    expect(task.metadata.notes.pop().note).toContain('중지');
  }, 30000);

  it('커밋 없이 완료라고 하면 실패', async () => {
    const taskId = await newTask('NOCOMMIT job');
    const { body } = await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201);
    const run = await waitRun(body.id, ['done', 'failed']);
    expect(run).toMatchObject({ status: 'failed', result: { failure: 'no_commit' } });
    expect((await http.get(`/api/tasks/${taskId}`).set(auth)).body.status).toBe('doing');
  }, 30000);

  it('사용량 한도는 rate_limit 실패로 분류', async () => {
    const taskId = await newTask('LIMIT job');
    const { body } = await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201);
    const run = await waitRun(body.id, ['done', 'failed']);
    expect(run).toMatchObject({ status: 'failed', result: { failure: 'rate_limit' } });
  }, 30000);

  it('전체 run 목록: 상태·앱으로 거르고, latest면 task마다 가장 최근 run만', async () => {
    const failed = (await http.get('/api/runs?status=failed&app=lk').set(auth).expect(200)).body;
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((r: { status: string; appCode: string }) => r.status === 'failed' && r.appCode === 'LK')).toBe(true);
    expect(failed.find((r: { taskTitle: string }) => r.taskTitle === 'LIMIT job')).toMatchObject({ kind: 'implement', taskStatus: 'doing', result: { failure: 'rate_limit' } });

    const all = (await http.get('/api/runs?limit=3').set(auth).expect(200)).body;
    expect(all).toHaveLength(3);
    expect(all[0].id).toBeGreaterThan(all[1].id);

    // 같은 task를 다시 돌리면 예전 실패는 latest에서 빠진다.
    const taskId = failed.find((r: { taskTitle: string }) => r.taskTitle === 'LIMIT job').taskId;
    const ids = (await http.get(`/api/runs?latest=true&limit=500`).set(auth).expect(200)).body.filter((r: { taskId: string }) => r.taskId === taskId);
    expect(ids).toHaveLength(1);
    await http.get('/api/runs?status=nope').set(auth).expect(400);
  });

  it('로그 끝부분만 받기', async () => {
    const [run] = (await http.get('/api/runs?limit=1').set(auth).expect(200)).body;
    const all = (await http.get(`/api/runs/${run.id}/logs`).set(auth).expect(200)).body;
    const tail = (await http.get(`/api/runs/${run.id}/logs?tail=2`).set(auth).expect(200)).body;
    expect(tail.map((l: { seq: number }) => l.seq)).toEqual(all.slice(-2).map((l: { seq: number }) => l.seq));
  });

  it('사용량: 가장 최근 run이 받은 값과 80% 기준', async () => {
    const usage = (await http.get('/api/usage').set(auth).expect(200)).body;
    // 마지막 run이 한도에 걸렸다.
    expect(usage).toMatchObject({ limit: 0.8, high: true });
    expect(typeof usage.at).toBe('string');
  });

  // 사용량 시험이 마지막 run을 보므로 그 뒤에 둔다.
  it('다시 실행해서 완료되면 앞의 실패에 resolvedBy가 붙는다', async () => {
    const taskId = await newTask('LIMIT 뒤에 고침');
    const first = (await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201)).body;
    expect(await waitRun(first.id, ['done', 'failed'])).toMatchObject({ status: 'failed' });

    const before = (await http.get('/api/runs?status=failed&limit=500').set(auth).expect(200)).body;
    expect(before.find((r: { id: number }) => r.id === first.id).resolvedBy).toBeNull();

    await http.patch(`/api/tasks/${taskId}`).set(auth).send({ title: '고친 task' }).expect(200);
    const second = (await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201)).body;
    expect(await waitRun(second.id, ['done', 'failed'])).toMatchObject({ status: 'done' });

    const after = (await http.get('/api/runs?status=failed&limit=500').set(auth).expect(200)).body;
    expect(after.find((r: { id: number }) => r.id === first.id).resolvedBy).toBe(second.id);
    // 다시 돌리지 않은 실패는 그대로다.
    expect(after.find((r: { taskTitle: string }) => r.taskTitle === 'LIMIT job').resolvedBy).toBeNull();
  }, 30000);

  it('세션 이어서 하기: 끝난 세션을 그 폴더에서 --resume으로 이어 받고, 시작한 쪽은 그대로 둔다', async () => {
    const taskId = await newTask('세션 이어 받기');
    // 내가 터미널에서 연 세션이 끝났다.
    await http.post('/api/hooks/session-start?kind=session-start&task=').set(auth).send({ session_id: 'term-1', cwd: repo, source: 'startup' }).expect(200);
    await http.post('/api/hooks/event?kind=event&task=').set(auth).send({ session_id: 'term-1', cwd: repo, hook_event_name: 'SessionEnd', reason: 'exit' }).expect(204);
    const sid = (await http.get('/api/sessions').set(auth).expect(200)).body.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'term-1').id;

    // task를 고르지 않으면 거부한다.
    await http.post(`/api/sessions/${sid}/resume`).set(auth).send({ message: 'NOCOMMIT 이어서' }).expect(400);
    const started = await http.post(`/api/sessions/${sid}/resume`).set(auth).send({ message: 'NOCOMMIT 이어서', taskId }).expect(201);
    expect(started.body).toMatchObject({ kind: 'session', taskId });
    // 같은 세션을 이어 받는 run은 하나만
    await http.post(`/api/sessions/${sid}/resume`).set(auth).send({ message: '또', taskId }).expect(409);
    const run = await waitRun(started.body.id, ['done', 'failed']);
    expect(run).toMatchObject({ status: 'done', claudeSessionId: 'term-1', result: { session: { sessionId: sid, claudeSessionId: 'term-1' } } });

    const view = (await http.get('/api/sessions').set(auth).expect(200)).body.find((s: { id: number }) => s.id === sid);
    expect(view).toMatchObject({ origin: 'local', run: { id: run.id, kind: 'session' }, task: { id: taskId } });
    // 열린 세션은 터미널을 닫았다고 확인해야(force) 이어 받는다.
    await http.post('/api/hooks/session-start?kind=session-start&task=').set(auth).send({ session_id: 'term-2', cwd: repo, source: 'startup' }).expect(200);
    const open = (await http.get('/api/sessions').set(auth).expect(200)).body.find((s: { claudeSessionId: string }) => s.claudeSessionId === 'term-2').id;
    await http.post(`/api/sessions/${open}/resume`).set(auth).send({ message: 'NOCOMMIT 닫았어', taskId }).expect(409);
    const forced = await http.post(`/api/sessions/${open}/resume`).set(auth).send({ message: 'NOCOMMIT 닫았어', taskId, force: true }).expect(201);
    await waitRun(forced.body.id, ['done', 'failed']);
  }, 30000);

  it('task가 done이 되면 worktree를 정리한다', async () => {
    const run = (await http.get('/api/tasks/LK-1/runs').set(auth)).body[0];
    expect(existsSync(run.worktreePath)).toBe(true);
    await http.patch('/api/tasks/LK-1').set(auth).send({ status: 'done' }).expect(200);
    for (let i = 0; i < 25 && existsSync(run.worktreePath); i += 1) await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(run.worktreePath)).toBe(false);
  }, 15000);

  it('앱별 허용 도구 목록이 있으면 그것을 넘긴다', async () => {
    await http.patch('/api/apps/1').set(auth).send({ allowedTools: ['Read', 'Bash(make *)'] }).expect(200);
    const taskId = await newTask('Tools check');
    const { body } = await http.post(`/api/tasks/${taskId}/run`).set(auth).expect(201);
    await waitRun(body.id, ['done', 'failed']);
    const call = readFileSync(process.env.FAKE_CLAUDE_ARGS_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    expect(call.args[call.args.indexOf('--allowedTools') + 1]).toBe('Read,Bash(make *)');
    await http.patch('/api/apps/1').set(auth).send({ allowedTools: null }).expect(200);
  }, 30000);

  it('사용량: 창별 소진율과 초기화 시각', async () => {
    const usage = (await http.get('/api/usage').set(auth).expect(200)).body;
    expect(usage).toMatchObject({
      high: false,
      fiveHour: { utilization: 0.1, status: 'allowed', resetsAt: new Date(1900000000 * 1000).toISOString() },
      sevenDay: { utilization: 0.5 },
    });
  });

  it('review 상태 task는 실행할 수 없다', async () => {
    await http.post('/api/tasks/LK-2/run').set(auth).expect(409);
  });

  it('토큰 없는 WebSocket은 끊는다', async () => {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws`);
    const code = await new Promise((r) => ws.on('close', (c) => r(c)));
    expect(code).toBe(4401);
  });
});
