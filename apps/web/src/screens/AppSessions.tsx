import { useState, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppDto, SessionState, SessionViewDto, TaskDto } from '@hub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { useAllSessions, useApps, useAppSessions, useClaudeSessions, type BgSessionView } from '../api/queries';
import { SessionCard } from '../components/blocks';
import { ErrorBox, Skeleton, useUi } from '../components/ui';
import { ago, stamp } from '../lib/format';
import { TASK_ST, tone, type Tone } from '../lib/labels';
import { useSessionPanel } from '../lib/nav';
import { tildify } from '../lib/paths';

// ---- 세션: Claude 세션(내가 연 것, Hub가 띄운 것). 앱 페이지 세션 탭과 세션 메뉴가 같이 쓴다 ----

export const SESSION_STATE: Record<SessionState, [string, Tone]> = {
  working: ['일하는 중', 'prog'],
  idle: ['입력 대기', 'attn'],
  quiet: ['소식 없음', 'muted'],
  ended: ['끝남', 'muted'],
};

const RUN_KIND: Record<string, string> = { implement: '구현', idea_gen: '기획 생성', bootstrap: '새 앱 세션' };

/** 마지막 기록 이름. PreToolUse는 막힌 경우만 기록된다 */
const EVENT: Record<string, string> = { PostToolUse: '도구', UserPromptSubmit: '메시지', PreToolUse: '막힘' };
const QUIET_EVENTS = ['Stop', 'SessionStart', 'SessionEnd'];

/** 시작한 쪽과 방식. 백그라운드(claude --bg) 여부는 claude agents 목록과 맞춰 본다 */
export function sessionOrigin(s: SessionViewDto, bg?: BgSessionView): string {
  if (s.origin === 'hub') return s.run ? `Hub가 시작 · ${RUN_KIND[s.run.kind] ?? s.run.kind} run ${s.run.id}` : 'Hub가 시작';
  if (s.run?.kind === 'session') return `내가 시작 · Hub에서 이어 감 run ${s.run.id}`;
  return `내가 시작 · ${bg ? '백그라운드' : '터미널'}`;
}

/** 세션의 프로젝트 이름. 앱으로 등록되지 않은 폴더면 "앱 없음" */
export function AppTag({ name }: { name: string | null | undefined }) {
  return (
    <span className="ellipsis" style={{ flex: 'none', maxWidth: 200, padding: '1px 8px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: name ? 'var(--text-2)' : 'var(--text-3)' }}>
      {name ?? '앱 없음'}
    </span>
  );
}

/** 가드가 켜진 앱에서 진행 중인 task 없이 연 내 세션은 수정이 막혀 있다 */
const blocked = (s: SessionViewDto, app: AppDto | undefined) => !!app?.guardEnabled && s.origin === 'local' && s.state !== 'ended' && !(s.task && ['doing', 'input'].includes(s.task.status));

/** 앱 페이지 세션 탭 */
export function SessionsTab({ app }: { app: AppDto }) {
  const sessions = useClaudeSessions(app.id);
  const bg = useAppSessions(app.id);
  if (sessions.isLoading) return <Skeleton rows={4} height={64} />;
  if (sessions.error) return <ErrorBox error={sessions.error} onRetry={() => void sessions.refetch()} />;
  const list = sessions.data ?? [];
  const bgList = bg.data ?? [];
  // hook 기록이 없는 백그라운드 세션(Hub가 늦게 켜진 경우 등)은 따로 보여 준다.
  const bgOnly = bgList.filter((b) => !list.some((s) => s.claudeSessionId === b.sessionId));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1080, minWidth: 0 }}>
      <SessionHint />
      <SessionList sessions={list} bgList={bgList} appOf={() => app} />
      {bgOnly.map((b) => (
        <SessionCard key={b.id} s={b} appCode={app.code} />
      ))}
    </div>
  );
}

export function SessionHint() {
  return (
    <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
      내가 연 세션과 Hub가 띄운 세션을 함께 보여 줘요 · 세션을 누르면 대화를 볼 수 있어요 · 상태는 hook 기록으로 짐작해서, 터미널을 그냥 닫으면 "소식 없음"이나 "입력 대기"로 남을 수 있어요
    </span>
  );
}

