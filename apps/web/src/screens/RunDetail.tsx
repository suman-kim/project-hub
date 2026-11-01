import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ChatItem, IdeaDto, RunDto, RunLogDto, TaskDto } from '@hub/shared';
import { api } from '../api/client';
import { useAction, useAnswerRun, useRerun, useStopRun } from '../api/mutations';
import { keys, useApps, useAppSessions } from '../api/queries';
import { ChatView } from '../components/Chat';
import { ErrorBox, Skeleton, useCopy, useUi } from '../components/ui';
import { prNo } from '../components/TaskPanel';
import { clock, dur, hm, money, since, stamp } from '../lib/format';
import { IDEA_ST, RUN_ST, TASK_ST, tone } from '../lib/labels';
import { Markdown } from '../lib/md';
import { useTaskPanel } from '../lib/nav';
import { usePrefs } from '../lib/prefs';
import { tildify } from '../lib/paths';
import { failureLabel, runKindLabel, runStart } from '../lib/runs';
import { useNow } from '../lib/useNow';

const PAGE = 2000;
const LIVE = ['queued', 'running', 'input'];

/** 로그는 2000줄씩 끝까지 읽고, 그 뒤로는 WebSocket run.log가 이어 붙인다 */
async function fetchLogs(id: number): Promise<RunLogDto[]> {
  const out: RunLogDto[] = [];
  for (let after = 0; ; ) {
    const page = await api.get<RunLogDto[]>(`/api/runs/${id}/logs?after=${after}&limit=${PAGE}`);
    out.push(...page);
    if (page.length < PAGE) return out;
    after = page[page.length - 1].seq;
  }
}

/** 새 앱 시작 단계. 실행 로그의 hub 줄로 하나씩 체크한다 */
const BOOT_STEPS: Array<[string, RegExp]> = [
  ['폴더와 첫 커밋', /폴더와 git 저장소|첫 커밋/],
  ['GitHub 저장소', /GitHub/],
  ['작업 공간 신뢰', /작업 공간 신뢰/],
  ['세션 시작', /세션 시작|claude --rc/],
];

