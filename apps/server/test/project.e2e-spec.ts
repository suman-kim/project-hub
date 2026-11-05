import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';

const TOKEN = 'test-token';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-project-')));
process.env.HUB_TOKEN = TOKEN;
process.env.HUB_CLAUDE_HOME = join(root, 'claude-home');
process.env.HUB_CLAUDE_JSON = join(root, 'claude.json');
process.env.HUB_PROJECT_ROOT = join(root, 'projects');
process.env.HUB_DATABASE_URL = process.env.HUB_TEST_DATABASE_URL || 'postgres://hub:hub@127.0.0.1:5434/hub_test';
process.env.HUB_HOME = join(root, 'hub-home');
process.env.HUB_CLAUDE_BIN = join(__dirname, 'fixtures', 'fake-claude.js');
process.env.HUB_GH_BIN = join(__dirname, 'fixtures', 'fake-gh.js');
process.env.HUB_CAFFEINATE = '0';
process.env.FAKE_CLAUDE_ARGS_LOG = join(root, 'claude-args.jsonl');
process.env.FAKE_CLAUDE_BG_STATE = join(root, 'bg-sessions.json');
process.env.FAKE_GH_LOG = join(root, 'gh.jsonl');
process.env.FAKE_GH_API = join(root, 'gh-api.json');
process.env.FAKE_GH_PRS = join(root, 'gh-prs.json');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureApp } = require('../src/bootstrap');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BACKFILL_ACTIVITIES_SQL } = require('../src/db/backfill-activities');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd }).toString().trim();

/** origin(bare)에 첫 커밋을 올린 저장소 */
function makeRepo(path: string): void {
  const origin = `${path}.origin.git`;
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  writeFileSync(join(path, 'README.md'), '# repo\n');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'init');
  git(path, 'remote', 'add', 'origin', origin);
  git(path, 'push', '-q', 'origin', 'main');
}

