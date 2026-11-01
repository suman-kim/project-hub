import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';

const TOKEN = 'test-token';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-ideas-')));
const claudeHome = join(root, 'claude-home');
process.env.HUB_TOKEN = TOKEN;
process.env.HUB_CLAUDE_HOME = claudeHome;
process.env.HUB_DATABASE_URL = process.env.HUB_TEST_DATABASE_URL || 'postgres://hub:hub@127.0.0.1:5434/hub_test';
process.env.HUB_HOME = join(root, 'hub-home');
process.env.HUB_CLAUDE_BIN = join(__dirname, 'fixtures', 'fake-claude.js');
process.env.HUB_GH_BIN = join(__dirname, 'fixtures', 'fake-gh.js');
process.env.HUB_CAFFEINATE = '0';
process.env.FAKE_CLAUDE_ARGS_LOG = join(root, 'claude-args.jsonl');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureApp } = require('../src/bootstrap');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SchedulerService } = require('../src/modules/scheduler/scheduler.service');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd }).toString().trim();
const lastClaudeCall = () => readFileSync(process.env.FAKE_CLAUDE_ARGS_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();

describe('M5 기획·규칙 e2e', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  const auth = { 'X-Hub-Token': TOKEN };
  const repo = join(root, 'link');
  const rulesFile = join(claudeHome, 'rules', 'hub-rules.md');

  const waitRun = async (id: number, statuses = ['done', 'failed', 'stopped']) => {
    for (let i = 0; i < 75; i += 1) {
      const res = await http.get(`/api/runs/${id}`).set(auth).expect(200);
      if (statuses.includes(res.body.status)) return res.body;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`run ${id}가 끝나지 않았다`);
  };

  beforeAll(async () => {
    const reset = new DataSource({ type: 'postgres', url: process.env.HUB_DATABASE_URL });
    await reset.initialize();
    await reset.query('DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    // 사람이 쓴 초안 규칙 파일이 이미 있는 상태
    mkdirSync(join(claudeHome, 'rules'), { recursive: true });
    writeFileSync(rulesFile, '# 작업 규칙\n\n<!-- 초안 -->\n\n1. 첫 규칙\n2. 둘째 규칙\n');

    const origin = join(root, 'origin.git');
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
    http = request(app.getHttpServer());
    await http
      .post('/api/apps')
      .set(auth)
      .send({ code: 'LK', name: 'Link', repoPath: repo, folderNames: ['link'], directionNote: '체류 시간을 늘린다' })
      .expect(201);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  describe('규칙', () => {
    it('처음 뜰 때 기존 파일의 규칙을 가져오고 파일은 건드리지 않는다', async () => {
      const res = await http.get('/api/rules').set(auth).expect(200);
      expect(res.body.rules.map((r: { body: string; scope: string }) => [r.scope, r.body])).toEqual([
        ['global', '첫 규칙'],
        ['global', '둘째 규칙'],
      ]);
      expect(readFileSync(rulesFile, 'utf8')).toContain('<!-- 초안 -->');
    });

    it('PUT하면 DB와 파일을 바꾼다 (임시 파일을 남기지 않는다)', async () => {
      const res = await http
        .put('/api/rules')
        .set(auth)
        .send({ rules: [{ body: '전역 A' }, { body: '전역 B\n둘째 줄' }, { app: 'LK', body: 'LK 전용' }] })
        .expect(200);
      expect(res.body.rules.map((r: { scope: string; appCode: string | null; position: number }) => [r.scope, r.appCode, r.position])).toEqual([
        ['global', null, 1],
        ['global', null, 2],
        ['app', 'LK', 1],
      ]);
      const text = readFileSync(rulesFile, 'utf8');
      expect(text).toContain('1. 전역 A\n2. 전역 B\n   둘째 줄');
      expect(text).toContain('## Link (LK)에서만\n\n1. LK 전용');
      expect(readdirSync(join(claudeHome, 'rules'))).toEqual(['hub-rules.md']);
    });

    it('없는 앱 규칙은 거부하고 파일은 그대로', async () => {
      const before = readFileSync(rulesFile, 'utf8');
      await http.put('/api/rules').set(auth).send({ rules: [{ app: 'ZZ', body: 'x' }] }).expect(400);
      expect(readFileSync(rulesFile, 'utf8')).toBe(before);
    });
  });

  describe('기획', () => {
    let ideaId: number;

    it('즉시 생성: 저장소 원본에서 읽기 전용으로 돌고 pending v1이 생긴다', async () => {
      const { body: run } = await http.post('/api/apps/1/ideas/generate').set(auth).expect(201);
      expect(run).toMatchObject({ kind: 'idea_gen', status: 'queued', taskId: null });
      const done = await waitRun(run.id);
      expect(done.status).toBe('done');
      ideaId = done.result.idea.resultIdeaId;

      const call = lastClaudeCall();
      expect(call.cwd).toBe(repo);
      expect(call.args).toEqual(expect.arrayContaining(['--permission-mode', 'dontAsk', '--allowedTools', 'Read,Grep,Glob']));
      expect(call.env.HUB_TASK_ID).toBeUndefined();
      const prompt = call.args[call.args.indexOf('-p') + 1];
      expect(prompt).toContain('체류 시간을 늘린다');

      const idea = (await http.get(`/api/ideas/${ideaId}`).set(auth).expect(200)).body;
      expect(idea).toMatchObject({ appCode: 'LK', title: '자동 기획', status: 'pending', currentVersion: 1 });
      expect(idea.versions[0].body.expectedTasks).toHaveLength(2);
      expect(idea.versions[0].runId).toBe(run.id);
    });

    it('수정 요청: revising을 거쳐 v2 pending', async () => {
      const { body: run } = await http.post(`/api/ideas/${ideaId}/revise`).set(auth).send({ note: '범위를 줄여 줘' }).expect(201);
      expect((await http.get(`/api/ideas/${ideaId}`).set(auth)).body.status).toMatch(/revising|pending/);
      await waitRun(run.id);
      const idea = (await http.get(`/api/ideas/${ideaId}`).set(auth)).body;
      expect(idea).toMatchObject({ status: 'pending', currentVersion: 2, title: '수정됨: 범위를 줄여 줘' });
      expect(idea.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      expect(idea.versions[0].revisionNote).toBe('범위를 줄여 줘');
      const prompt = lastClaudeCall().args[lastClaudeCall().args.indexOf('-p') + 1];
      expect(prompt).toContain('기획 #' + ideaId + ' v1');
    });

    it('수정 run이 실패하면 원래 버전 그대로 pending', async () => {
      const { body: run } = await http.post(`/api/ideas/${ideaId}/revise`).set(auth).send({ note: 'IDEA_FAIL' }).expect(201);
      const failed = await waitRun(run.id);
      expect(failed.status).toBe('failed');
      expect((await http.get(`/api/ideas/${ideaId}`).set(auth)).body).toMatchObject({ status: 'pending', currentVersion: 2 });
    });

    it('승인: task가 생기고 기획 명세가 붙으며, 바로 실행할 수 있다', async () => {
      const { body } = await http.post(`/api/ideas/${ideaId}/approve`).set(auth).expect(201);
      expect(body.idea.status).toBe('approved');
      expect(body.tasks.map((t: { title: string; ideaId: number; status: string }) => [t.title, t.ideaId, t.status])).toEqual([
        ['첫 task', ideaId, 'todo'],
        ['둘째 task', ideaId, 'todo'],
      ]);
      // 범위를 벗어난 순번(5)은 버리고 앞선 task만 의존한다.
      expect(body.tasks[1].dependsOn).toEqual([body.tasks[0].id]);

      const ctx = await http
        .post('/api/hooks/session-start?task=' + body.tasks[0].id)
        .set(auth)
        .send({ session_id: 's-approve', cwd: repo, source: 'startup' })
        .expect(200);
      expect(ctx.text).toMatch(/spec id \d+ \[spec\] 수정됨: 범위를 줄여 줘/);

      const { body: run } = await http.post(`/api/tasks/${body.tasks[0].id}/run`).set(auth).expect(201);
      const done = await waitRun(run.id);
      expect(done.status).toBe('done');
      const prompt = lastClaudeCall().args[lastClaudeCall().args.indexOf('-p') + 1];
      expect(prompt).toContain('## 기획 명세: 수정됨: 범위를 줄여 줘');
    }, 30000);

    it('승인된 기획은 다시 승인·수정할 수 없다', async () => {
      await http.post(`/api/ideas/${ideaId}/approve`).set(auth).expect(409);
      await http.post(`/api/ideas/${ideaId}/revise`).set(auth).send({ note: 'x' }).expect(409);
    });

    it('반려 사유는 다음 생성 프롬프트에 들어간다', async () => {
      const { body: run } = await http.post('/api/apps/1/ideas/generate').set(auth).expect(201);
      const done = await waitRun(run.id);
      const id = done.result.idea.resultIdeaId;
      const rejected = await http.post(`/api/ideas/${id}/reject`).set(auth).send({ reason: '지금은 결제가 먼저다' }).expect(201);
      expect(rejected.body).toMatchObject({ status: 'rejected', rejectReason: '지금은 결제가 먼저다' });

      const { body: next } = await http.post('/api/apps/1/ideas/generate').set(auth).expect(201);
      await waitRun(next.id);
      const prompt = lastClaudeCall().args[lastClaudeCall().args.indexOf('-p') + 1];
      expect(prompt).toContain(`#${id} [rejected] 자동 기획 — 반려 사유: 지금은 결제가 먼저다`);

      const list = (await http.get('/api/ideas?status=pending,rejected').set(auth)).body;
      expect(list.map((i: { status: string }) => i.status).sort()).toEqual(['pending', 'rejected']);
    }, 30000);
  });

  describe('생성 주기', () => {
    const schedules = async () =>
      app.get(DataSource).query("SELECT name, cron, timezone FROM pgboss.schedule WHERE name LIKE 'idea-cron-%'");
    const waitSchedules = async (n: number) => {
      for (let i = 0; i < 25; i += 1) {
        const rows = await schedules();
        if (rows.length === n) return rows;
        await new Promise((r) => setTimeout(r, 100));
      }
      return schedules();
    };

    it('앱의 idea_cron을 바꾸면 schedule이 따라 바뀐다', async () => {
      await http.patch('/api/apps/1').set(auth).send({ ideaCron: '0 9 * * 1' }).expect(200);
      expect(await waitSchedules(1)).toEqual([{ name: 'idea-cron-lk', cron: '0 9 * * 1', timezone: 'Asia/Seoul' }]);
      await http.patch('/api/apps/1').set(auth).send({ ideaCron: null }).expect(200);
      expect(await waitSchedules(0)).toEqual([]);
    });

    it('cron 형식이 틀리면 400', () => http.patch('/api/apps/1').set(auth).send({ ideaCron: 'every day' }).expect(400));

    it('사용량이 한도의 80%를 넘으면 자동 생성을 건너뛴다', async () => {
      const ds = app.get(DataSource);
      const future = Math.floor(Date.now() / 1000) + 3600;
      const rateLimit = (resetsAt: number) => ({
        status: 'allowed',
        unifiedWindows: { five_hour: { utilization: 0.9, resetsAt, status: 'allowed' } },
      });
      await ds.query(`INSERT INTO runs (kind, status, result) VALUES ('implement', 'done', $1)`, [{ rateLimit: rateLimit(future) }]);
      const scheduler = app.get(SchedulerService);
      expect(await scheduler.fire(1)).toBe('skipped_usage');

      // 창이 이미 초기화됐으면 예전 사용률은 보지 않는다.
      await ds.query(`INSERT INTO runs (kind, status, result) VALUES ('implement', 'done', $1)`, [
        { rateLimit: rateLimit(Math.floor(Date.now() / 1000) - 60) },
      ]);
      expect(await scheduler.fire(1)).toBe('started');
      const [auto] = await ds.query(`SELECT id FROM runs WHERE kind = 'idea_gen' AND (result->'idea'->>'auto')::boolean ORDER BY id DESC LIMIT 1`);
      await waitRun(auto.id);
    }, 30000);
  });
});