export function RunDetail() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { m } = usePrefs();
  const navigate = useNavigate();
  const panel = useTaskPanel();
  const apps = useApps();
  const run = useQuery({ queryKey: keys.run(id), queryFn: () => api.get<RunDto>(`/api/runs/${id}`), enabled: !!id });
  const logs = useQuery({ queryKey: keys.runLogs(id), queryFn: () => fetchLogs(id), enabled: !!id, staleTime: Infinity });
  const r = run.data;
  const task = useQuery({ queryKey: keys.task(r?.taskId ?? ''), queryFn: () => api.get<TaskDto>(`/api/tasks/${r!.taskId}`), enabled: !!r?.taskId });
  const siblings = useQuery({ queryKey: ['taskRuns', r?.taskId], queryFn: () => api.get<RunDto[]>(`/api/tasks/${r!.taskId}/runs`), enabled: !!r?.taskId });
  const ideaId = task.data?.ideaId ?? r?.result.idea?.resultIdeaId ?? null;
  const idea = useQuery({ queryKey: keys.idea(ideaId ?? 0), queryFn: () => api.get<IdeaDto>(`/api/ideas/${ideaId}`), enabled: !!ideaId });
  const stop = useStopRun();
  const stopIt = useAction(() => stop(id));
  const rerun = useRerun();
  const again = useAction(async () => {
    if (!r) return;
    const next = await rerun(r);
    navigate(`/runs/${next.id}`);
  });
  const now = useNow(1000, !!r && LIVE.includes(r.status));

  if (run.isLoading) return <Skeleton rows={6} height={40} />;
  if (run.error || !r) return <ErrorBox error={run.error ?? new Error(`run ${id}가 없어요`)} onRetry={() => void run.refetch()} />;

  const t = task.data;
  const appId = r.result.bootstrap?.appId ?? r.result.idea?.appId ?? null;
  const app = t ? apps.data?.find((a) => a.code === t.appCode) : apps.data?.find((a) => a.id === appId);
  const st = tone(RUN_ST, r.status);
  const start = runStart(r);
  const newer = (siblings.data ?? []).find((x) => x.id > r.id);
  const live = LIVE.includes(r.status);
  const title = t ? t.title : r.kind === 'bootstrap' ? `${app?.name ?? ''} 새 앱 시작` : runKindLabel(r) + (r.result.idea?.seed ? ` · ${r.result.idea.seed.title}` : r.result.idea?.ideaId ? ' 수정' : ' 생성');
  const meta: Array<[string, ReactNode, boolean?]> = [
    ['', `${app?.name ?? '새 앱'} · ${runKindLabel(r)}`],
    ...(r.result.repo ? ([['저장소', r.result.repo.name, true]] as Array<[string, ReactNode, boolean]>) : []),
    ['브랜치', r.branch ?? '–', true],
    ['worktree', tildify(r.worktreePath) || '–', true],
    ['시작', stamp(start)],
    [r.endedAt ? '걸린 시간' : '경과', r.endedAt ? dur((new Date(r.endedAt).getTime() - new Date(start).getTime()) / 1000) : clock(since(start, now)), true],
    ['비용', money(r.costUsd), true],
  ];
  const summary = r.result.output?.summary;
  const crumb = r.taskId ?? app?.code ?? '새 앱';

  return (
    <div data-screen-label="실행 상세" className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
          <button type="button" onClick={() => navigate(-1)} style={{ minHeight: 32, padding: 0, border: 0, background: 'none', fontSize: 13, color: 'var(--text-3)', cursor: 'pointer' }}>
            ← 뒤로
          </button>
          <span aria-hidden="true">/</span>
          <span className="mono">#{crumb}</span>
          <span aria-hidden="true">/</span>
          <span className="mono">run {r.id}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', minWidth: 0 }}>
            <h1 className="page-title" style={{ lineHeight: 1.3 }}>
              {title}
            </h1>
            <span className="pill" style={{ fontSize: 13, padding: '4px 12px', background: st.bg, color: st.fg }}>
              {st.label}
            </span>
          </div>
          <div className="page-actions">
            {t && (
              <button type="button" className="btn" onClick={() => panel.open(t.id)}>
                task 보기
              </button>
            )}
            {live && (
              <button type="button" className="btn" style={{ color: 'var(--risk)' }} disabled={stopIt.busy} onClick={() => void stopIt.run()}>
                실행 중지
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 13, color: 'var(--text-2)' }}>
          {meta.map(([k, v, mono]) => (
            <span key={k || 'app'} style={{ flex: 'none', maxWidth: '100%', whiteSpace: 'nowrap' }}>
              {k}{' '}
              <span className={mono ? 'mono' : undefined} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                {v}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {r.kind === 'bootstrap' && <BootSteps r={r} logs={logs.data ?? []} appCode={app?.code} appId={app?.id} />}
          <RunChat r={r} logs={logs.data} m={m} />
          {r.status === 'input' && <AnswerCard r={r} now={now} />}
          {(r.status === 'failed' || r.status === 'stopped') && r.kind !== 'bootstrap' && (
            <section style={{ background: r.status === 'failed' ? 'var(--risk-bg)' : 'var(--muted-bg)', border: `1px solid ${r.status === 'failed' ? 'var(--risk-line)' : 'var(--line-strong)'}`, borderRadius: 12, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: r.status === 'failed' ? 'var(--risk)' : 'var(--text-2)' }}>
                {r.status === 'failed' ? `실패 · ${failureLabel(r)}` : '중지'}
              </h2>
              {r.result.reason && (
                <p className="mono" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                  {r.result.reason}
                </p>
              )}
              {r.result.failure === 'check' && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>검사 명령의 출력은 위 로그의 "검사" 줄에 있어요. PR은 만들지 않았어요.</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {!newer && (!t || ['todo', 'doing', 'input'].includes(t.status)) && (
                  <button type="button" className="btn btn-primary" disabled={again.busy} onClick={() => void again.run()}>
                    다시 실행
                  </button>
                )}
                {newer && (
                  <button type="button" className="btn" onClick={() => navigate(`/runs/${newer.id}`)}>
                    다시 실행한 run {newer.id} 보기
                  </button>
                )}
                {t && (
                  <button type="button" className="btn" onClick={() => panel.open(t.id)}>
                    task에 메모 남기기
                  </button>
                )}
              </div>
            </section>
          )}
          {summary && (
            <section className="card" style={{ padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>결과 요약</h2>
                {t?.prUrl && (
                  <a className="link" style={{ marginLeft: 'auto', fontWeight: 600 }} href={t.prUrl} target="_blank" rel="noreferrer">
                    PR {prNo(t.prUrl)} 열기 ↗
                  </a>
                )}
              </div>
              <Markdown src={summary} />
            </section>
          )}
        </div>

        <aside style={{ flex: '2 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {r.kind === 'bootstrap' && app && (
            <Side title="앱">
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {app.code} {app.name}
              </span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
                {tildify(app.repoPath)}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>새 앱 시작은 claude를 쓰지 않아서 비용이 0이에요.</span>
              <button type="button" className="link" style={{ alignSelf: 'flex-start', minHeight: 36 }} onClick={() => navigate(`/apps/${app.code}`)}>
                앱 페이지 보기 →
              </button>
            </Side>
          )}
          {r.kind === 'idea_gen' && r.result.idea?.resultIdeaId && (
            <Side title="만든 기획">
              <button type="button" className="link" style={{ alignSelf: 'flex-start', minHeight: 36, fontSize: 14 }} onClick={() => navigate(`/ideas?idea=${r.result.idea!.resultIdeaId}`)}>
                {idea.data ? `${idea.data.title} · ${IDEA_ST[idea.data.status][0]}` : `기획 #${r.result.idea.resultIdeaId}`} →
              </button>
            </Side>
          )}
          {t && (
            <Side title="task" gap={12}>
              <button type="button" onClick={() => panel.open(t.id)} style={{ padding: 0, border: 0, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--text)', textAlign: 'left', cursor: 'pointer', lineHeight: 1.5 }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  #{t.id}
                </span>{' '}
                {t.title}
              </button>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span className="pill" style={{ background: tone(TASK_ST, t.status).bg, color: tone(TASK_ST, t.status).fg }}>
                  {TASK_ST[t.status][0]}
                </span>
                <span style={{ color: 'var(--text-3)' }}>
                  크기 <span className="mono" style={{ color: 'var(--text)' }}>{t.size ?? '–'}</span>
                </span>
              </div>
              {idea.data && (
                <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12, fontSize: 13, color: 'var(--text-3)' }}>
                  출처 기획 ·{' '}
                  <button type="button" className="link" onClick={() => navigate(`/ideas?idea=${idea.data!.id}`)}>
                    {idea.data.title}
                  </button>
                </div>
              )}
            </Side>
          )}
          {!!r.result.answers?.length && (
            <Side title="답변 기록" gap={12}>
              {r.result.answers.map((a, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {hm(a.ts)}
                  </span>{' '}
                  → {a.answer}
                </div>
              ))}
            </Side>
          )}
          {r.kind === 'implement' && (
            <Side title="PR">
              <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>실행이 끝나면 검사 명령을 돌리고 Hub가 push한 뒤 PR을 만들어요. 머지는 GitHub에서 diff를 보고 직접 해요.</span>
              {t?.prUrl && (
                <a className="link" style={{ alignSelf: 'flex-start', minHeight: 36, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }} href={t.prUrl} target="_blank" rel="noreferrer">
                  PR {prNo(t.prUrl)} 열기 ↗
                </a>
              )}
            </Side>
          )}
        </aside>
      </div>
    </div>
  );
}

function Side({ title, children, gap = 8 }: { title: string; children: ReactNode; gap?: number }) {
  return (
    <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  );
}

/** run 로그 → 대화 줄. 도구 결과는 앞서 나온 도구 중 아직 결과가 없는 첫 줄에 붙인다(로그는 순서대로 온다) */
export function runChat(r: RunDto, logs: RunLogDto[]): ChatItem[] {
  const items: ChatItem[] = [];
  const pending: Array<Extract<ChatItem, { kind: 'tool' }>> = [];
  const note = (e: RunLogDto, text: string, t: 'muted' | 'attn' | 'risk' | 'done') => items.push({ kind: 'note', id: `l${e.seq}`, at: e.ts, text, tone: t });
  for (const e of logs) {
    switch (e.kind) {
      case 'assistant':
        items.push({ kind: 'assistant', id: `l${e.seq}`, at: e.ts, text: e.text });
        break;
      case 'tool_use': {
        const sp = e.text.indexOf(' ');
        const t = { kind: 'tool' as const, id: `l${e.seq}`, at: e.ts, name: sp > 0 ? e.text.slice(0, sp) : e.text, summary: sp > 0 ? e.text.slice(sp + 1) : '', result: null, error: false };
        items.push(t);
        pending.push(t);
        break;
      }
      case 'tool_result': {
        const t = pending.shift();
        if (!t) break;
        t.error = e.text.startsWith('[오류]');
        t.result = t.error ? e.text.slice('[오류]'.length).trim() : e.text;
        break;
      }
      case 'check': {
        const first = e.text.split('\n')[0];
        items.push({ kind: 'tool', id: `l${e.seq}`, at: e.ts, name: '검사', summary: first, result: e.text, error: /실패|fail/i.test(first) });
        break;
      }
      case 'result': {
        const m = /^(\S+) turns=(\S*) cost=\$(\S*)/.exec(e.text);
        const ok = m?.[1] === 'success';
        note(e, m ? `${ok ? 'Claude 작업 끝' : `Claude 작업 끝: ${m[1]}`} · ${m[2]}턴 · $${Number(m[3] || 0).toFixed(2)}` : e.text, ok ? 'done' : 'risk');
        break;
      }
      case 'rate_limit':
        note(e, e.text, 'attn');
        break;
      case 'stderr':
        note(e, e.text.length > 300 ? `${e.text.slice(0, 300)}…` : e.text, 'risk');
        break;
      default:
        // hub(worktree·push·PR 진행), system(세션 시작 등)
        if (e.kind === 'system' && e.text === 'permission_denied') note(e, '허용되지 않은 도구라 쓰지 못했어요', 'attn');
        else note(e, e.text, 'muted');
    }
  }
  // 질문에 보낸 답변은 보낸 시각 자리에 내 말풍선으로 넣는다.
  for (const [k, a] of (r.result.answers ?? []).entries()) {
    const at = new Date(a.ts).getTime();
    const idx = items.findIndex((i) => i.at && new Date(i.at).getTime() > at);
    const item: ChatItem = { kind: 'user', id: `a${k}`, at: a.ts, text: a.answer, from: 'me', images: 0 };
    if (idx < 0) items.push(item);
    else items.splice(idx, 0, item);
  }
  return items;
}

/** 실행 상세의 대화. 세션 대화 보기와 같은 화면이고, WebSocket run.log로 이어 붙는다 */
function RunChat({ r, logs, m }: { r: RunDto; logs: RunLogDto[] | undefined; m: boolean }) {
  const items = useMemo(() => runChat(r, logs ?? []), [r, logs]);
  const running = r.status === 'running';
  return (
    <section aria-labelledby="chat-h" className="card" style={{ overflow: 'hidden' }}>
      <div className="card-head" style={{ borderBottom: '1px solid var(--line-soft)' }}>
        <span aria-hidden="true" className="dot" style={{ background: running ? 'var(--prog-dot)' : r.status === 'input' ? 'var(--attn-dot)' : 'var(--muted-dot)', animation: running ? 'hubPulse 1.6s ease-in-out infinite' : 'none' }} />
        <h2 id="chat-h">{LIVE.includes(r.status) ? '실시간 대화' : '대화'}</h2>
        <span className="card-sub">{logs ? `기록 ${logs.length}줄` : '불러오는 중'}</span>
      </div>
      <ChatView
        items={items}
        working={running}
        empty={r.status === 'queued' ? '차례를 기다리는 중이에요' : logs ? '기록이 없어요' : '불러오는 중이에요'}
        height={m ? '60vh' : 'min(620px, 70vh)'}
      />
    </section>
  );
}

function AnswerCard({ r, now }: { r: RunDto; now: number }) {
  const ui = useUi();
  const { m } = usePrefs();
  const answer = useAnswerRun();
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = useAction(async () => {
    if (!draft.trim()) return;
    await answer(r.id, draft.trim());
    setDraft('');
    ui.toast('답을 전달했어요 · 같은 세션을 이어서 실행해요');
  });
  // a 키로 답변 칸으로 간다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <section aria-labelledby="q-h" style={{ background: 'var(--attn-card)', border: '1px solid var(--attn-line)', borderRadius: 12, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 id="q-h" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--attn)' }}>
          Claude가 답을 기다리고 있어요 · {dur(since(r.endedAt ?? runStart(r), now))}째
        </h2>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{r.result.question ?? r.result.output?.question ?? '질문 내용을 읽지 못했어요 · 위 로그에서 확인하세요'}</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="answer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
          답하기 <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>· a 키로 이동, ⌘↵로 보내기</span>
        </label>
        <textarea
          id="answer"
          ref={ref}
          rows={2}
          className="textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send.run();
            }
          }}
          placeholder="예: 표시만 하고, 순서는 그대로 둬 줘"
          style={{ width: '100%', borderColor: 'var(--attn-soft)' }}
        />
        <div>
          <button type="button" className="btn btn-semi" disabled={!draft.trim() || send.busy} onClick={() => void send.run()}>
            답 보내기
          </button>
        </div>
      </div>
    </section>
  );
}

