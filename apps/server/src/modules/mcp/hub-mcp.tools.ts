import { BadRequestException, HttpException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BUG_SEVERITIES, DEPLOY_ENVS, DEPLOY_STATUSES, SPEC_KINDS, TASK_ASSIGNEES, TASK_SIZES, TASK_STATUSES, TASK_TYPES } from '@hub/shared';
import { AppsService } from '../apps/apps.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { ReposService } from '../repos/repos.service';
import { IdeasService } from '../ideas/ideas.service';
import { KnowledgeService, toSpecDto } from '../knowledge/knowledge.service';
import { changedFields, TasksService, toTaskDto } from '../tasks/tasks.service';

export interface HubMcpDeps {
  tasks: TasksService;
  knowledge: KnowledgeService;
  ideas: IdeasService;
  apps: AppsService;
  deployments: DeploymentsService;
  repos: ReposService;
}

/** 저장소 이름(backend 등)을 ID로 바꾼다. 없으면 오류 */
async function repoIdOf(deps: HubMcpDeps, appCode: string, name: string | undefined): Promise<number | undefined> {
  if (!name) return undefined;
  const app = await deps.apps.getByCode(appCode);
  const found = (await deps.repos.list(app.id)).find((r) => r.name === name);
  if (!found) throw new BadRequestException(`앱 ${app.code}에 저장소 ${name}가 없다`);
  return found.id;
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** 서비스 오류(없는 task, 허용되지 않는 전이 등)는 도구 오류로 돌려 Claude가 읽고 고칠 수 있게 한다. */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    const body = e.getResponse();
    const message = typeof body === 'string' ? body : JSON.stringify((body as { message?: unknown }).message ?? body);
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

/** 도구 이름과 입력은 ~/.claude/rules/hub.md에 적힌 것과 같게 둔다. */
export function createHubMcpServer(deps: HubMcpDeps): McpServer {
  const { tasks, knowledge, ideas, apps, deployments } = deps;
  const server = new McpServer({ name: 'hub', version: '0.1.0' });

  server.registerTool(
    'list_tasks',
    {
      description: 'Hub의 task 목록을 본다. app(LK, HR, CM, OA)과 status로 거른다. done·cancelled는 status로 직접 고를 때만 나온다.',
      inputSchema: {
        app: z.string().optional().describe('앱 코드. 예: LK'),
        status: z.array(z.enum(TASK_STATUSES)).optional().describe('상태 목록. 생략하면 열린 task(todo, doing, input, review)'),
        type: z.enum(TASK_TYPES).optional().describe('feature, bug, chore'),
        assignee: z.enum(TASK_ASSIGNEES).optional().describe('claude(실행할 일), me(사용자가 직접 할 일)'),
        limit: z.number().int().min(1).max(200).optional().describe('기본 50'),
      },
    },
    ({ app, status, type, assignee, limit }) =>
      run(async () => {
        const rows = await tasks.list({ app, status: status ?? ['todo', 'doing', 'input', 'review'], type, assignee }, limit ?? 50);
        return rows.map((t) => ({
          id: t.id, title: t.title, status: t.status, type: t.type, assignee: t.assignee, size: t.size, stage: t.stage, tag: t.tag, dependsOn: t.dependsOn,
        }));
      }),
  );

  server.registerTool(
    'get_task',
    {
      description: 'task 상세(설명, 진행 메모, 의존 관계)와 연결된 명세·인수인계 문서 목록을 본다.',
      inputSchema: { id: z.string().describe('task ID. 예: LK-57') },
    },
    ({ id }) =>
      run(async () => {
        const t = await tasks.get(id);
        const specs = await knowledge.specsForTask(t.id, t.ideaId);
        return { ...toTaskDto(t, t.app.code), specs: specs.map((s) => ({ id: s.id, kind: s.kind, title: s.title })) };
      }),
  );

  server.registerTool(
    'create_tasks',
    {
      description: '한 앱에 task 여러 개를 만든다. 기획을 쪼갤 때도 쓴다. 새 task는 todo 상태로 생긴다.',
      inputSchema: {
        app: z.string().describe('앱 코드. 예: LK'),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1),
              description: z.string().optional(),
              size: z.enum(TASK_SIZES).optional().describe('S: 반나절, M: 하루, L: 며칠'),
              tag: z.string().optional(),
              idea_id: z.number().int().optional(),
              depends_on: z.array(z.string()).optional().describe('이미 있는 task ID'),
              depends_on_index: z.array(z.number().int().min(0)).optional().describe('이 목록 안에서 앞에 있는 task의 0부터 시작하는 순번'),
              type: z.enum(TASK_TYPES).optional().describe('기본 feature'),
              assignee: z.enum(TASK_ASSIGNEES).optional().describe('기본 claude. 사용자가 직접 해야 할 일이면 me'),
              stage: z.string().optional().describe('앱 단계 key (plan, design, develop, test, deploy, operate 또는 앱이 정한 것)'),
              repo: z.string().optional().describe('저장소가 여러 개인 앱에서 저장소 이름 (예: backend)'),
            }),
          )
          .min(1),
      },
    },
    ({ app, tasks: items }) =>
      run(async () => {
        const repoIds = await Promise.all(items.map((i) => repoIdOf(deps, app, i.repo)));
        const created = await tasks.createMany(
          app,
          items.map((i, k) => ({
            type: i.type,
            assignee: i.assignee,
            stage: i.stage,
            repoId: repoIds[k],
            title: i.title,
            description: i.description,
            size: i.size,
            tag: i.tag,
            ideaId: i.idea_id,
            dependsOn: i.depends_on,
            dependsOnIndex: i.depends_on_index,
          })),
          'claude',
        );
        return created.map((t) => ({ id: t.id, title: t.title, status: t.status, dependsOn: t.dependsOn }));
      }),
  );

  server.registerTool(
    'update_task_status',
    {
      description:
        'task 상태를 바꾸고 진행 메모를 남긴다. 흐름: todo → doing ⇄ input → review → done, cancelled는 언제나. 같은 상태로 보내면 메모만 남는다.',
      inputSchema: {
        id: z.string(),
        status: z.enum(TASK_STATUSES),
        note: z.string().optional().describe('진행 메모. 테스트 결과, 막힌 이유 등'),
        pr_url: z.string().url().optional().describe('세션에서 직접 만든 PR 주소. 남겨 두면 머지될 때 Hub가 task를 완료로 바꾼다'),
        branch: z.string().optional().describe('작업한 브랜치'),
      },
    },
    ({ id, status, note, pr_url, branch }) =>
      run(async () => {
        let t = await tasks.changeStatus(id, status, note, 'claude');
        if (pr_url || branch) t = await tasks.update(t.id, { ...(pr_url ? { prUrl: pr_url } : {}), ...(branch ? { branch } : {}) }, 'claude');
        return pr_url || branch ? { id: t.id, status: t.status, prUrl: t.prUrl, branch: t.branch } : { id: t.id, status: t.status };
      }),
  );

  server.registerTool(
    'update_task',
    {
      description:
        'task 내용을 고친다: 제목, 설명, 종류, 담당, 크기, 우선순위, 기한, 단계, 저장소, 태그, 선행 task. 보낸 항목만 바꾸고 상태는 그대로 둔다(상태는 update_task_status). 끝난 task도 고칠 수 있고, 바뀐 항목은 히스토리에 남는다.',
      inputSchema: {
        id: z.string(),
        title: z.string().trim().min(1).optional(),
        description: z.string().nullable().optional().describe('markdown. null이면 비운다'),
        type: z.enum(TASK_TYPES).optional(),
        assignee: z.enum(TASK_ASSIGNEES).optional().describe('claude 또는 사용자가 직접 할 일이면 me'),
        size: z.enum(TASK_SIZES).nullable().optional().describe('S: 반나절, M: 하루, L: 며칠'),
        priority: z.number().int().min(1).max(3).nullable().optional().describe('1 높음, 2 보통, 3 낮음. null이면 비운다'),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe('YYYY-MM-DD. null이면 비운다'),
        stage: z.string().nullable().optional().describe('앱 단계 key. null이면 단계 없음'),
        repo: z.string().optional().describe('저장소가 여러 개인 앱에서 저장소 이름'),
        tag: z.string().nullable().optional(),
        depends_on: z.array(z.string()).optional().describe('선행 task ID 전체 목록 (기존 목록을 이 목록으로 바꾼다)'),
      },
    },
    ({ id, title, description, type, assignee, size, priority, due_date, stage, repo, tag, depends_on }) =>
      run(async () => {
        const before = await tasks.get(id);
        const input = {
          title, description, type, assignee, size, priority, stage, tag,
          dueDate: due_date,
          dependsOn: depends_on,
          repoId: await repoIdOf(deps, before.app.code, repo),
        };
        const changed = changedFields(before, input);
        if (Object.values(input).every((v) => v === undefined)) throw new BadRequestException('고칠 항목이 없다 (title, description 등을 하나 이상 보낸다)');
        const t = await tasks.update(before.id, input, 'claude');
        const { id: tid, title: tt, status, type: ty, assignee: as, size: sz, priority: pr, dueDate, stage: sg, repoId, tag: tg, dependsOn } = toTaskDto(t, t.app.code);
        return { id: tid, title: tt, status, type: ty, assignee: as, size: sz, priority: pr, dueDate, stage: sg, repoId, tag: tg, dependsOn, changed };
      }),
  );

  server.registerTool(
    'get_spec',
    {
      description: '기획 명세나 인수인계 문서를 읽는다. id는 get_task나 [Hub context]의 spec id다.',
      inputSchema: { id: z.number().int() },
    },
    ({ id }) => run(async () => toSpecDto(await knowledge.getSpec(id))),
  );

  server.registerTool(
    'save_spec',
    {
      description:
        '기획 명세(spec)나 인수인계 문서(handoff)를 저장한다. id를 주면 그 문서를 고친다. 인수인계에는 한 일, 남은 일, 내린 결정과 이유, 다음 세션이 먼저 열어 볼 파일을 적는다.',
      inputSchema: {
        id: z.number().int().optional().describe('고칠 문서 id. 새 문서면 생략'),
        task_id: z.string().optional(),
        idea_id: z.number().int().optional(),
        kind: z.enum(SPEC_KINDS),
        title: z.string().min(1),
        body: z.string().min(1).describe('markdown'),
      },
    },
    ({ id, task_id, idea_id, kind, title, body }) =>
      run(async () => {
        const s = await knowledge.saveSpec({ id, taskId: task_id, ideaId: idea_id, kind, title, body });
        return { id: s.id, kind: s.kind, title: s.title, taskId: s.taskId, ideaId: s.ideaId };
      }),
  );

  server.registerTool(
    'report_bug',
    {
      description: '버그를 등록한다. Claude가 고칠 수 있는 버그 task(type bug)로 생기고, 앱 히스토리에 남는다.',
      inputSchema: {
        app: z.string(),
        title: z.string().min(1),
        severity: z.enum(BUG_SEVERITIES).describe('critical, high, medium, low'),
        steps: z.string().optional().describe('재현 단계'),
        expected: z.string().optional().describe('기대한 결과'),
        actual: z.string().optional().describe('실제 결과'),
        env: z.string().optional().describe('발견한 환경 (운영, 개발, 기기 등)'),
        version: z.string().optional().describe('발견한 버전'),
        repo: z.string().optional().describe('저장소가 여러 개인 앱에서 저장소 이름'),
      },
    },
    ({ app, title, severity, steps, expected, actual, env, version, repo }) =>
      run(async () => {
        const [t] = await tasks.createMany(
          app,
          [{ title, type: 'bug', assignee: 'claude', repoId: await repoIdOf(deps, app, repo), bug: { severity, steps, expected, actual, env, version } }],
          'claude',
        );
        return { id: t.id, title: t.title, type: t.type };
      }),
  );

  server.registerTool(
    'add_todo',
    {
      description: '사용자가 직접 해야 할 일을 남긴다(스토어 심사 제출, 도메인 연결, 결제 계정 만들기 등). Claude가 할 수 없는 일이 생기면 여기에 쌓는다.',
      inputSchema: {
        app: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
        priority: z.number().int().min(1).max(3).optional().describe('1 높음 ~ 3 낮음'),
        stage: z.string().optional(),
      },
    },
    ({ app, title, description, due_date, priority, stage }) =>
      run(async () => {
        const [t] = await tasks.createMany(
          app,
          [{ title, description, type: 'chore', assignee: 'me', dueDate: due_date, priority, stage }],
          'claude',
        );
        return { id: t.id, title: t.title, assignee: t.assignee };
      }),
  );

  server.registerTool(
    'record_deploy',
    {
      description: 'GitHub에 남지 않는 배포를 기록한다(스토어 제출·심사 결과, 수동 배포). GitHub 배포 기록과 Actions 결과는 Hub가 자동으로 가져온다.',
      inputSchema: {
        app: z.string(),
        env: z.enum(DEPLOY_ENVS),
        status: z.enum(DEPLOY_STATUSES),
        version: z.string().optional(),
        url: z.string().url().optional(),
        notes: z.string().optional(),
        repo: z.string().optional(),
      },
    },
    ({ app, env, status, version, url, notes, repo }) =>
      run(async () => {
        const a = await apps.getByCode(app);
        const d = await deployments.record(a, { env, status, version, url, notes, repoId: await repoIdOf(deps, app, repo) }, 'claude');
        return { id: d.id, env: d.env, status: d.status };
      }),
  );

  server.registerTool(
    'set_stage',
    {
      description: '앱의 현재 개발 단계를 바꾼다. 단계 key는 앱마다 다를 수 있다(기본 plan, design, develop, test, deploy, operate).',
      inputSchema: { app: z.string(), stage: z.string() },
    },
    ({ app, stage }) =>
      run(async () => {
        const a = await apps.getByCode(app);
        const saved = await apps.update(a.id, { stage }, 'claude');
        return { app: saved.code, stage: saved.stage, stages: saved.stages.map((s) => s.key) };
      }),
  );

  server.registerTool(
    'record_mistake',
    {
      description: '사용자가 지적한 실수를 기록한다. 같은 앱의 다음 세션 [Hub context]에 들어간다.',
      inputSchema: {
        app: z.string(),
        what: z.string().min(1).describe('무엇을 잘못했는지'),
        correct_way: z.string().min(1).describe('올바른 방법'),
      },
    },
    ({ app, what, correct_way }) =>
      run(async () => {
        const m = await knowledge.recordMistake(app, what, correct_way);
        return { id: m.id };
      }),
  );

  server.registerTool(
    'submit_idea',
    {
      description:
        '아이디어·기획을 제출한다. app을 주면 그 앱의 기능 기획, 빼면 새 앱 기획이다. 대시보드에서 승인하면 task가 생기고, 새 앱 기획은 앱·폴더·GitHub 저장소까지 만든다.',
      inputSchema: {
        app: z.string().optional().describe('앱 코드. 새 앱 기획이면 뺀다'),
        body: z.object({
          title: z.string().min(1),
          problem: z.string().min(1).describe('문제'),
          proposal: z.string().min(1).describe('제안 (새 앱이면 해결 방식)'),
          scenarios: z.array(z.string()).optional().describe('사용 시나리오'),
          spec: z.string().optional().describe('명세 (markdown)'),
          impact: z.string().optional().describe('영향 범위'),
          expected_tasks: z.array(z.object({ title: z.string(), size: z.enum(TASK_SIZES).optional() })).optional(),
          one_liner: z.string().optional().describe('새 앱 기획: 한 문장 소개'),
          app_code: z.string().optional().describe('새 앱 기획: 제안하는 앱 코드 (대문자 2~4자)'),
          folder: z.string().optional().describe('새 앱 기획: 폴더와 GitHub 저장소 이름'),
        }),
      },
    },
    ({ app, body }) =>
      run(async () => {
        const { title, expected_tasks, one_liner, app_code, folder, ...rest } = body;
        const base = { ...rest, expectedTasks: expected_tasks };
        if (app) {
          const idea = await ideas.submit(app, title, base);
          return { id: idea.id, kind: idea.kind, status: idea.status };
        }
        // 직접 연 세션의 브레인스토밍 결과. 조사 항목은 비워 두고, 앱 코드·폴더는 승인할 때 고칠 수 있다.
        const idea = await ideas.submitConcept(title, {
          ...base,
          concept: {
            oneLiner: one_liner ?? rest.proposal.split('\n')[0],
            targetUsers: '',
            mvpFeatures: [],
            competitors: [],
            market: '',
            monetization: '',
            techStack: '',
            risks: [],
            validation: '',
            app: { code: (app_code ?? '').toUpperCase(), name: title, folder: (folder ?? '').toLowerCase() },
            alternatives: [],
            sources: [],
          },
        });
        return { id: idea.id, kind: idea.kind, status: idea.status };
      }),
  );

  return server;
}
