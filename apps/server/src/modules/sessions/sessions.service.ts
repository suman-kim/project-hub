import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RunKind, RunStatus, SessionOrigin, SessionState, SessionViewDto, TaskStatus } from '@hub/shared';
import { redactDeep } from '../../common/redact';
import { App } from '../apps/app.entity';
import { HubEventsService } from '../realtime/hub-events.service';
import { Task } from '../tasks/task.entity';
import { SessionEvent } from './session-event.entity';
import { SessionMessage } from './session-message.entity';
import { Session } from './session.entity';
import { Delivery, deliveryOf } from './hub-message';

/** Claude Code hook 입력 중 Hub가 보는 필드 */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  source?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  reason?: string;
  [key: string]: unknown;
}

const SUMMARY_MAX = 300;

/** Claude에게 넣는 Hub 메시지 머리. 대화 기록에도 이 글이 남으므로 대화 화면은 이 표시로 걸러 내고 DB의 메시지를 보여 준다 */
export { hubMessageTag } from './hub-message';

/** 끝남 기록이 없어도 이 기간 동안 활동이 없으면 열린 세션으로 보지 않는다(task 패널의 열린 세션과 같은 기준) */
const OPEN_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

interface SessionViewRow {
  id: number;
  claude_session_id: string;
  app_code: string | null;
  cwd: string;
  origin: SessionOrigin;
  started_at: Date;
  ended_at: Date | null;
  run_id: number | null;
  run_kind: RunKind | null;
  run_status: RunStatus | null;
  task_id: string | null;
  task_title: string | null;
  task_status: TaskStatus | null;
  last_event: string | null;
  last_summary: string | null;
  last_at: Date | null;
  last_prompt: string | null;
}

/** 일하던 세션이 이만큼 조용하면 quiet(터미널을 닫았을 수 있음)로 본다 */
export const QUIET_MS = 30 * 60 * 1000;

/**
 * hook 기록으로 세션 상태를 짐작한다. 마지막 기록이 Stop(턴 끝)이나 SessionStart면 입력 대기,
 * 그 밖의 기록(메시지, 도구 사용)이면 일하는 중이고, 그 뒤로 오래 소식이 없으면 quiet.
 */
export function sessionState(s: { endedAt: Date | null; lastEvent: string | null; lastAt: Date | null; startedAt: Date }, now = Date.now()): SessionState {
  if (s.endedAt) return 'ended';
  if (!s.lastEvent || s.lastEvent === 'Stop' || s.lastEvent === 'SessionStart') return 'idle';
  return now - (s.lastAt ?? s.startedAt).getTime() > QUIET_MS ? 'quiet' : 'working';
}

