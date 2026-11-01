import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { RunDto, SessionViewDto } from '@hub/shared';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { useApps, useSessionChat, useTasks } from '../api/queries';
import { tone, TASK_ST } from '../lib/labels';
import { ago, stamp } from '../lib/format';
import { clearSessionDraft, peekSessionDraft, useSessionPanel } from '../lib/nav';
import { tildify } from '../lib/paths';
import { readPref, usePrefs, writePref } from '../lib/prefs';
import { AppTag, SESSION_STATE, sessionOrigin, useEndSession } from '../screens/AppSessions';
import { ChatView } from './Chat';
import { IconClose } from './icons';
import { Select } from './Select';
import { ErrorBox, Skeleton, useUi } from './ui';

/** 처음에 읽는 대화 줄 수. "이전 대화 더 보기"를 누를 때마다 늘린다 */
const PAGE = 300;

/** 어느 화면 위에서든 ?session=12로 여는 세션 대화 패널 (task 패널과 같은 자리) */
export function SessionPanelHost() {
  const { sessionId, close } = useSessionPanel();
  useEffect(() => {
    if (!sessionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=alertdialog],[role=dialog]')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!sessionId) return null;
  return <SessionPanel key={sessionId} id={sessionId} onClose={close} />;
}

/** 대화 패널 너비: 보통, 넓게, 전체. 이 브라우저에서 기억한다 */
const SIZES = ['normal', 'wide', 'full'] as const;
type PanelSize = (typeof SIZES)[number];
const WIDTH: Record<PanelSize, string> = { normal: 'min(760px, 64vw)', wide: 'min(1180px, 88vw)', full: 'calc(100vw - 0px)' };
const SIZE_LABEL: Record<PanelSize, string> = { normal: '보통', wide: '넓게', full: '전체' };

function SessionPanel({ id, onClose }: { id: number; onClose(): void }) {
  const { m } = usePrefs();
  const [size, setSizeState] = useState<PanelSize>(() => readPref<PanelSize>('hub.sessionPanelSize', 'normal', SIZES));
  const setSize = (v: PanelSize) => {
    writePref('hub.sessionPanelSize', v);
    setSizeState(v);
  };
  const navigate = useNavigate();
  const panel = useSessionPanel();
  const [limit, setLimit] = useState(PAGE);
  const chat = useSessionChat(id, limit);
  const apps = useApps();
  const end = useEndSession();
  const s = chat.data?.session;
  const st = s ? tone(SESSION_STATE, s.state) : null;
  const ts = s?.task ? tone(TASK_ST, s.task.status) : null;
  const more = chat.data ? chat.data.total - chat.data.items.length : 0;
  const qc = useQueryClient();
  const ui = useUi();
  // 대화 줄 id가 hm<메시지 id>인 것이 대시보드에서 보낸 메시지다.
  const cancel = useAction(async (itemId: string) => {
    await api.del(`/api/sessions/${id}/messages/${itemId.replace(/^hm/, '')}`);
    ui.toast('보내기를 취소했어요');
    void qc.invalidateQueries({ queryKey: ['sessions'] });
  });

  return (
    <>
      {m && <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 34, background: 'var(--scrim)' }} />}
      <aside
        aria-label="세션 대화"
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 35, width: m ? '100vw' : WIDTH[size], maxWidth: '100vw', transition: 'width .15s', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--line)', boxShadow: '-16px 0 40px var(--shadow)' }}
      >
        <div style={{ flex: 'none', borderBottom: '1px solid var(--line-soft)', padding: '14px 20px', paddingTop: 'max(14px, env(safe-area-inset-top))', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {s && <AppTag name={apps.data?.find((a) => a.code === s.appCode)?.name ?? s.appCode} />}
            <span style={{ fontSize: 15, fontWeight: 700 }}>세션 대화</span>
            {st && (
              <span className="pill" style={{ background: st.bg, color: st.fg }}>
                <span className="dot dot-6" style={{ background: st.dot }} />
                {st.label}
              </span>
            )}
            {!m && (
              <div role="group" aria-label="대화 창 크기" style={{ marginLeft: 'auto', display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: 'var(--chip)' }}>
                {SIZES.map((k) => (
                  <button key={k} type="button" aria-pressed={size === k} onClick={() => setSize(k)} style={{ minHeight: 28, padding: '0 10px', borderRadius: 6, border: 0, background: size === k ? 'var(--surface)' : 'transparent', color: size === k ? 'var(--text)' : 'var(--text-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: size === k ? '0 1px 2px var(--shadow)' : 'none' }}>
                    {SIZE_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={onClose} aria-label="닫기 (Esc)" className="icon-btn" style={{ marginLeft: m ? 'auto' : 0 }}>
              <IconClose size={18} />
            </button>
          </div>
          {s && (
            <>
              {s.task ? (
                <button type="button" onClick={() => panel.openTask(s.task!.id)} style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, padding: 0, border: 0, background: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
                  <span className="mono" style={{ flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>
                    #{s.task.id}
                  </span>
                  <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
                    {s.task.title}
                  </span>
                  <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, color: ts!.fg }}>{ts!.label}</span>
                </button>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{s.state === 'ended' ? 'task 없음' : '진행 중인 task 없음'}</span>
              )}
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', fontSize: 12, color: 'var(--text-3)' }}>
                <span style={{ padding: '1px 8px', borderRadius: 999, border: '1px solid var(--line-strong)', color: 'var(--text-2)', fontWeight: 600 }}>{sessionOrigin(s)}</span>
                <span className="mono">{tildify(s.cwd)}</span>
                <span>· 시작 {stamp(s.startedAt)}</span>
                <span>· 마지막 활동 {ago(s.lastAt ?? s.startedAt)}</span>
                {s.run && (
                  <button type="button" className="link" onClick={() => navigate(`/runs/${s.run!.id}`)} style={{ fontSize: 12 }}>
                    run {s.run.id} 보기 →
                  </button>
                )}
                {s.open && (
                  <button type="button" className="link" disabled={end.busy} onClick={() => void end.run(s)} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--risk)' }}>
                    세션 종료
                  </button>
                )}
              </span>
            </>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {chat.isLoading && <Skeleton rows={6} height={44} />}
          {chat.error && <ErrorBox error={chat.error} onRetry={() => void chat.refetch()} />}
          {chat.data && (
            <>
              {more > 0 && (
                <button type="button" onClick={() => setLimit(limit + PAGE)} style={{ flex: 'none', minHeight: 36, border: 0, borderBottom: '1px solid var(--line-soft)', background: 'var(--bg)', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' }}>
                  이전 대화 {Math.min(PAGE, more)}줄 더 보기 · 남은 {more}줄
                </button>
              )}
              <div style={{ flex: 1, minHeight: 0 }}>
                <ChatView items={chat.data.items} working={s?.state === 'working'} empty={chat.data.missing ?? '아직 대화가 없어요'} height="100%" onCancel={(itemId) => void cancel.run(itemId)} />
              </div>
            </>
          )}
        </div>
        {s && <Composer s={s} />}
      </aside>
    </>
  );
}

/**
 * 대화 패널 아래 입력창. 세션 상태에 따라 하는 일이 다르다.
 * - 열린 세션: 메시지를 쌓아 두면 다음 도구 사용·턴 끝·다음 입력 때 hook으로 전달된다(입력 대기 중인 터미널 세션은 다음에 움직일 때)
 * - 끝난 세션(또는 터미널을 닫았다고 확인한 세션): 같은 대화를 claude --resume으로 이어 받는 run을 띄운다
 * - Hub가 띄운 구현·기획 run: run 화면에서 답한다
 */
function Composer({ s }: { s: SessionViewDto }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // task 패널의 "이 세션에서 진행하기"가 채워 둔 task 정보 글
  const [prefilled] = useState(() => !!peekSessionDraft(s.id));
  const [text, setText] = useState(() => peekSessionDraft(s.id) ?? '');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    clearSessionDraft(s.id);
    if (prefilled && input.current) {
      input.current.focus();
      input.current.setSelectionRange(0, 0);
      input.current.scrollTop = 0;
    }
  }, [s.id, prefilled]);
  const [taskId, setTaskId] = useState('');
  const [closed, setClosed] = useState(false);
  const hubRun = s.origin === 'hub' && s.run && s.run.kind !== 'session';
  const resuming = s.run?.kind === 'session' && ['queued', 'running'].includes(s.run.status) && s.state !== 'ended';
  const mode: 'send' | 'resume' = s.open && !closed ? 'send' : 'resume';
  const tasks = useTasks({ app: s.appCode ?? undefined, status: ['todo', 'doing', 'input'], assignee: 'claude' }, mode === 'resume' && !s.task && !!s.appCode);

  const submit = useAction(async () => {
    const message = text.trim();
    if (!message) return;
    if (mode === 'send') {
      await api.post(`/api/sessions/${s.id}/messages`, { text: message });
      ui.toast(s.state === 'working' ? '보냈어요 · 다음 도구 사용이나 턴이 끝날 때 전달돼요' : '보냈어요 · 이 세션이 다음에 움직일 때 전달돼요');
    } else {
      const run = await api.post<RunDto>(`/api/sessions/${s.id}/resume`, { message, taskId: s.task ? undefined : taskId || undefined, force: s.open || undefined });
      ui.toast(`이어서 하기를 시작했어요 · run ${run.id}`);
      void qc.invalidateQueries({ queryKey: ['runs'] });
    }
    setText('');
    void qc.invalidateQueries({ queryKey: ['sessions'] });
  });

  const box = (children: ReactNode) => (
    <div style={{ flex: 'none', borderTop: '1px solid var(--line-soft)', padding: '10px 16px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
      {children}
    </div>
  );

  if (hubRun)
    return box(
      <span>
        Hub가 띄운 {s.run!.kind === 'implement' ? '구현' : '기획'} 세션이에요 · 질문에 답하거나 다시 실행하는 건{' '}
        <button type="button" className="link" onClick={() => navigate(`/runs/${s.run!.id}`)} style={{ fontSize: 12 }}>
          run {s.run!.id} 화면
        </button>
        에서 해요
      </span>,
    );
  if (!s.appCode) return box(<span>Hub에 등록된 앱의 세션만 Hub에서 말을 걸 수 있어요 · 사이드바 "앱" 옆 + 버튼으로 등록해요</span>);

  const needTask = mode === 'resume' && !s.task;
  const hint =
    mode === 'send'
      ? s.state === 'working'
        ? 'Claude가 일하는 중이에요 · 보낸 메시지는 다음 도구 사용이나 턴이 끝날 때 전달돼요'
        : '이 세션은 입력을 기다리는 중이에요 · 보내면 Hub가 세션을 깨워 전달해요(깨우기를 켜기 전부터 멈춰 있던 세션은 다음에 움직일 때 전달돼요)'
      : resuming
        ? `Hub가 이 세션을 이어서 하는 중이에요 · run ${s.run!.id}`
        : `끝난 세션이에요 · 보내면 같은 대화를 이어 받아 이 폴더에서 Hub가 실행해요(허용 도구 안에서만, push·PR은 하지 않아요)${s.task ? ` · task #${s.task.id}` : ''}`;
  return box(
    <>
      <span>{hint}</span>
      {prefilled && text && <span style={{ fontWeight: 600, color: 'var(--prog)' }}>task 정보를 입력창에 채워 뒀어요 · 확인하고 고칠 곳이 있으면 고친 뒤 보내기를 누르세요</span>}
      {needTask && (
        <Select
          label="이어서 할 task"
          size="sm"
          value={taskId}
          onChange={setTaskId}
          placeholder="이어서 할 task 고르기"
          menuWidth={380}
          options={(tasks.data ?? []).map((t) => ({ value: t.id, prefix: `#${t.id}`, label: t.title, badge: { text: TASK_ST[t.status][0], tone: TASK_ST[t.status][1] } }))}
        />
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={input}
          className="input"
          aria-label="세션에 보낼 메시지"
          rows={Math.min(14, Math.max(2, text.split('\n').length))}
          value={text}
          disabled={resuming}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) void submit.run();
          }}
          placeholder={mode === 'send' ? '이 세션에 보낼 메시지 · ⌘Enter로 보내기' : '이어서 할 말 · ⌘Enter로 보내기'}
          style={{ flex: 1, minHeight: 56, resize: 'vertical', fontSize: 14, lineHeight: 1.5 }}
        />
        <button type="button" className="btn btn-primary" disabled={!text.trim() || submit.busy || resuming || (needTask && !taskId)} onClick={() => void submit.run()}>
          {mode === 'send' ? '보내기' : '이어서 하기'}
        </button>
      </div>
      {mode === 'send' && s.state !== 'working' && (
        <button
          type="button"
          className="link"
          style={{ alignSelf: 'flex-start', fontSize: 12 }}
          onClick={async () => {
            const ok = await ui.confirm({ title: '터미널을 닫았나요?', body: '이 세션이 터미널에 아직 열려 있으면, Hub가 이어 받는 순간 대화가 두 갈래로 나뉘어요. 닫았다면 Hub에서 이어서 할 수 있어요.', label: '닫았어요' });
            if (ok) setClosed(true);
          }}
        >
          터미널을 닫았다면 Hub에서 이어서 하기
        </button>
      )}
    </>,
  );
}