function BootSteps({ r, logs, appCode, appId }: { r: RunDto; logs: RunLogDto[]; appCode?: string; appId?: number }) {
  const navigate = useNavigate();
  const copy = useCopy();
  const { m } = usePrefs();
  const sessions = useAppSessions(appId);
  const retry = useAction(async () => {
    const next = await api.post<RunDto>(`/api/apps/${appId}/bootstrap`);
    navigate(`/runs/${next.id}`);
  });
  const hubLines = logs.filter((l) => l.kind === 'hub');
  const done = BOOT_STEPS.map(([, re]) => hubLines.find((l) => re.test(l.text)));
  const firstOpen = done.findIndex((d) => !d);
  const b = r.result.bootstrap;
  const rc = b?.rc;
  const sess = sessions.data?.find((s) => s.id === rc?.id);
  const link = sess?.remoteLink ?? rc?.link ?? null;
  return (
    <>
      <section aria-labelledby="boot-h" className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 10px', padding: '16px 20px' }}>
          <h2 id="boot-h" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            새 앱 시작 단계
          </h2>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {done.filter(Boolean).length}/{BOOT_STEPS.length} · 실행 로그의 hub 줄로 하나씩 체크해요
          </span>
        </div>
        {BOOT_STEPS.map(([label], i) => {
          const d = done[i];
          const state = d ? 'done' : i === firstOpen ? (r.status === 'failed' ? 'fail' : LIVE.includes(r.status) ? 'doing' : 'todo') : 'todo';
          return (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 12, alignItems: 'start', padding: '12px 20px', borderTop: '1px solid var(--line-soft)' }}>
              <StepIcon state={state} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: state === 'fail' ? 'var(--risk)' : state === 'todo' ? 'var(--text-3)' : 'var(--text)' }}>
                  {i + 1}. {label}
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
                  {d ? d.text : state === 'fail' ? r.result.reason : state === 'doing' ? '진행 중' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </section>
      {r.status === 'done' && rc && !b?.fallbackRunId && (
        <section style={{ background: 'var(--done-bg)', border: '1px solid var(--line)', borderRadius: 12, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--done)' }}>✓ 시작했어요</h2>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '10px 16px', fontSize: 14, alignItems: 'baseline' }}>
            {b?.repoUrl && (
              <>
                <dt style={{ color: 'var(--text-3)' }}>저장소</dt>
                <dd style={{ margin: 0 }}>
                  <a className="link" href={b.repoUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>
                    {b.repoUrl.replace(/^https:\/\//, '')} ↗
                  </a>
                </dd>
              </>
            )}
            <dt style={{ color: 'var(--text-3)' }}>세션</dt>
            <dd style={{ margin: 0 }}>
              {rc.name} {rc.id && <span className="mono" style={{ fontSize: 13 }}>· {rc.id}</span>}
            </dd>
            {link && (
              <>
                <dt style={{ color: 'var(--text-3)' }}>원격 조종</dt>
                <dd style={{ margin: 0 }}>
                  <a className="link" href={link} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>
                    {link.replace(/^https:\/\//, '')} ↗
                  </a>
                </dd>
              </>
            )}
            {rc.id && (
              <>
                <dt style={{ color: 'var(--text-3)' }}>터미널</dt>
                <dd style={{ margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <code className="mono" style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--surface)', fontSize: 13 }}>
                    claude attach {rc.id}
                  </code>
                  <button type="button" className="btn btn-xs" onClick={() => void copy(`claude attach ${rc.id}`)}>
                    복사
                  </button>
                </dd>
              </>
            )}
          </dl>
          {sess && appCode && (
            <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`/sessions/${appCode}/${sess.id}`)}>
              Hub에서 세션 보기
            </button>
          )}
        </section>
      )}
      {b?.fallbackRunId && (
        <section style={{ background: 'var(--attn-card)', border: '1px solid var(--attn-line)', borderRadius: 12, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--attn)' }}>세션을 띄우지 못했어요</h2>
          <span style={{ fontSize: 14, lineHeight: 1.6 }}>{b.fallbackReason ?? '세션 시작에 실패했어요'}. 폴더와 저장소는 만들어졌고, Hub가 첫 task를 runner로 대신 시작했어요.</span>
          <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`/runs/${b.fallbackRunId}`)}>
            Hub가 대신 시작한 run {b.fallbackRunId} →
          </button>
        </section>
      )}
      {r.status === 'failed' && (
        <section style={{ background: 'var(--risk-bg)', border: '1px solid var(--risk-line)', borderRadius: 12, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--risk)' }}>멈췄어요 · {failureLabel(r)}</h2>
          {r.result.reason && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{r.result.reason}</p>}
          {appId && (
            <div>
              <button type="button" className="btn btn-primary" disabled={retry.busy} onClick={() => void retry.run()}>
                다시 시도
              </button>
            </div>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>다시 시도하면 이미 끝난 단계는 건너뛰어요</span>
        </section>
      )}
    </>
  );
}

function StepIcon({ state }: { state: 'done' | 'fail' | 'doing' | 'todo' }) {
  const base: CSSProperties = { width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, boxSizing: 'border-box' };
  if (state === 'done') return <span style={{ ...base, background: 'var(--done-bg)', color: 'var(--done)' }}>✓</span>;
  if (state === 'fail') return <span style={{ ...base, background: 'var(--risk-bg)', color: 'var(--risk)' }}>!</span>;
  if (state === 'doing')
    return (
      <span style={{ ...base, border: '2px solid var(--prog-dot)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--prog-dot)', animation: 'hubPulse 1.6s ease-in-out infinite' }} />
      </span>
    );
  return <span style={{ ...base, border: '2px solid var(--line-strong)' }} />;
}