/** 열린 세션 카드와 접히는 지난 세션 카드 */
export function SessionList({ sessions, bgList = [], appOf, showApp }: { sessions: SessionViewDto[]; bgList?: BgSessionView[]; appOf(code: string | null): AppDto | undefined; showApp?: boolean }) {
  const [showPast, setShowPast] = useState(false);
  const bgOf = (s: SessionViewDto) => bgList.find((b) => b.sessionId === s.claudeSessionId);
  const open = sessions.filter((s) => s.open);
  const past = sessions.filter((s) => !s.open);
  const row = (s: SessionViewDto) => <SessionRow key={s.id} s={s} bg={bgOf(s)} app={appOf(s.appCode)} showApp={showApp} />;
  return (
    <>
      <section className="card">
        <div className="card-head">
          <span aria-hidden="true" className="dot" style={{ background: open.some((s) => s.state === 'working') ? 'var(--prog-dot)' : 'var(--muted-dot)' }} />
          <h2>열린 세션</h2>
          <span className="mono card-sub">{open.length}</span>
        </div>
        {open.map(row)}
        {!open.length && <div className="card-empty">열린 세션이 없어요 · 터미널에서 프로젝트 폴더로 claude를 열면 여기에 보여요</div>}
      </section>
      {past.length > 0 && (
        <section className="card">
          <button type="button" onClick={() => setShowPast(!showPast)} aria-expanded={showPast} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '12px 20px', border: 0, background: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 12, fontSize: 11, color: 'var(--text-3)' }}>{showPast ? '▾' : '▸'}</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>지난 세션</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {past.length}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>최근 7일</span>
          </button>
          {showPast && past.map(row)}
        </section>
      )}
    </>
  );
}

/** 세션 종료: Hub가 돌리는 run이면 중지하고, 터미널 세션은 끝난 것으로 표시만 한다 */
export function useEndSession() {
  const ui = useUi();
  const qc = useQueryClient();
  return useAction(async (s: SessionViewDto) => {
    const hubRun = s.run && ['queued', 'running', 'input'].includes(s.run.status);
    const ok = await ui.confirm({
      title: '이 세션을 끝낼까요?',
      body: hubRun
        ? `Hub가 돌리는 run ${s.run!.id}를 중지해 세션을 끝내요.`
        : '터미널에서 연 세션은 Hub가 프로세스를 끌 수 없어요. 끝난 것으로 표시해 열린 목록에서 내려요. 터미널이 아직 열려 있으면 직접 닫아 주세요.',
      label: hubRun ? '중지' : '끝난 것으로 표시',
    });
    if (!ok) return;
    const r = await api.post<{ stoppedRun: number | null }>(`/api/sessions/${s.id}/end`);
    ui.toast(r.stoppedRun ? `run ${r.stoppedRun}를 중지했어요` : '끝난 것으로 표시했어요');
    void qc.invalidateQueries({ queryKey: ['sessions'] });
  });
}

const DT: CSSProperties = { fontSize: 12, color: 'var(--text-3)', lineHeight: '20px', whiteSpace: 'nowrap' };
const DD: CSSProperties = { margin: 0, minWidth: 0, fontSize: 13, lineHeight: '20px' };