describe('통합 관리 (X1) e2e', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let baseUrl: string;
  let client: Client;
  const auth = { 'X-Hub-Token': TOKEN };
  const multi = join(root, 'multi');
  const single = join(root, 'single');
  const ids: Record<string, number> = {};

  const waitRun = async (id: number) => {
    for (let i = 0; i < 75; i += 1) {
      const res = await http.get(`/api/runs/${id}`).set(auth).expect(200);
      if (['done', 'failed', 'stopped', 'input'].includes(res.body.status)) return res.body;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`run ${id}가 끝나지 않았다`);
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0].text;
    return { isError: Boolean(res.isError), text, json: res.isError ? null : JSON.parse(text) };
  };
  const activities = async (code: string, kind?: string) =>
    (await http.get(`/api/activities?app=${code}${kind ? `&kind=${kind}` : ''}`).set(auth).expect(200)).body as Array<{ kind: string; summary: string; actor: string }>;

  beforeAll(async () => {
    const reset = new DataSource({ type: 'postgres', url: process.env.HUB_DATABASE_URL });
    await reset.initialize();
    await reset.query('DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    makeRepo(join(multi, 'backend'));
    makeRepo(join(multi, 'web'));
    makeRepo(single);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as import('node:net').AddressInfo).port}`;
    http = request(app.getHttpServer());

    ids.MR = (await http.post('/api/apps').set(auth).send({ code: 'MR', name: '여러 저장소', repoPath: multi, folderNames: ['multi'] }).expect(201)).body.id;
    ids.SR = (await http.post('/api/apps').set(auth).send({ code: 'SR', name: '한 저장소', repoPath: single, folderNames: ['single'] }).expect(201)).body.id;

    client = new Client({ name: 'e2e', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: auth } }));
  }, 30000);

  afterAll(async () => {
    await client?.close();
    await app?.close();
  });

  describe('저장소 목록과 실행', () => {
    let backendId: number;

    it('앱 폴더 아래 git 저장소를 찾아 등록한다', async () => {
      const res = await http.post(`/api/apps/${ids.MR}/repos/detect`).set(auth).expect(201);
      expect(res.body.map((r: { name: string; path: string; defaultBranch: string }) => [r.name, r.path])).toEqual([
        ['backend', join(multi, 'backend')],
        ['web', join(multi, 'web')],
      ]);
      backendId = res.body[0].id;
      // 다시 찾아도 늘지 않는다
      expect((await http.post(`/api/apps/${ids.MR}/repos/detect`).set(auth).expect(201)).body).toHaveLength(2);
      expect((await activities('MR', 'repo')).map((a) => a.summary)).toEqual(['저장소 등록: web', '저장소 등록: backend']);
    });

    it('저장소가 여러 개면 task에 저장소가 없을 때 실행을 거부하고, 정하면 그 저장소에서 돈다', async () => {
      const t1 = (await http.post('/api/tasks').set(auth).send({ app: 'MR', title: '저장소 없음' }).expect(201)).body;
      const refused = await http.post(`/api/tasks/${t1.id}/run`).set(auth).expect(409);
      expect(refused.body.error.message).toContain('저장소가 2개(backend, web)');

      const t2 = (await http.post('/api/tasks').set(auth).send({ app: 'MR', title: 'backend 작업', repoId: backendId }).expect(201)).body;
      expect(t2.repoId).toBe(backendId);
      const { body: run } = await http.post(`/api/tasks/${t2.id}/run`).set(auth).expect(201);
      expect(run.result.repo).toMatchObject({ name: 'backend' });
      const done = await waitRun(run.id);
      expect(done.status).toBe('done');
      expect(git(join(multi, 'backend'), 'branch', '--list', 'hub/*')).toContain(`hub/${t2.id}-`);
      expect(existsSync(join(multi, 'web', '.git'))).toBe(true);
    });

    it('다른 앱의 저장소나 없는 단계는 거부', async () => {
      await http.post('/api/tasks').set(auth).send({ app: 'SR', title: 'x', repoId: backendId }).expect(400);
      await http.post('/api/tasks').set(auth).send({ app: 'SR', title: 'x', stage: 'nope' }).expect(400);
    });

    it('저장소가 하나인 앱은 실행할 때 찾고, push 전 검사가 실패하면 PR을 만들지 않는다', async () => {
      const wtRoot = join(root, 'wt');
      await http.patch(`/api/apps/${ids.SR}`).set(auth).send({ checkCmd: 'echo 검사 실패; exit 3', worktreeRoot: wtRoot }).expect(200);
      const t = (await http.post('/api/tasks').set(auth).send({ app: 'SR', title: '검사 시험' }).expect(201)).body;
      const failed = await waitRun((await http.post(`/api/tasks/${t.id}/run`).set(auth).expect(201)).body.id);
      expect(failed).toMatchObject({ status: 'failed', result: { failure: 'check' } });
      expect(failed.result.reason).toContain('검사 실패');
      expect(failed.worktreePath).toBe(join(wtRoot, 'SR', t.id));
      const gh = readFileSync(process.env.FAKE_GH_LOG!, 'utf8');
      expect(gh).not.toContain(`hub/${t.id}-`);

      await http.patch(`/api/apps/${ids.SR}`).set(auth).send({ checkCmd: 'true' }).expect(200);
      const ok = await waitRun((await http.post(`/api/tasks/${t.id}/run`).set(auth).expect(201)).body.id);
      expect(ok.status).toBe('done');
      expect((await http.get(`/api/tasks/${t.id}`).set(auth).expect(200)).body.status).toBe('review');
    });
  });

  describe('내 할 일, 버그, 단계, 배포 (MCP 포함)', () => {
    it('내 할 일은 리뷰 없이 끝내고, 실행하지 않는다', async () => {
      const t = (await http.post('/api/tasks').set(auth).send({ app: 'SR', title: '도메인 연결', assignee: 'me', dueDate: '2026-01-01' }).expect(201)).body;
      expect(t).toMatchObject({ assignee: 'me', type: 'feature', dueDate: '2026-01-01' });
      await http.post(`/api/tasks/${t.id}/run`).set(auth).expect(409);
      await http.patch(`/api/tasks/${t.id}`).set(auth).send({ status: 'done' }).expect(200);
      await http.patch(`/api/tasks/${t.id}`).set(auth).send({ status: 'todo' }).expect(200);
      // Claude task는 todo에서 바로 done으로 갈 수 없다
      const c = (await http.post('/api/tasks').set(auth).send({ app: 'SR', title: 'claude 일' }).expect(201)).body;
      await http.patch(`/api/tasks/${c.id}`).set(auth).send({ status: 'done' }).expect(409);
    });

    it('MCP: 버그 등록, 할 일 추가, 단계 이동, 배포 기록', async () => {
      const bug = await call('report_bug', { app: 'SR', title: '로그인 실패', severity: 'critical', steps: '1. 로그인' });
      const t = (await http.get(`/api/tasks/${bug.json.id}`).set(auth).expect(200)).body;
      expect(t).toMatchObject({ type: 'bug', assignee: 'claude', metadata: { bug: { severity: 'critical', steps: '1. 로그인' } } });

      const todo = await call('add_todo', { app: 'SR', title: '스토어 심사 제출', due_date: '2026-11-01', priority: 1 });
      expect(todo.json).toMatchObject({ assignee: 'me' });

      expect((await call('set_stage', { app: 'SR', stage: 'develop' })).json).toMatchObject({ stage: 'develop' });
      expect((await call('set_stage', { app: 'SR', stage: 'nope' })).isError).toBe(true);

      const d = await call('record_deploy', { app: 'SR', env: 'store', status: 'in_progress', version: '1.0.0', notes: '심사 제출' });
      expect(d.json).toMatchObject({ env: 'store', status: 'in_progress' });
      await http.patch(`/api/deployments/${d.json.id}`).set(auth).send({ status: 'success' }).expect(200);

      const list = await http.get('/api/tasks?app=SR&type=bug').set(auth).expect(200);
      expect(list.body.map((x: { id: string }) => x.id)).toEqual([bug.json.id]);
      const kinds = (await activities('SR')).map((a) => `${a.kind}/${a.actor}`);
      expect(kinds).toEqual(expect.arrayContaining(['task.created/claude', 'app.stage/claude', 'deploy/claude', 'deploy/me']));
      expect((await activities('SR', 'deploy')).map((a) => a.summary)).toEqual(['배포 성공 · 스토어 1.0.0: 심사 제출', '배포 진행 중 · 스토어 1.0.0: 심사 제출']);
    });

    it('단계 목록을 앱마다 바꾸고, 없어진 단계에 묶인 task는 단계 없음이 된다', async () => {
      const t = (await http.post('/api/tasks').set(auth).send({ app: 'SR', title: '디자인 일', stage: 'design' }).expect(201)).body;
      await http
        .patch(`/api/apps/${ids.SR}`)
        .set(auth)
        .send({ stages: [{ key: 'plan', name: '기획' }, { key: 'develop', name: '개발' }, { key: 'beta', name: '베타' }], stage: 'beta' })
        .expect(200);
      expect((await http.get(`/api/tasks/${t.id}`).set(auth).expect(200)).body.stage).toBeNull();
      await http.patch(`/api/apps/${ids.SR}`).set(auth).send({ stage: 'design' }).expect(400);
      await http.patch(`/api/apps/${ids.SR}`).set(auth).send({ stages: [{ key: 'a', name: '1' }, { key: 'a', name: '2' }] }).expect(400);
      await http.patch(`/api/apps/${ids.SR}`).set(auth).send({ lifecycle: 'operating' }).expect(200);
      const summaries = (await activities('SR', 'app')).map((a) => a.summary);
      expect(summaries.slice(0, 3)).toEqual(['진행 상태: 개발 중 → 운영 중', '단계 이동: 개발 → 베타', '단계 목록 변경: 기획 → 개발 → 베타']);
    });

    it('직접 남긴 메모와 종류 필터', async () => {
      const note = await http.post(`/api/apps/${ids.SR}/activities`).set(auth).send({ summary: '스토어 서류 준비 시작' }).expect(201);
      expect(note.body).toMatchObject({ kind: 'note', actor: 'me', appCode: 'SR' });
      expect((await activities('SR', 'note')).map((a) => a.summary)).toEqual(['스토어 서류 준비 시작']);
    });
  });

  describe('앱 개요와 상태', () => {
    it('개요: 숫자, 신호, 최근 배포, 다음 할 일', async () => {
      const { body } = await http.get(`/api/apps/${ids.SR}/overview`).set(auth).expect(200);
      expect(body.app).toMatchObject({ code: 'SR', lifecycle: 'operating', stage: 'beta', checkCmd: 'true' });
      expect(body.repos).toHaveLength(1);
      expect(body.counts).toMatchObject({ bugs: 1, todos: 2, overdueTodos: 1 });
      expect(body.signals).toMatchObject({ dot: 'risk', bugs: { open: 1, critical: 1 }, stage: { key: 'beta', index: 3, total: 3 } });
      expect(body.latestDeployments[0]).toMatchObject({ env: 'store', status: 'success', version: '1.0.0' });
      expect(body.nextTodos.map((t: { title: string }) => t.title)).toEqual(['도메인 연결', '스토어 심사 제출']);
      expect(body.recentActivities).toHaveLength(5);
      expect(body.costThisMonthUsd).toBeGreaterThan(0);
    });

    it('상태: 앱마다 점 색', async () => {
      const { body } = await http.get('/api/apps/status').set(auth).expect(200);
      expect(body.map((a: { code: string; signals: { dot: string } }) => [a.code, a.signals.dot])).toEqual([
        ['MR', 'ok'],
        ['SR', 'risk'],
      ]);
    });
  });

  describe('GitHub 연동', () => {
    it('배포 기록과 배포 워크플로를 가져오고, 머지된 PR의 task를 완료한다', async () => {
      const repo = (await http.get(`/api/apps/${ids.SR}/repos`).set(auth).expect(200)).body[0];
      await http.patch(`/api/repos/${repo.id}`).set(auth).send({ github: 'me/single' }).expect(200);
      const api = {
        'repos/me/single/deployments?per_page=30': [
          { id: 11, environment: 'single / production', sha: 'aaaaaaa1111', created_at: '2026-10-27T06:52:42Z' },
          { id: 10, environment: 'single / development', sha: 'bbbbbbb2222', created_at: '2026-10-26T06:52:42Z' },
        ],
        'repos/me/single/deployments/11/statuses?per_page=1': [{ state: 'failure', environment_url: 'https://single.app', created_at: '2026-10-27T06:54:00Z' }],
        'repos/me/single/deployments/10/statuses?per_page=1': [{ state: 'success', created_at: '2026-10-26T06:54:00Z' }],
        'repos/me/single/actions/workflows': { workflows: [{ name: 'CI' }, { name: '서버 배포' }, { name: '앱 출시 (안드로이드)' }] },
        'repos/me/single/actions/runs?per_page=50': {
          workflow_runs: [
            { id: 99, name: '서버 배포', status: 'completed', conclusion: 'success', head_branch: 'backend-v0.1.32', head_sha: 'ccccccc3333', html_url: 'https://gh/run/99', created_at: '2026-10-25T13:36:10Z', updated_at: '2026-10-25T13:40:00Z', display_title: '회원 Premium' },
            { id: 98, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: 'ddd', html_url: 'x', created_at: '2026-10-25T13:00:00Z', updated_at: '2026-10-25T13:01:00Z' },
          ],
        },
      };
      writeFileSync(process.env.FAKE_GH_API!, JSON.stringify(api));
      const review = (await http.get('/api/tasks?app=SR&status=review').set(auth).expect(200)).body[0];
      writeFileSync(process.env.FAKE_GH_PRS!, JSON.stringify({ [review.prUrl]: 'MERGED' }));

      const res = await http.post('/api/deployments/sync').set(auth).expect(201);
      expect(res.body).toEqual({ deployments: 3, merged: 1 });
      expect((await http.get(`/api/tasks/${review.id}`).set(auth).expect(200)).body.status).toBe('done');

      const rules = (await http.get(`/api/apps/${ids.SR}/repos`).set(auth).expect(200)).body[0].deployRules;
      expect(rules).toEqual([{ workflow: '서버 배포', env: 'production' }, { workflow: '앱 출시 (안드로이드)', env: 'store' }]);
      const list = (await http.get(`/api/apps/${ids.SR}/deployments?limit=10`).set(auth).expect(200)).body;
      expect(list.filter((d: { source: string }) => d.source !== 'claude').map((d: { env: string; status: string; version: string }) => [d.env, d.status, d.version])).toEqual([
        ['production', 'failure', 'aaaaaaa'],
        ['development', 'success', 'bbbbbbb'],
        ['production', 'success', 'backend-v0.1.32'],
      ]);
      // 다시 가져와도 바뀐 것이 없으면 0
      expect((await http.post('/api/deployments/sync').set(auth).expect(201)).body.deployments).toBe(0);
      const hist = await activities('SR', 'deploy');
      expect(hist.some((a) => a.summary === '배포 실패 · 운영 aaaaaaa (single)' && a.actor === 'github')).toBe(true);
      // 종류로 걸러도 다른 앱 것은 섞이지 않는다
      expect(await activities('MR', 'deploy')).toEqual([]);
    });
  });

  describe('Task Master 가져오기', () => {
    it('미리 보기와 덮어쓰기 (상태는 Hub 것을 둔다)', async () => {
      const tm = (tasks: object[]) => writeFileSync(join(single, '.taskmaster', 'tasks', 'tasks.json'), JSON.stringify({ master: { tasks } }));
      mkdirSync(join(single, '.taskmaster', 'tasks'), { recursive: true });
      tm([{ id: 50, title: '처음 제목', status: 'pending' }, { id: 51, title: '그대로', status: 'pending' }]);
      const first = await http.post('/api/import/taskmaster').set(auth).send({ app: 'SR' }).expect(201);
      expect(first.body).toMatchObject({ imported: 2 });
      await http.patch('/api/tasks/SR-50').set(auth).send({ status: 'doing' }).expect(200);

      tm([{ id: 50, title: '바뀐 제목', status: 'pending' }, { id: 51, title: '그대로', status: 'pending' }, { id: 52, title: '새것', status: 'pending' }]);
      const preview = await http.post('/api/import/taskmaster').set(auth).send({ app: 'SR', dryRun: true }).expect(201);
      expect(preview.body.preview).toEqual({ add: [{ tag: 'master', tmId: '52', title: '새것' }], changed: [{ id: 'SR-50', title: '바뀐 제목', fields: ['title'] }], same: 1 });
      expect((await http.get('/api/tasks/SR-50').set(auth).expect(200)).body.title).toBe('처음 제목');

      const applied = await http.post('/api/import/taskmaster').set(auth).send({ app: 'SR', update: true }).expect(201);
      expect(applied.body).toMatchObject({ imported: 1, updated: 1 });
      expect((await http.get('/api/tasks/SR-50').set(auth).expect(200)).body).toMatchObject({ title: '바뀐 제목', status: 'doing' });
    });
  });

  describe('기획 예상 비용', () => {
    it('지난 실행이 모자라면 기본값으로 범위를 낸다', async () => {
      const { json } = await call('submit_idea', {
        app: 'SR',
        body: { title: '알림', problem: 'p', proposal: 'q', expected_tasks: [{ title: 'a', size: 'S' }, { title: 'b', size: 'M' }] },
      });
      const { body } = await http.get(`/api/ideas/${json.id}`).set(auth).expect(200);
      expect(body.estimate).toEqual({ label: '러너 약 1~2시간 · 예상 $1.1~2.8', minutes: [40, 120], costUsd: [1.1, 2.8], basis: 'default' });
    });
  });

  describe('히스토리 옮겨 넣기', () => {
    it('지금까지의 기록으로 히스토리를 채운다 (Task Master task는 앱마다 한 줄)', async () => {
      const ds = app.get(DataSource);
      await ds.query('DELETE FROM activities');
      for (const sql of BACKFILL_ACTIVITIES_SQL) await ds.query(sql);
      const rows: Array<{ kind: string; n: number }> = await ds.query('SELECT kind, count(*)::int AS n FROM activities GROUP BY kind ORDER BY kind');
      const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
      expect(byKind['tasks.imported']).toBe(1);
      expect(byKind['run.finished']).toBeGreaterThanOrEqual(3);
      expect(byKind['task.created']).toBeGreaterThan(5);
      expect(byKind['idea.created']).toBe(1);
    });
  });

  describe('내 업무', () => {
    it('할 일: 추가, 기한·우선순위·완료, 문서 연결, 지우기', async () => {
      const t = (await http.post('/api/mine/todos').set(auth).send({ title: '  Apple Developer 갱신  ' }).expect(201)).body;
      expect(t).toMatchObject({ key: `ME-${t.id}`, title: 'Apple Developer 갱신', priority: 2, done: false, dueDate: null, docId: null });
      await http.post('/api/mine/todos').set(auth).send({ title: '   ' }).expect(400);
      const p = (await http.patch(`/api/mine/todos/${t.id}`).set(auth).send({ dueDate: '2026-11-01', priority: 1, done: true }).expect(200)).body;
      expect(p).toMatchObject({ dueDate: '2026-11-01', priority: 1, done: true });
      expect(p.doneAt).toBeTruthy();
      expect((await http.patch(`/api/mine/todos/${t.id}`).set(auth).send({ done: false }).expect(200)).body.doneAt).toBeNull();
      await http.patch(`/api/mine/todos/${t.id}`).set(auth).send({ docId: 999999 }).expect(404);
      await http.delete(`/api/mine/todos/${t.id}`).set(auth).expect(204);
      await http.delete(`/api/mine/todos/${t.id}`).set(auth).expect(404);
    });

    it('하위 할 일: 한 단계만, 제목·완료만. 상위를 끝내면 남은 하위도 끝나고 되돌리면 그때 끝난 것만 돌아온다. 상위를 지우면 함께 지워진다', async () => {
      const parent = (await http.post('/api/mine/todos').set(auth).send({ title: '스토어 출시 준비' }).expect(201)).body;
      const a = (await http.post('/api/mine/todos').set(auth).send({ title: '스크린샷', parentId: parent.id }).expect(201)).body;
      const b = (await http.post('/api/mine/todos').set(auth).send({ title: '개인정보처리방침 링크', parentId: parent.id }).expect(201)).body;
      expect(a.parentId).toBe(parent.id);
      await http.post('/api/mine/todos').set(auth).send({ title: '손자', parentId: a.id }).expect(400);
      await http.patch(`/api/mine/todos/${a.id}`).set(auth).send({ dueDate: '2026-11-01' }).expect(400);

      await http.patch(`/api/mine/todos/${a.id}`).set(auth).send({ done: true }).expect(200);
      await http.patch(`/api/mine/todos/${parent.id}`).set(auth).send({ done: true }).expect(200);
      const done = (await http.get('/api/mine').set(auth).expect(200)).body.todos;
      expect(done.find((x: { id: number }) => x.id === b.id).done).toBe(true);

      await http.patch(`/api/mine/todos/${parent.id}`).set(auth).send({ done: false }).expect(200);
      const back = (await http.get('/api/mine').set(auth).expect(200)).body.todos;
      expect(back.find((x: { id: number }) => x.id === a.id).done).toBe(true);
      expect(back.find((x: { id: number }) => x.id === b.id).done).toBe(false);

      await http.delete(`/api/mine/todos/${parent.id}`).set(auth).expect(204);
      const left = (await http.get('/api/mine').set(auth).expect(200)).body.todos.map((x: { id: number }) => x.id);
      expect(left).not.toContain(a.id);
      expect(left).not.toContain(b.id);
    });

    it('문서와 키 값: 값은 암호화해 두고 목록·DB·세션 맥락에는 끝 4자리만, 방식을 바꾸면 값을 지운다', async () => {
      const doc = (await http.post('/api/mine/docs').set(auth).send({ kind: 'apikey', title: 'Neople 오픈 API 키' }).expect(201)).body;
      expect(doc).toMatchObject({ secretMode: 'ref', renewLabel: '만료', hasValue: false, fields: [] });
      expect((await http.post('/api/mine/docs').set(auth).send({ kind: 'billing', title: 'Railway' }).expect(201)).body).toMatchObject({ secretMode: 'none', renewLabel: '결제' });

      await http.put(`/api/mine/docs/${doc.id}/secret`).set(auth).send({ value: 'x' }).expect(409);
      await http.patch(`/api/mine/docs/${doc.id}`).set(auth).send({ secretMode: 'value', fields: [['콘솔', 'developers.neople.co.kr']], expiresOn: '2026-11-05' }).expect(200);
      const sealed = (await http.put(`/api/mine/docs/${doc.id}/secret`).set(auth).send({ value: 'a7f3c1e9b24d40f8a1c69c21' }).expect(200)).body;
      expect(sealed).toMatchObject({ hasValue: true, secretLast4: '9c21' });

      const all = await http.get('/api/mine').set(auth).expect(200);
      expect(all.text).not.toContain('a7f3c1e9');
      const db = new DataSource({ type: 'postgres', url: process.env.HUB_DATABASE_URL });
      await db.initialize();
      const [row] = await db.query('SELECT secret_enc FROM my_docs WHERE id = $1', [doc.id]);
      await db.destroy();
      expect(row.secret_enc.startsWith('v1:')).toBe(true);
      expect(row.secret_enc).not.toContain('a7f3c1e9');
      expect(existsSync(join(process.env.HUB_HOME!, 'secret.key'))).toBe(true);
      expect((await http.get(`/api/mine/docs/${doc.id}/secret`).set(auth).expect(200)).body).toEqual({ value: 'a7f3c1e9b24d40f8a1c69c21' });

      // 세션 맥락: 이름과 끝 4자리, 만료일만
      const ctx = await http.post('/api/hooks/session-start?kind=session-start&task=').set(auth).send({ session_id: 'mine-ctx', cwd: single, source: 'startup', hook_event_name: 'SessionStart' }).expect(200);
      expect(ctx.text).toContain('- [외부 API 키] Neople 오픈 API 키 · 값은 Hub에 저장(끝 4자리 9c21) · 만료 2026-11-05');
      expect(ctx.text).not.toContain('a7f3c1e9');

      // 할 일에 연결한 뒤 문서를 지우면 연결만 풀린다
      const t = (await http.post('/api/mine/todos').set(auth).send({ title: '키 재발급' }).expect(201)).body;
      await http.patch(`/api/mine/todos/${t.id}`).set(auth).send({ docId: doc.id }).expect(200);
      const moved = (await http.patch(`/api/mine/docs/${doc.id}`).set(auth).send({ secretMode: 'ref', secretRef: '1Password · Neople' }).expect(200)).body;
      expect(moved).toMatchObject({ secretMode: 'ref', hasValue: false, secretLast4: null });
      expect((await http.get(`/api/mine/docs/${doc.id}/secret`).set(auth).expect(200)).body).toEqual({ value: '' });
      await http.delete(`/api/mine/docs/${doc.id}`).set(auth).expect(204);
      expect((await http.get('/api/mine').set(auth).expect(200)).body.todos.find((x: { id: number }) => x.id === t.id).docId).toBeNull();
    });

    it('첨부 파일: 바이트 그대로 올리고 PDF·md는 화면 안에서, 나머지는 내려받기로 열며, 문서를 지우면 파일도 지운다', async () => {
      const filesDir = join(process.env.HUB_HOME!, 'files');
      const onDisk = () => (existsSync(filesDir) ? readdirSync(filesDir).length : 0);
      const before = onDisk();
      const doc = (await http.post('/api/mine/docs').set(auth).send({ kind: 'legal', title: '임대차 계약' }).expect(201)).body;
      expect(doc.files).toEqual([]);
      const upload = (name: string, body: Buffer | string, id = doc.id) => http.post(`/api/mine/docs/${id}/files`).query({ name }).set(auth).set('Content-Type', 'application/octet-stream').send(Buffer.from(body));

      const pdf = Buffer.from('%PDF-1.4\n%fake\n');
      const withPdf = (await upload('계약서 최종.pdf', pdf).expect(201)).body;
      expect(withPdf.files).toEqual([expect.objectContaining({ docId: doc.id, name: '계약서 최종.pdf', kind: 'pdf', size: pdf.length })]);
      // 맥에서 온 풀어 쓴 한글(NFD) 이름은 모아 쓴 꼴로, 폴더 경로는 뺀다
      await upload(`a/b/${'회의록'.normalize('NFD')}.md`, '# 회의록\n- 갱신 조건').expect(201);
      const all3 = (await upload('도장.zip', 'PK..').expect(201)).body.files;
      expect(all3.map((f: { name: string; kind: string }) => [f.name, f.kind])).toEqual([
        ['계약서 최종.pdf', 'pdf'],
        ['회의록.md', 'md'],
        ['도장.zip', 'other'],
      ]);
      const [pdfFile, mdFile, zipFile] = all3;
      expect(onDisk()).toBe(before + 3);
      expect(statSync(join(filesDir, readdirSync(filesDir)[0])).mode & 0o777).toBe(0o600);
      expect((await http.get('/api/mine').set(auth).expect(200)).body.docs.find((d: { id: number }) => d.id === doc.id).files).toHaveLength(3);

      // PDF: 화면 안 보기, sandbox CSP 없음(브라우저 PDF 보기가 뜨게)
      const pdfRes = await http.get(pdfFile.url).set(auth).expect(200);
      expect(pdfRes.headers['content-type']).toBe('application/pdf');
      expect(pdfRes.headers['content-disposition']).toBe(`inline; filename="___ __.pdf"; filename*=UTF-8''${encodeURIComponent('계약서 최종.pdf')}`);
      expect(pdfRes.headers['content-security-policy']).toBeUndefined();
      expect(Number(pdfRes.headers['content-length'])).toBe(pdf.length);
      // md: 글자 그대로(text/plain), 스크립트는 막는다. ?download=1이면 내려받기
      const mdRes = await http.get(mdFile.url).set(auth).expect(200);
      expect(mdRes.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(mdRes.headers['content-security-policy']).toBe('sandbox');
      expect(mdRes.text).toBe('# 회의록\n- 갱신 조건');
      expect((await http.get(`${mdFile.url}?download=1`).set(auth).expect(200)).headers['content-disposition']).toMatch(/^attachment; /);
      // 볼 수 없는 파일은 늘 내려받기
      const zipRes = await http.get(zipFile.url).set(auth).expect(200);
      expect(zipRes.headers['content-type']).toBe('application/octet-stream');
      expect(zipRes.headers['content-disposition']).toMatch(/^attachment; /);

      // 거절: 빈 파일, 이름 없음, 없는 문서, 20MB 넘는 파일
      await upload('빈.txt', '').expect(400);
      await http.post(`/api/mine/docs/${doc.id}/files`).set(auth).set('Content-Type', 'application/octet-stream').send(Buffer.from('x')).expect(400);
      await upload('x.txt', 'x', 999999).expect(404);
      const big = await upload('큰 파일.pdf', Buffer.alloc(20 * 1024 * 1024 + 1)).expect(413);
      expect(big.body.error.message).toContain('20MB');
      expect(onDisk()).toBe(before + 3);

      // 하나 지우기
      expect((await http.delete(`/api/mine/files/${zipFile.id}`).set(auth).expect(200)).body.files.map((f: { id: number }) => f.id)).toEqual([pdfFile.id, mdFile.id]);
      await http.get(zipFile.url).set(auth).expect(404);
      expect(onDisk()).toBe(before + 2);
      // 문서의 다른 수정 응답에도 첨부가 실려 온다
      expect((await http.patch(`/api/mine/docs/${doc.id}`).set(auth).send({ memo: '원본은 금고' }).expect(200)).body.files).toHaveLength(2);

      // 문서를 지우면 첨부 내용도 지운다
      await http.delete(`/api/mine/docs/${doc.id}`).set(auth).expect(204);
      await http.get(pdfFile.url).set(auth).expect(404);
      expect(onDisk()).toBe(before);
    });
  });

  describe('앱별 노트', () => {
    it('만들고 고치고 지운다. 목록은 고정 먼저, 그다음 최근 수정순', async () => {
      const appId = ids.SR;
      expect((await http.get(`/api/apps/${appId}/notes`).set(auth).expect(200)).body).toEqual([]);

      const a = (await http.post(`/api/apps/${appId}/notes`).set(auth).send({ title: '자주 쓰는 명령어', folder: '  명령어 ', body: '```\npnpm dev\n```' }).expect(201)).body;
      expect(a).toMatchObject({ appId, title: '자주 쓰는 명령어', folder: '명령어', body: '```\npnpm dev\n```', pinned: false });
      // 비어 있는 값으로도 만들 수 있다 (화면에서 "새 노트"를 누르면 빈 노트가 생긴다)
      const b = (await http.post(`/api/apps/${appId}/notes`).set(auth).send({}).expect(201)).body;
      expect(b).toMatchObject({ title: '', folder: '', body: '', pinned: false });

      // 최근 수정순: b가 나중에 생겼으니 먼저
      let list = (await http.get(`/api/apps/${appId}/notes`).set(auth).expect(200)).body;
      expect(list.map((n: { id: number }) => n.id)).toEqual([b.id, a.id]);

      // a를 고정하면 맨 위로
      const pinned = (await http.patch(`/api/notes/${a.id}`).set(auth).send({ pinned: true }).expect(200)).body;
      expect(pinned.pinned).toBe(true);
      list = (await http.get(`/api/apps/${appId}/notes`).set(auth).expect(200)).body;
      expect(list.map((n: { id: number }) => n.id)).toEqual([a.id, b.id]);

      // 본문만 고치면 나머지는 그대로
      const edited = (await http.patch(`/api/notes/${b.id}`).set(auth).send({ body: '- [ ] 스토어 심사 제출' }).expect(200)).body;
      expect(edited).toMatchObject({ title: '', folder: '', body: '- [ ] 스토어 심사 제출', pinned: false });

      // 길이 제한과 없는 노트
      await http.patch(`/api/notes/${b.id}`).set(auth).send({ folder: 'x'.repeat(101) }).expect(400);
      await http.patch('/api/notes/999999').set(auth).send({ title: 'x' }).expect(404);
      await http.get('/api/apps/999999/notes').set(auth).expect(404);

      await http.delete(`/api/notes/${b.id}`).set(auth).expect(204);
      await http.delete(`/api/notes/${b.id}`).set(auth).expect(404);
      list = (await http.get(`/api/apps/${appId}/notes`).set(auth).expect(200)).body;
      expect(list.map((n: { id: number }) => n.id)).toEqual([a.id]);
      // 다른 앱 목록에는 안 보인다
      expect((await http.get(`/api/apps/${ids.MR}/notes`).set(auth).expect(200)).body).toEqual([]);
    });
  });

  describe('규칙 화면의 CLAUDE.md', () => {
    it('전역·앱 폴더·다른 곳의 저장소 CLAUDE.md를 보여 주고, 열었을 때와 바뀌었으면 덮어쓰지 않는다', async () => {
      await http.post(`/api/apps/${ids.MR}/repos/detect`).set(auth).expect(201);
      const list = (await http.get('/api/rules/claude-md').set(auth).expect(200)).body;
      const keys = list.map((f: { key: string }) => f.key);
      expect(keys[0]).toBe('global');
      expect(keys).toContain('app:MR');
      expect(keys).toContain('app:SR');
      // MR은 저장소 두 개가 앱 폴더 아래에 따로 있고, SR은 앱 폴더가 곧 저장소라 한 번만 나온다.
      expect(keys.filter((k: string) => k.startsWith('repo:'))).toHaveLength(2);
      expect(list.find((f: { key: string }) => f.key === 'app:SR')).toMatchObject({ exists: false, path: join(single, 'CLAUDE.md') });

      const empty = (await http.get('/api/rules/claude-md/app:SR').set(auth).expect(200)).body;
      expect(empty).toMatchObject({ exists: false, text: '' });
      const saved = (await http.put('/api/rules/claude-md/app:SR').set(auth).send({ text: '# 규칙\n- 테스트 먼저', version: empty.version }).expect(200)).body;
      expect(readFileSync(join(single, 'CLAUDE.md'), 'utf8')).toBe('# 규칙\n- 테스트 먼저\n');
      expect(saved).toMatchObject({ exists: true, text: '# 규칙\n- 테스트 먼저\n' });

      // 터미널에서 고친 뒤 예전 version으로 저장하면 409
      writeFileSync(join(single, 'CLAUDE.md'), '# 터미널에서 고침\n');
      await http.put('/api/rules/claude-md/app:SR').set(auth).send({ text: '덮어쓰기', version: saved.version }).expect(409);
      expect(readFileSync(join(single, 'CLAUDE.md'), 'utf8')).toBe('# 터미널에서 고침\n');

      const g = (await http.get('/api/rules/claude-md/global').set(auth).expect(200)).body;
      await http.put('/api/rules/claude-md/global').set(auth).send({ text: '전역', version: g.version }).expect(200);
      expect(readFileSync(join(process.env.HUB_CLAUDE_HOME!, 'CLAUDE.md'), 'utf8')).toBe('전역\n');
      await http.get('/api/rules/claude-md/..%2Fetc').set(auth).expect(404);
    });
  });

  describe('환경: 스킬·플러그인·커넥터', () => {
    const home = process.env.HUB_CLAUDE_HOME!;
    const put = (path: string, text: string) => {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
    };

    it('직접 설치·계정 동기화 플러그인, 사용자·동기화·플러그인·프로젝트 스킬과 명령을 읽는다', async () => {
      const local = join(root, 'plugin-cache', 'tools');
      put(join(local, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', version: '1.2.0', description: '도구 모음' }));
      put(join(local, 'skills', 'lint', 'SKILL.md'), '---\nname: lint\ndescription: 린트를 돌린다\n---\n');
      put(join(local, 'commands', 'fix.md'), '---\ndescription: 고친다\n---\n본문');
      put(join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'tools@market': [{ scope: 'user', version: '1.2.0', installPath: local }] } }));
      put(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'tools@market': false } }));

      const acc = join(home, 'plugins', 'synced', 'org_user');
      put(join(acc, 'manifest.json'), JSON.stringify({ plugins: [{ name: 'abc', version: '0002', generation: 2, marketplaceName: 'dir' }] }));
      put(join(acc, 'abc~g2', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'design', version: '2.0.0' }));
      put(join(acc, 'abc~g2', 'skills', 'critique', 'SKILL.md'), '---\nname: critique\ndescription: >-\n  디자인을\n  평가한다\n---\n');
      put(join(acc, 'abc', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'design', version: '1.0.0' }));

      put(join(home, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\ndescription: 내 스킬\n---\n');
      put(join(home, 'skills', 'synced', 'org_user', 'manifest.json'), JSON.stringify({ skills: [{ name: 'docx', description: '워드 문서' }] }));
      put(join(home, 'commands', 'hub-task.md'), '---\ndescription: Hub task 하나를 진행한다\n---\n');
      put(join(single, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: 배포한다\n---\n');

      const { body } = await http.get('/api/environment').set(auth).expect(200);
      expect(body.plugins).toEqual([
        expect.objectContaining({ name: 'design', source: 'claude_ai', version: '2.0.0', marketplace: 'dir', enabled: true, skills: 1, commands: 0 }),
        expect.objectContaining({ name: 'tools', source: 'local', version: '1.2.0', description: '도구 모음', marketplace: 'market', enabled: false, skills: 1, commands: 1 }),
      ]);
      const key = (s: { kind: string; source: string; name: string; plugin: string | null; appCode: string | null }) => `${s.kind}:${s.source}:${s.plugin ?? s.appCode ?? ''}:${s.name}`;
      expect(body.skills.map(key).sort()).toEqual(
        ['command:local::hub-task', 'command:plugin:tools:fix', 'skill:claude_ai::docx', 'skill:local::mine', 'skill:plugin:design:critique', 'skill:plugin:tools:lint', 'skill:project:SR:deploy'].sort(),
      );
      expect(body.skills.find((s: { name: string }) => s.name === 'critique').description).toBe('디자인을 평가한다');

      // 처음 열면 한국어 요약을 뒤에서 만들고, 다음에 열면 붙어 나온다.
      expect(body.ko).toMatchObject({ running: true, total: 9 });
      let ko = body.ko;
      for (let i = 0; i < 50 && ko.running; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        ko = (await http.get('/api/environment/ko').set(auth).expect(200)).body;
      }
      expect(ko).toMatchObject({ running: false, done: 9, error: null });
      const again = (await http.get('/api/environment').set(auth).expect(200)).body;
      expect(again.ko.running).toBe(false);
      expect(again.plugins.find((p: { name: string }) => p.name === 'tools').ko).toBe('요약: tools');
      expect(again.skills.find((s: { name: string }) => s.name === 'critique').ko).toBe('요약: design:critique');
    });

    it('커넥터·MCP: 처음 부르면 claude mcp list 확인을 시작하고, 끝나면 상태를 돌려준다', async () => {
      const first = (await http.get('/api/environment/mcp').set(auth).expect(200)).body;
      expect(first.running || first.checkedAt).toBeTruthy();
      let state = first;
      for (let i = 0; i < 50 && !state.checkedAt; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        state = (await http.get('/api/environment/mcp').set(auth).expect(200)).body;
      }
      expect(state.servers.map((s: { source: string; name: string; status: string }) => `${s.source}:${s.name}:${s.status}`)).toEqual(['claude_ai:Gmail:connected', 'plugin:pdf:failed', 'local:hub:connected']);
      // 확인이 끝나면 커넥터의 한국어 한 줄도 만든다.
      for (let i = 0; i < 50 && !state.servers[0].ko; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        state = (await http.get('/api/environment/mcp').set(auth).expect(200)).body;
      }
      expect(state.servers[0].ko).toBe('요약: Gmail');
      const again = (await http.post('/api/environment/mcp/check').set(auth).expect(202)).body;
      expect(again.servers).toHaveLength(3);
    });
  });

  describe('비밀번호 로그인', () => {
    const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    it('비밀번호를 정하기 전에는 Hub 토큰으로 들어오고, 쿠키로 API를 쓴다', async () => {
      expect((await http.get('/api/auth/me').expect(200)).body).toEqual({ loggedIn: false, passwordSet: false });
      await http.post('/api/auth/login').send({ password: 'wrong' }).expect(401);
      const res = await http.post('/api/auth/login').send({ password: TOKEN, remember: true }).expect(200);
      expect(res.headers['set-cookie'][0]).toContain('HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000');
      const cookie = cookieOf(res);
      await http.get('/api/apps').set('Cookie', cookie).expect(200);
      // 쿠키로 데이터를 바꿀 때 다른 사이트에서 온 요청은 막는다
      await http.post(`/api/apps/${ids.SR}/activities`).set('Cookie', cookie).set('Origin', 'https://evil.example').send({ summary: 'x' }).expect(403);
      await http.post(`/api/apps/${ids.SR}/activities`).set('Cookie', cookie).set('Origin', baseUrl).send({ summary: '화면에서 남김' }).expect(201);
    });

    it('비밀번호를 정하면 이전 쿠키는 무효, 5번 틀리면 10분 잠금', async () => {
      const old = cookieOf(await http.post('/api/auth/login').send({ password: TOKEN }).expect(200));
      await http.put('/api/auth/password').set(auth).send({ password: '1234' }).expect(204);
      await http.get('/api/apps').set('Cookie', old).expect(401);
      expect((await http.get('/api/auth/me').expect(200)).body.passwordSet).toBe(true);
      await http.post('/api/auth/login').send({ password: TOKEN }).expect(401);

      for (let i = 0; i < 3; i += 1) await http.post('/api/auth/login').send({ password: 'nope' }).expect(401);
      const last = await http.post('/api/auth/login').send({ password: 'nope' }).expect(429);
      expect(last.body.error.message).toContain('10분');
      await http.post('/api/auth/login').send({ password: '1234' }).expect(429);
    });
  });
});
