import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';

const TOKEN = 'test-token';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-concepts-')));
const projects = join(root, 'projects');
const remotes = join(root, 'remotes');
const claudeJson = join(root, 'claude.json');
process.env.HUB_TOKEN = TOKEN;
process.env.HUB_CLAUDE_HOME = join(root, 'claude-home');
process.env.HUB_CLAUDE_JSON = claudeJson;
process.env.HUB_PROJECT_ROOT = projects;
process.env.HUB_DATABASE_URL = process.env.HUB_TEST_DATABASE_URL || 'postgres://hub:hub@127.0.0.1:5434/hub_test';
process.env.HUB_HOME = join(root, 'hub-home');
process.env.HUB_CLAUDE_BIN = join(__dirname, 'fixtures', 'fake-claude.js');
process.env.HUB_GH_BIN = join(__dirname, 'fixtures', 'fake-gh.js');
process.env.HUB_CAFFEINATE = '0';
process.env.FAKE_CLAUDE_ARGS_LOG = join(root, 'claude-args.jsonl');
process.env.FAKE_CLAUDE_BG_STATE = join(root, 'bg-sessions.json');
process.env.FAKE_GH_REMOTES = remotes;
// Hub가 하는 첫 커밋의 작성자
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'hub';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'hub@test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureApp } = require('../src/bootstrap');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RunQueueService } = require('../src/modules/runner/run-queue.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CONCEPT_CRON } = require('../src/modules/scheduler/scheduler.service');

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd }).toString().trim();
const claudeCalls = () => readFileSync(process.env.FAKE_CLAUDE_ARGS_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const lastClaudeCall = () => claudeCalls().pop();

describe('새 앱 기획 e2e', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  const auth = { 'X-Hub-Token': TOKEN };

  const waitRun = async (id: number, statuses = ['done', 'failed', 'stopped']) => {
    for (let i = 0; i < 75; i += 1) {
      const res = await http.get(`/api/runs/${id}`).set(auth).expect(200);
      if (statuses.includes(res.body.status)) return res.body;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`run ${id}가 끝나지 않았다`);
  };
  const generate = async (note: string) => {
    const { body: run } = await http.post('/api/concepts/generate').set(auth).send({ note }).expect(201);
    const done = await waitRun(run.id);
    expect(done.status).toBe('done');
    return done.result.idea.resultIdeaId as number;
  };

  beforeAll(async () => {
    const reset = new DataSource({ type: 'postgres', url: process.env.HUB_DATABASE_URL });
    await reset.initialize();
    await reset.query('DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    mkdirSync(join(projects, 'existing-folder'), { recursive: true });
    mkdirSync(remotes);
    // 다른 Claude 설정이 들어 있는 상태. hub MCP는 등록되어 있지 않다.
    writeFileSync(
      claudeJson,
      JSON.stringify({ numStartups: 3, mcpServers: { pencil: {} }, projects: { '/somewhere': { hasTrustDialogAccepted: true, allowedTools: ['Read'] } } }),
      { mode: 0o600 },
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    http = request(app.getHttpServer());
    await http.post('/api/apps').set(auth).send({ code: 'LK', name: 'Link', repoPath: join(root, 'link'), folderNames: ['link'] }).expect(201);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  describe('설정', () => {
    it('기본값과 수정, 자동 생성 주기 등록·해제', async () => {
      const def = await http.get('/api/settings/ideation').set(auth).expect(200);
      expect(def.body).toEqual({ directionNote: null, cron: null, projectRoot: projects, githubOwner: null, sessionPermissionMode: 'auto' });

      const res = await http
        .patch('/api/settings/ideation')
        .set(auth)
        .send({ directionNote: '1인 개발, Node', cron: '0 9 * * 6' })
        .expect(200);
      expect(res.body).toMatchObject({ directionNote: '1인 개발, Node', cron: '0 9 * * 6', projectRoot: projects });
      const queue = app.get(RunQueueService);
      await new Promise((r) => setTimeout(r, 300));
      expect(await queue.scheduledNames()).toContain(CONCEPT_CRON);

      await http.patch('/api/settings/ideation').set(auth).send({ cron: null }).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect(await queue.scheduledNames()).not.toContain(CONCEPT_CRON);

      await http.patch('/api/settings/ideation').set(auth).send({ cron: 'every day' }).expect(400);
      await http.patch('/api/settings/ideation').set(auth).send({ projectRoot: 'relative/path' }).expect(400);
      await http.patch('/api/settings/ideation').set(auth).send({ sessionPermissionMode: 'bypassPermissions' }).expect(400);
    });
  });

  describe('생성', () => {
    let ideaId: number;

    it('웹 조사를 포함해 ~/.hub/ideation에서 돌고, 앱 없는 pending 기획이 생긴다', async () => {
      ideaId = await generate('code:NW folder:new-web');
      const call = lastClaudeCall();
      expect(call.cwd).toBe(join(root, 'hub-home', 'ideation'));
      const tools = call.args[call.args.indexOf('--allowedTools') + 1];
      expect(tools).toBe('Read,Grep,Glob,WebSearch,WebFetch');
      expect(call.args[call.args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
      const prompt = call.args[call.args.indexOf('-p') + 1];
      expect(prompt).toContain('1인 개발, Node');
      expect(prompt).toContain('code:NW folder:new-web');
      expect(prompt).toContain('이미 쓰는 앱 코드: LK');
      expect(prompt).toContain('existing-folder');

      const { body } = await http.get(`/api/ideas/${ideaId}`).set(auth).expect(200);
      expect(body).toMatchObject({ kind: 'app', appCode: null, status: 'pending', currentVersion: 1, title: '새 앱' });
      expect(body.versions[0].body.concept).toMatchObject({ oneLiner: '한 줄 소개 code:NW folder:new-web', app: { code: 'NW', folder: 'new-web' } });
      expect(body.versions[0].body.proposal).toBe('해결');
    });

    it('종류로 거른다', async () => {
      const apps = await http.get('/api/ideas?kind=app').set(auth).expect(200);
      expect(apps.body.map((i: { id: number }) => i.id)).toEqual([ideaId]);
      const features = await http.get('/api/ideas?kind=feature').set(auth).expect(200);
      expect(features.body).toEqual([]);
    });

    it('수정 요청은 다음 버전, 후보 깊게 쓰기는 새 기획', async () => {
      const { body: run } = await http.post(`/api/ideas/${ideaId}/revise`).set(auth).send({ note: '타깃을 좁혀' }).expect(201);
      await waitRun(run.id);
      const revised = await http.get(`/api/ideas/${ideaId}`).set(auth).expect(200);
      expect(revised.body).toMatchObject({ status: 'pending', currentVersion: 2, title: '수정됨: 타깃을 좁혀' });

      const { body: devRun } = await http.post(`/api/ideas/${ideaId}/develop`).set(auth).send({ index: 0 }).expect(201);
      const done = await waitRun(devRun.id);
      const dev = await http.get(`/api/ideas/${done.result.idea.resultIdeaId}`).set(auth).expect(200);
      expect(dev.body).toMatchObject({ kind: 'app', title: '다른 후보' });
      await http.post(`/api/ideas/${ideaId}/develop`).set(auth).send({ index: 5 }).expect(404);
    });
  });

  describe('승인 → 새 앱 시작', () => {
    it('앱 코드·폴더가 형식에 맞지 않거나 앱 코드가 겹치면 거부', async () => {
      const id = await generate('code:BAD1 folder:x');
      await http.post(`/api/ideas/${id}/approve`).set(auth).send({}).expect(400);
      await http.post(`/api/ideas/${id}/approve`).set(auth).send({ app: { code: 'OK', folder: 'Bad Folder' } }).expect(400);
      await http.post(`/api/ideas/${id}/approve`).set(auth).send({ app: { code: 'LK', folder: 'fresh' } }).expect(409);
      const still = await http.get(`/api/ideas/${id}`).set(auth).expect(200);
      expect(still.body.status).toBe('pending');
    });

    it('앱·task 등록 → 폴더·첫 커밋·비공개 저장소 → 신뢰 등록 → claude --bg --rc', async () => {
      const id = await generate('code:NW folder:new-web');
      const res = await http.post(`/api/ideas/${id}/approve`).set(auth).send({ app: { name: '뉴웹' } }).expect(201);
      expect(res.body.idea).toMatchObject({ kind: 'app', appCode: 'NW', status: 'approved' });
      expect(res.body.app).toMatchObject({ code: 'NW', name: '뉴웹', repoPath: join(projects, 'new-web'), folderNames: ['new-web'] });
      expect(res.body.tasks.map((t: { id: string; dependsOn: string[] }) => [t.id, t.dependsOn])).toEqual([
        ['NW-1', []],
        ['NW-2', ['NW-1']],
      ]);
      expect(res.body.run).toMatchObject({ kind: 'bootstrap', status: 'queued' });

      const done = await waitRun(res.body.run.id);
      expect(done.status).toBe('done');
      expect(done.result.bootstrap).toMatchObject({
        repoUrl: 'https://github.com/test/new-web',
        firstTaskId: 'NW-1',
        rc: { name: 'NW 뉴웹', verified: true, id: 'bg1', link: 'https://claude.ai/code/session_fakebg1' },
      });
      expect(done.result.bootstrap.fallbackRunId).toBeUndefined();

      // 폴더와 첫 커밋, 원격 main
      const dir = join(projects, 'new-web');
      expect(readFileSync(join(dir, 'docs', 'concept.md'), 'utf8')).toContain('## 비슷한 서비스\n- [경쟁 서비스](https://example.com): 더 단순하다');
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('main에 직접 커밋하거나 push하지 않는다');
      expect(git(dir, 'log', '--format=%s')).toBe(`NW: 프로젝트 시작 (Hub 기획 #${id})`);
      expect(git(dir, 'ls-remote', '--heads', 'origin', 'main')).toContain('refs/heads/main');

      // 신뢰 등록: 다른 설정은 그대로 두고 이 폴더만 더한다
      const cj = JSON.parse(readFileSync(claudeJson, 'utf8'));
      expect(cj.numStartups).toBe(3);
      expect(cj.projects['/somewhere']).toEqual({ hasTrustDialogAccepted: true, allowedTools: ['Read'] });
      expect(cj.projects[dir]).toMatchObject({ hasTrustDialogAccepted: true, allowedTools: [], mcpServers: {} });
      expect(statSync(claudeJson).mode & 0o777).toBe(0o600);

      // claude --bg --rc 인자와 환경
      const call = claudeCalls().find((c) => c.args.includes('--bg'));
      expect(call.cwd).toBe(dir);
      expect(call.env).toMatchObject({ HUB_TASK_ID: 'NW-1', HUB_RUN_ID: String(done.id) });
      expect(call.args[0]).toContain('첫 task NW-1 "프로젝트 뼈대"');
      expect(call.args[0]).toContain('UI 디자인');
      expect(call.args.slice(1, 8)).toEqual(['--bg', '--rc', 'NW 뉴웹', '-n', 'NW 뉴웹', '--permission-mode', 'auto']);
      const mcpFile = call.args[call.args.indexOf('--mcp-config') + 1];
      expect(JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers.hub.headers['X-Hub-Token']).toBe(TOKEN);
      expect(statSync(mcpFile).mode & 0o777).toBe(0o600);
      const tools = call.args[call.args.indexOf('--allowedTools') + 1].split(',');
      expect(tools).toEqual(expect.arrayContaining(['Bash(git push -u origin hub/*)', 'Bash(gh pr create *)', 'mcp__hub__update_task_status']));
      expect(tools).not.toContain('Bash(git push *)');

      const first = await http.get('/api/tasks/NW-1').set(auth).expect(200);
      expect(first.body.status).toBe('doing');
      expect(first.body.metadata.notes[0].note).toContain('Remote Control 세션 "NW 뉴웹"');
    });

    it('다시 돌리면 끝난 단계는 건너뛰고 세션만 다시 띄운다 (설정한 권한 모드로)', async () => {
      await http.patch('/api/settings/ideation').set(auth).send({ sessionPermissionMode: 'acceptEdits' }).expect(200);
      const apps = await http.get('/api/apps').set(auth).expect(200);
      const nw = apps.body.find((a: { code: string }) => a.code === 'NW');
      const { body: run } = await http.post(`/api/apps/${nw.id}/bootstrap`).set(auth).expect(201);
      const done = await waitRun(run.id);
      expect(done.status).toBe('done');
      expect(git(join(projects, 'new-web'), 'rev-list', '--count', 'HEAD')).toBe('1');
      const bg = claudeCalls().filter((c) => c.args.includes('--bg'));
      expect(bg).toHaveLength(2);
      expect(bg[1].args[bg[1].args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
      await http.patch('/api/settings/ideation').set(auth).send({ sessionPermissionMode: 'auto' }).expect(200);
    });

    it('세션을 못 띄우면 runner로 첫 task를 시작해 PR까지 간다', async () => {
      const id = await generate('code:FB folder:fallback-app BG_FAIL');
      const res = await http.post(`/api/ideas/${id}/approve`).set(auth).send({}).expect(201);
      const done = await waitRun(res.body.run.id);
      expect(done.status).toBe('done');
      expect(done.result.bootstrap.fallbackReason).toContain('Workspace not trusted');
      const fallback = await waitRun(done.result.bootstrap.fallbackRunId);
      expect(fallback).toMatchObject({ kind: 'implement', taskId: 'FB-1', status: 'done' });
      const task = await http.get('/api/tasks/FB-1').set(auth).expect(200);
      expect(task.body.status).toBe('review');
      expect(git(join(remotes, 'fallback-app.git'), 'branch', '--list')).toContain('hub/FB-1-');
    });

    it('폴더와 GitHub 저장소가 이미 있으면 그 저장소로 시작한다(Hub 첫 커밋은 버리고 파일은 남긴다)', async () => {
      const seed = join(root, 'taken-seed');
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(remotes, 'taken.git')]);
      execFileSync('git', ['init', '-q', '-b', 'main', seed]);
      writeFileSync(join(seed, 'app.txt'), '원래 코드\n');
      git(seed, 'add', '.');
      git(seed, 'commit', '-qm', '원래 커밋');
      git(seed, 'push', '-q', join(remotes, 'taken.git'), 'main');
      mkdirSync(join(projects, 'taken'), { recursive: true });

      const id = await generate('code:TK folder:taken');
      const res = await http.post(`/api/ideas/${id}/approve`).set(auth).send({}).expect(201);
      const done = await waitRun(res.body.run.id);
      expect(done.status).toBe('done');
      const dir = join(projects, 'taken');
      expect(git(dir, 'log', '--format=%s')).toBe('원래 커밋');
      expect(git(dir, 'remote', 'get-url', 'origin')).toBe(join(remotes, 'taken.git'));
      expect(existsSync(join(dir, 'README.md'))).toBe(true);
      expect(git(dir, 'status', '--porcelain')).toContain('README.md');
    });

    it('다른 앱이 쓰는 폴더면 승인을 막는다', async () => {
      const id = await generate('code:DU folder:taken');
      const res = await http.post(`/api/ideas/${id}/approve`).set(auth).send({}).expect(409);
      expect(res.body.error.message).toContain('이 쓰는 폴더다');
    });
  });
});