/** 대시보드 목록에 한 줄로 보일 요약 */
export function summarizeHookInput(input: HookInput): string {
  const ti = input.tool_input ?? {};
  const pick = (...keys: string[]) => keys.map((k) => ti[k]).find((v) => typeof v === 'string') as string | undefined;
  let text: string;
  switch (input.hook_event_name) {
    case 'UserPromptSubmit':
      text = input.prompt ?? '';
      break;
    case 'PreToolUse':
    case 'PostToolUse':
      text = [input.tool_name, pick('command', 'file_path', 'notebook_path', 'pattern', 'url', 'description', 'prompt')]
        .filter(Boolean)
        .join(' ');
      break;
    case 'SessionStart':
      text = `source=${input.source ?? 'startup'} cwd=${input.cwd ?? ''}`;
      break;
    case 'SessionEnd':
      text = `reason=${input.reason ?? ''}`;
      break;
    default:
      text = input.hook_event_name ?? 'unknown';
  }
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > SUMMARY_MAX ? `${oneLine.slice(0, SUMMARY_MAX)}…` : oneLine;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(SessionEvent) private readonly events: Repository<SessionEvent>,
    @InjectRepository(SessionMessage) private readonly messages: Repository<SessionMessage>,
    private readonly hubEvents: HubEventsService,
  ) {}

  /** 대시보드에서 보낸 메시지를 쌓아 둔다. 세션의 다음 hook 응답에 실려 전달된다 */
  async addMessage(session: Session, text: string, appCode: string | null): Promise<SessionMessage> {
    const m = await this.messages.save(this.messages.create({ sessionId: session.id, text }));
    this.hubEvents.emit('session.event', { sessionId: session.claudeSessionId, appCode, event: 'HubMessage', toolName: null, summary: '대시보드에서 메시지를 보냈다' });
    return m;
  }

  /** 아직 전달되지 않은 메시지를 지운다. 이미 전달됐으면 false */
  async cancelMessage(sessionId: number, messageId: number): Promise<boolean> {
    const r = await this.messages.delete({ id: messageId, sessionId, deliveredAt: IsNull() });
    return !!r.affected;
  }

  messagesOf(sessionId: number): Promise<SessionMessage[]> {
    return this.messages.find({ where: { sessionId }, order: { id: 'ASC' } });
  }

  /**
   * 전달 대기 메시지를 꺼내 전달한 것으로 표시하고 Claude에게 넣을 글과 CLI에 보여 줄 알림을 만든다. 없으면 null.
   * hook이 겹쳐 와도 한 번만 전달되도록 UPDATE … RETURNING 한 번으로 꺼낸다.
   */
  async takePending(session: Session, via: string): Promise<Delivery | null> {
    const [rows]: [Array<{ id: number; text: string }>, number] = await this.messages.query(
      `UPDATE session_messages SET delivered_at = now(), delivered_via = $2 WHERE session_id = $1 AND delivered_at IS NULL RETURNING id, text`,
      [session.id, via],
    );
    if (!rows?.length) return null;
    this.hubEvents.emit('session.event', { sessionId: session.claudeSessionId, appCode: null, event: 'HubMessage', toolName: null, summary: `메시지 ${rows.length}개를 전달했다` });
    return deliveryOf(rows);
  }

  /** 대시보드에서 세션을 끝난 것으로 표시한다(프로세스는 건드리지 않는다). 깨우기 대기도 끝나도록 기록을 남긴다 */
  async markEnded(session: Session): Promise<void> {
    if (!session.endedAt) await this.sessions.update(session.id, { endedAt: new Date() });
    await this.recordEvent(session, { hook_event_name: 'SessionEnd', reason: 'hub' });
  }

  findById(id: number): Promise<Session | null> {
    return this.sessions.findOneBy({ id });
  }

  findByClaudeId(claudeSessionId: string): Promise<Session | null> {
    return this.sessions.findOneBy({ claudeSessionId });
  }

  /**
   * SessionStart마다 부른다. startup이면 새로 만들고, resume/clear/compact이면 기존 기록을 이어 쓴다.
   * task는 이번에 넘어온 값이 있으면 그것을, 없으면 기존 연결을 유지한다.
   */
  async upsertOnStart(claudeSessionId: string, app: App | null, task: Task | null, cwd: string, runId: number | null = null): Promise<Session> {
    const prev = await this.findByClaudeId(claudeSessionId);
    // HUB_RUN_ID가 넘어온 새 세션은 Hub가 띄웠다(claude -p run, 새 앱 세션 claude --bg). run은 DB에 있을 때만 잇는다.
    // 이미 있던 세션을 Hub가 이어 받은 경우(세션 이어서 하기)는 시작한 쪽을 바꾸지 않고 run만 잇는다.
    const runExists = runId ? (await this.sessions.query('SELECT 1 FROM runs WHERE id = $1', [runId])).length > 0 : false;
    if (prev) {
      prev.appId = app?.id ?? prev.appId;
      prev.taskId = task?.id ?? prev.taskId;
      prev.cwd = cwd || prev.cwd;
      prev.endedAt = null;
      if (runExists) prev.runId = runId;
      return this.sessions.save(prev);
    }
    const hub = runId ? { origin: 'hub' as const, ...(runExists ? { runId } : {}) } : {};
    return this.sessions.save(
      this.sessions.create({ claudeSessionId, appId: app?.id ?? null, taskId: task?.id ?? null, cwd, origin: 'local', ...hub }),
    );
  }

  /** SessionStart 없이 이벤트가 먼저 온 세션(Hub가 늦게 켜진 경우)은 여기서 만든다. */
  async ensure(claudeSessionId: string, app: App | null, cwd: string): Promise<Session> {
    const prev = await this.findByClaudeId(claudeSessionId);
    // 앱을 등록하기 전에 시작한 세션은 앱 없이 기록됐다. 등록된 뒤 처음 오는 기록에서 앱을 채운다.
    if (prev && !prev.appId && app) {
      await this.sessions.update(prev.id, { appId: app.id });
      prev.appId = app.id;
    }
    if (prev) return prev;
    await this.sessions
      .createQueryBuilder()
      .insert()
      .values({ claudeSessionId, appId: app?.id ?? null, cwd, origin: 'local' })
      .orIgnore()
      .execute();
    return (await this.findByClaudeId(claudeSessionId))!;
  }

  async recordEvent(session: Session, input: HookInput, appCode: string | null = null): Promise<SessionEvent> {
    const event = await this.events.save(
      this.events.create({
        sessionId: session.id,
        event: input.hook_event_name ?? 'unknown',
        toolName: input.tool_name ?? null,
        summary: redactDeep(summarizeHookInput(input)),
        payload: redactDeep(input),
      }),
    );
    if (input.hook_event_name === 'SessionEnd') {
      await this.sessions.update(session.id, { endedAt: new Date() });
    }
    this.hubEvents.emit('session.event', {
      sessionId: session.claudeSessionId,
      appCode,
      event: event.event,
      toolName: event.toolName,
      summary: event.summary,
    });
    return event;
  }

  /** 직접 연 세션을 task에 묶거나(null이면) 푼다. */
  async linkTask(sessionId: number, taskId: string | null): Promise<void> {
    await this.sessions.update(sessionId, { taskId });
  }

  /** runner가 띄운 세션을 run에 묶는다. SessionStart hook이 먼저 왔든 아니든 같은 결과가 된다. */
  async linkRun(claudeSessionId: string, runId: number, appId: number | null, taskId: string | null, cwd: string, keepOrigin = false): Promise<void> {
    await this.sessions
      .createQueryBuilder()
      .insert()
      .values({ claudeSessionId, appId, taskId, runId, origin: 'hub', cwd })
      // 세션 이어서 하기는 내가 연 세션을 Hub가 이어 받은 것이라 시작한 쪽은 그대로 둔다.
      .orUpdate(keepOrigin ? ['run_id', 'task_id', 'app_id'] : ['run_id', 'origin', 'task_id', 'app_id'], ['claude_session_id'])
      .execute();
  }

  /**
   * 세션 탭·세션 메뉴·대화 보기 머리: 세션마다 앱, 진행 중인 task, 시작한 쪽, 상태(hook 기록으로 짐작), 마지막 메시지·기록.
   * sessionId가 없으면 7일 안에 활동한 세션을 최근 것부터 준다.
   */
  async views(f: { appId?: number; sessionId?: number; limit?: number } = {}): Promise<SessionViewDto[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.sessionId) where.push(`s.id = $${params.push(f.sessionId)}`);
    else where.push(`COALESCE(last.created_at, s.started_at) > now() - interval '7 days'`);
    if (f.appId) where.push(`s.app_id = $${params.push(f.appId)}`);
    const rows: SessionViewRow[] = await this.sessions.query(
      `SELECT s.id, s.claude_session_id, a.code AS app_code, s.cwd, s.origin, s.started_at, s.ended_at,
              r.id AS run_id, r.kind AS run_kind, r.status AS run_status,
              t.id AS task_id, t.title AS task_title, t.status AS task_status,
              last.event AS last_event, last.summary AS last_summary, last.created_at AS last_at,
              prompt.summary AS last_prompt
       FROM sessions s
       LEFT JOIN apps a ON a.id = s.app_id
       LEFT JOIN runs r ON r.id = s.run_id
       LEFT JOIN tasks t ON t.id = COALESCE(s.task_id, r.task_id)
       LEFT JOIN LATERAL (SELECT e.event, e.summary, e.created_at FROM session_events e WHERE e.session_id = s.id ORDER BY e.id DESC LIMIT 1) last ON true
       LEFT JOIN LATERAL (SELECT e.summary FROM session_events e WHERE e.session_id = s.id AND e.event = 'UserPromptSubmit'
                            AND e.summary NOT LIKE '<task-notification>%' ORDER BY e.id DESC LIMIT 1) prompt ON true
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(last.created_at, s.started_at) DESC
       LIMIT $${params.push(f.limit ?? 200)}`,
      params,
    );
    const now = Date.now();
    return rows.map((r) => {
      // claude -p run은 run이 끝나면 세션도 끝난 것이다. 새 앱 세션(bootstrap)은 run이 끝난 뒤에도 계속 돈다.
      const runEnded = !!r.run_kind && r.run_kind !== 'bootstrap' && ['done', 'failed', 'stopped'].includes(r.run_status ?? '');
      const state = runEnded ? 'ended' : sessionState({ endedAt: r.ended_at, lastEvent: r.last_event, lastAt: r.last_at, startedAt: r.started_at }, now);
      const lastAt = r.last_at ?? r.started_at;
      return {
        id: r.id,
        claudeSessionId: r.claude_session_id,
        appCode: r.app_code,
        cwd: r.cwd,
        origin: r.origin,
        run: r.run_id ? { id: r.run_id, kind: r.run_kind!, status: r.run_status! } : null,
        task: r.task_id ? { id: r.task_id, title: r.task_title!, status: r.task_status! } : null,
        state,
        open: state !== 'ended' && now - lastAt.getTime() < OPEN_WITHIN_MS,
        startedAt: r.started_at.toISOString(),
        endedAt: r.ended_at?.toISOString() ?? null,
        lastAt: r.last_at?.toISOString() ?? null,
        lastPrompt: r.last_prompt,
        lastEvent: r.last_event ? { event: r.last_event, summary: r.last_summary ?? '' } : null,
      };
    });
  }

  listEvents(sessionId: number, limit = 100): Promise<SessionEvent[]> {
    return this.events.find({ where: { sessionId }, order: { id: 'DESC' }, take: limit });
  }
}
