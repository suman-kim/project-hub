import { Body, Controller, Get, Header, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { isAbsolute, relative, sep } from 'node:path';
import type { TaskStatus } from '@hub/shared';
import { AppsService } from '../apps/apps.service';
import { ContextService } from '../context/context.service';
import { Session } from '../sessions/session.entity';
import { SessionsService, HookInput } from '../sessions/sessions.service';
import { SettingsService } from '../settings/settings.service';
import { TasksService } from '../tasks/tasks.service';

const DENY_NO_TASK =
  '이 세션에 진행 중인 Hub task가 연결되어 있지 않아서 파일 수정과 Bash를 막았다. 읽기 도구(Read, Grep, Glob)와 Hub 도구는 쓸 수 있다. ' +
  '맞는 task를 update_task_status로 doing으로 바꾸면(없으면 create_tasks로 먼저 만든다) 이 세션에 연결되어 풀린다. 사용자에게 /hub-task <ID>로 시작하자고 해도 된다.';

const denyUnregistered = (folder: string) =>
  `이 폴더(${folder})는 Hub에 등록된 앱이 아니라서 파일 수정과 Bash를 막았다. ` +
  '사용자에게 Hub 대시보드 사이드바의 "앱" 옆 + 버튼으로 이 프로젝트를 먼저 등록하자고 안내한다. Hub 밖에서 작업해야 하면 HUB_GUARD=off로 세션을 다시 연다.';

/** task 없이는 막는 도구. 읽기 도구와 MCP 도구는 막지 않는다. */
const GUARDED_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** 이 상태의 task가 연결되어 있어야 수정할 수 있다. 리뷰·완료·취소로 넘기면 연결이 풀린다. */
const WORKING: readonly TaskStatus[] = ['doing', 'input'];

/** 깨우기 대기 요청 하나의 최대 길이와 확인 간격 */
const WAIT_MS = 240_000;
const WAIT_TICK_MS = 2_000;

/** 대시보드 메시지를 실어 보낼 수 있는 hook */
const DELIVER_ON = ['PostToolUse', 'Stop', 'UserPromptSubmit'];

const isStatusTool = (name: string | undefined) => !!name && name.startsWith('mcp__') && name.endsWith('__update_task_status');

/** 클라이언트 hub-hook.sh가 부르는 입구. 계약(경로, 쿼리, 응답 형식)을 바꾸지 않는다. */
@Controller('api/hooks')
export class HooksController {
  /** 세션마다 가장 최근 깨우기 대기의 번호. 새 대기가 오면 이전 대기는 410으로 끝난다 */
  private readonly waiters = new Map<string, number>();

  constructor(
    private readonly apps: AppsService,
    private readonly tasks: TasksService,
    private readonly sessions: SessionsService,
    private readonly context: ContextService,
    private readonly settings: SettingsService,
  ) {}

  @Post('session-start')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async sessionStart(@Body() input: HookInput, @Query('task') taskQuery?: string, @Query('run') runQuery?: string): Promise<string> {
    const cwd = input.cwd ?? '';
    const app = await this.apps.findByCwd(cwd);
    const prev = input.session_id ? await this.sessions.findByClaudeId(input.session_id) : null;

    const requested = taskQuery?.trim() || null;
    let task = requested ? await this.tasks.find(requested) : null;
    if (!task && !requested && prev?.taskId) task = await this.tasks.find(prev.taskId);

    const runId = Number(runQuery) || null;
    if (input.session_id) {
      const session = await this.sessions.upsertOnStart(input.session_id, app, task, cwd, runId);
      await this.sessions.recordEvent(session, { ...input, hook_event_name: input.hook_event_name ?? 'SessionStart' }, app?.code ?? null);
    }

    // Hub가 띄운 세션은 막지 않으니 안내도 하지 않는다.
    const fromHub = !!requested || !!runQuery?.trim() || !!prev?.runId;
    let guard: 'task' | 'register' | null = null;
    if (!fromHub && app?.guardEnabled && !(task && WORKING.includes(task.status))) guard = 'task';
    if (!fromHub && !app && (await this.unregisteredFolder(cwd))) guard = 'register';

    return this.context.forSession({
      cwd,
      source: input.source ?? 'startup',
      app,
      task,
      unknownTaskId: requested && !task ? requested : null,
      guard,
    });
  }

  /**
   * 파일 수정 도구와 Bash를 부르기 전에 묻는다.
   * - Hub가 띄운 세션(task·run 쿼리, run에 묶인 세션)은 통과
   * - 가드가 켜진 앱: 이 세션에 doing·input task가 연결되어 있어야 통과
   * - 앱이 없는 폴더: 프로젝트 폴더 위치(설정의 projectRoot) 안이면 막고, 밖이면 통과
   */
  @Post('pre-tool-use')
  async preToolUse(
    @Body() input: HookInput,
    @Query('task') taskQuery: string | undefined,
    @Query('run') runQuery: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cwd = input.cwd ?? '';
    const session = input.session_id ? await this.sessions.findByClaudeId(input.session_id) : null;
    const pass = (input.tool_name && !GUARDED_TOOLS.has(input.tool_name)) || taskQuery?.trim() || runQuery?.trim() || session?.runId;
    const app = session?.appId ? await this.apps.get(session.appId) : await this.apps.findByCwd(cwd);

    let reason: string | null = null;
    if (!pass && app) {
      if (app.guardEnabled && !(await this.hasWorkingTask(session))) reason = DENY_NO_TASK;
    } else if (!pass) {
      const folder = await this.unregisteredFolder(cwd);
      if (folder) reason = denyUnregistered(folder);
    }

    if (!reason) {
      res.status(204);
      return;
    }

    if (input.session_id) {
      const s = session ?? (await this.sessions.ensure(input.session_id, app, cwd));
      await this.sessions.recordEvent(s, { ...input, hook_event_name: 'PreToolUse', decision: 'deny' }, app?.code ?? null);
    }
    res.status(200);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  }

  /**
   * 턴이 끝날 때 asyncRewake hook(hub-hook.sh wait)이 부르는 롱폴링. 입력 대기 중인 세션은 hook이 오지 않으므로
   * 이 요청이 대시보드 메시지를 기다렸다가 돌려주고, hook이 코드 2로 끝나며 세션을 깨운다.
   * 200: 메시지(본문), 204: 아직 없음(다시 기다린다), 410: 새 대기가 생겼거나 세션이 다시 움직였다(그만 기다린다).
   * Node 기본 요청 시간 제한(300초)보다 짧게 끊고, 스크립트가 다시 부른다.
   */
  @Get('wait')
  async wait(@Query('session') sid: string | undefined, @Query('ms') ms: string | undefined, @Res() res: Response) {
    const session = sid ? await this.sessions.findByClaudeId(sid) : null;
    if (!session) return void res.status(410).end();
    const gen = (this.waiters.get(session.claudeSessionId) ?? 0) + 1;
    this.waiters.set(session.claudeSessionId, gen);
    let closed = false;
    res.on('close', () => (closed = true));
    const until = Date.now() + Math.min(Number(ms) || WAIT_MS, WAIT_MS);
    while (!closed && Date.now() < until) {
      if (this.waiters.get(session.claudeSessionId) !== gen) return void res.status(410).end();
      const got = await this.sessions.takePending(session, 'Wake');
      if (got) {
        this.waiters.delete(session.claudeSessionId);
        return void res.status(200).type('text/plain').send(got.context);
      }
      await new Promise((r) => setTimeout(r, WAIT_TICK_MS));
    }
    if (!closed) res.status(204).end();
  }

  /**
   * 세션 기록. 대시보드에서 보낸 메시지가 쌓여 있으면 응답에 실어 Claude에게 전달한다.
   * 도구 사용 뒤·다음 입력은 additionalContext로, 턴 끝(Stop)은 block으로 이어서 일하게 한다.
   * 하위 에이전트(agent_id)의 hook에는 싣지 않는다(본 대화가 아니라 하위 에이전트에게 간다).
   */
  @Post('event')
  async event(@Body() input: HookInput, @Res({ passthrough: true }) res: Response) {
    res.status(204);
    if (!input.session_id) return;
    const app = await this.apps.findByCwd(input.cwd ?? '');
    const session = await this.sessions.ensure(input.session_id, app, input.cwd ?? '');
    await this.sessions.recordEvent(session, input, app?.code ?? null);
    if (input.hook_event_name === 'PostToolUse' && isStatusTool(input.tool_name)) await this.followTask(session, input.tool_input?.id);

    const ev = input.hook_event_name ?? '';
    // 세션이 다시 움직이거나 끝나면 깨우기 대기를 끝낸다(움직이는 동안은 아래 hook 응답으로 전달한다).
    if (ev === 'UserPromptSubmit' || ev === 'SessionEnd') this.waiters.delete(session.claudeSessionId);
    if (!DELIVER_ON.includes(ev) || input.agent_id) return;
    const got = await this.sessions.takePending(session, ev);
    if (!got) return;
    res.status(200);
    // systemMessage는 CLI 화면에 보인다. Claude에게 가는 글은 사용자 화면에 보이지 않는다.
    return ev === 'Stop'
      ? { decision: 'block', reason: got.context, systemMessage: got.display }
      : { hookSpecificOutput: { hookEventName: ev, additionalContext: got.context }, systemMessage: got.display };
  }

  /**
   * 세션이 update_task_status를 부른 뒤, 그 task의 지금 상태를 보고 세션에 연결하거나 푼다.
   * 응답 본문 대신 DB 상태를 보므로 전이가 거부된 호출은 연결을 바꾸지 않는다.
   */
  private async followTask(session: Session, id: unknown): Promise<void> {
    if (typeof id !== 'string') return;
    const task = await this.tasks.find(id);
    if (!task) return;
    if (WORKING.includes(task.status)) {
      if (session.taskId !== task.id) await this.sessions.linkTask(session.id, task.id);
    } else if (session.taskId === task.id) {
      await this.sessions.linkTask(session.id, null);
    }
  }

  private async hasWorkingTask(session: Session | null): Promise<boolean> {
    if (!session?.taskId) return false;
    const task = await this.tasks.find(session.taskId);
    return !!task && WORKING.includes(task.status);
  }

  /** 프로젝트 폴더 위치 안이면 그 아래 첫 폴더 이름(바로 그 위치면 위치 자체), 밖이면 null */
  private async unregisteredFolder(cwd: string): Promise<string | null> {
    if (!cwd) return null;
    const { projectRoot } = await this.settings.ideation();
    const rel = relative(projectRoot, cwd);
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    return rel ? rel.split(sep)[0] : projectRoot;
  }
}