/** 세션 한 줄. 위는 프로젝트·상태·시작한 쪽, 아래는 이름 칸이 고정된 항목 줄(task, 폴더, 시간, 메시지, 기록) */
function SessionRow({ s, bg, app, showApp }: { s: SessionViewDto; bg: BgSessionView | undefined; app: AppDto | undefined; showApp?: boolean }) {
  const navigate = useNavigate();
  const panel = useSessionPanel();
  const end = useEndSession();
  const st = tone(SESSION_STATE, s.state);
  const ts = s.task ? tone(TASK_ST, s.task.status) : null;
  // 턴 끝·시작·끝 기록은 상태 배지로 이미 보이니 줄로는 빼고, 메시지·도구 기록만 보여 준다.
  const last = s.lastEvent && !QUIET_EVENTS.includes(s.lastEvent.event) ? `${EVENT[s.lastEvent.event] ?? s.lastEvent.event} · ${s.lastEvent.summary}` : null;
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => panel.open(s.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && panel.open(s.id)}
      className="row-btn"
      aria-label={`세션 대화 보기 · ${s.task ? `#${s.task.id}` : tildify(s.cwd)}`}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '10px 16px', padding: '16px 20px', borderTop: '1px solid var(--line-soft)', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', minWidth: 0 }}>
        {showApp && <AppTag name={app?.name ?? s.appCode} />}
        <span className="pill" style={{ background: st.bg, color: st.fg }}>
          <span className="dot dot-6" style={{ background: st.dot }} />
          {st.label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{sessionOrigin(s, bg)}</span>
      </div>
      <div className="row-actions" style={{ gridRow: 'span 2', alignSelf: 'start', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm" onClick={stop(() => panel.open(s.id))}>
          대화 보기
        </button>
        {s.run && (
          <button type="button" className="btn btn-sm" onClick={stop(() => navigate(`/runs/${s.run!.id}`))}>
            run {s.run.id}
          </button>
        )}
        {bg?.remoteLink && (
          <a href={bg.remoteLink} target="_blank" rel="noreferrer" className="link" onClick={(e) => e.stopPropagation()} style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>
            원격 조종 ↗
          </a>
        )}
        {bg && app && (
          <button type="button" className="btn btn-sm" onClick={stop(() => navigate(`/sessions/${app.code}/${bg.id}`))}>
            Hub에서 보기
          </button>
        )}
        {s.open && (
          <button type="button" className="btn btn-sm" style={{ color: 'var(--risk)' }} disabled={end.busy} onClick={stop(() => void end.run(s))}>
            세션 종료
          </button>
        )}
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: '2px 12px', minWidth: 0 }}>
        <dt style={DT}>task</dt>
        <dd style={DD}>
          {s.task ? (
            <button type="button" onClick={stop(() => panel.openTask(s.task!.id))} style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, maxWidth: '100%', padding: 0, border: 0, background: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
              <span className="mono" style={{ flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>
                #{s.task.id}
              </span>
              <span className="ellipsis" style={{ fontWeight: 600 }}>
                {s.task.title}
              </span>
              <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, color: ts!.fg }}>{ts!.label}</span>
            </button>
          ) : (
            <span style={{ color: 'var(--text-3)' }}>{s.state === 'ended' ? '없음' : '진행 중인 task 없음'}</span>
          )}
        </dd>
        <dt style={DT}>폴더</dt>
        <dd className="mono ellipsis" style={{ ...DD, fontSize: 12, color: 'var(--text-2)' }}>
          {tildify(s.cwd)}
        </dd>
        <dt style={DT}>시간</dt>
        <dd style={{ ...DD, fontSize: 12, color: 'var(--text-2)' }}>
          시작 {stamp(s.startedAt)} · 마지막 활동 {ago(s.lastAt ?? s.startedAt)}
        </dd>
        {s.lastPrompt && (
          <>
            <dt style={DT}>{s.origin === 'hub' ? 'Hub 지시' : '마지막 메시지'}</dt>
            <dd className="ellipsis" style={{ ...DD, color: 'var(--text-2)' }}>
              “{s.lastPrompt}”
            </dd>
          </>
        )}
        {last && (
          <>
            <dt style={DT}>마지막 기록</dt>
            <dd className="ellipsis mono" style={{ ...DD, fontSize: 12, color: 'var(--text-2)' }}>
              {last}
            </dd>
          </>
        )}
      </dl>
      {(blocked(s, app) || bg?.pending) && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--attn)' }}>
          {blocked(s, app) && <span>진행 중인 task가 없어 이 세션의 파일 수정과 Bash가 막혀 있어요 · task 패널의 "이 세션에서 진행하기"로 task를 맡기세요</span>}
          {bg?.pending && (
            <span className="mono">
              허락 대기 · {bg.pending.tool} {bg.pending.cmd}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** task 패널: 지금 이 task를 진행 중인 세션. 누르면 대화를 연다 */
export function TaskSessions({ task, appId }: { task: TaskDto; appId: number }) {
  const sessions = useClaudeSessions(appId);
  const panel = useSessionPanel();
  const list = (sessions.data ?? []).filter((s) => s.open && s.task?.id === task.id);
  if (!list.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', fontSize: 12 }}>
      <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>이 task를 진행 중인 세션</span>
      {list.map((s) => {
        const st = tone(SESSION_STATE, s.state);
        return (
          <button key={s.id} type="button" onClick={() => panel.open(s.id)} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', padding: 0, border: 0, background: 'none', color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontWeight: 600, color: st.fg }}>{st.label}</span>
            <span>{sessionOrigin(s).replace(' · 터미널', '')}</span>
            <span className="mono">{tildify(s.cwd)}</span>
            <span>· {ago(s.lastAt ?? s.startedAt)}</span>
            <span className="link" style={{ marginLeft: 'auto' }}>
              대화 보기 →
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 태스크 보드 위: 지금 열린 세션. 누르면 대화를 연다 */
export function OpenSessionsStrip({ appCode }: { appCode: string }) {
  const all = useAllSessions();
  const apps = useApps();
  const panel = useSessionPanel();
  const list = (all.data ?? []).filter((s) => s.open && (appCode === 'all' || s.appCode === appCode));
  if (!list.length) return null;
  return (
    <section aria-label="열린 세션" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 8px' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>열린 세션</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {list.length}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>task를 열고 "이 세션에서 진행하기"를 누르면 그 세션이 이어서 해요</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {list.map((s) => {
          const st = tone(SESSION_STATE, s.state);
          return (
            <button key={s.id} type="button" onClick={() => panel.open(s.id)} className="list-item" style={{ flex: 'none', width: 260, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AppTag name={apps.data?.find((a) => a.code === s.appCode)?.name ?? s.appCode} />
                <span className="dot dot-6" style={{ background: st.dot }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: st.fg }}>{st.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{ago(s.lastAt ?? s.startedAt)}</span>
              </span>
              <span className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
                {s.task ? `#${s.task.id} ${s.task.title}` : '진행 중인 task 없음'}
              </span>
              <span className="ellipsis" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {sessionOrigin(s)} · {tildify(s.cwd)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
