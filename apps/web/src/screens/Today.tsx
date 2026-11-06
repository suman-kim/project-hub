import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import type { MyTodoDto, RunListItemDto, TaskNote } from '@hub/shared';
import { api } from '../api/client';
import { useInbox, type WaitingSession } from '../api/inbox';
import { useAction, useAnswerRun, useRerun, useStopRun, useUpdateTask } from '../api/mutations';
import { keys, useApps, useIdeationSettings, useRuns, type BgSessionView } from '../api/queries';
import { AppFilter } from '../components/AppFilter';
import { AnswerSessions, NowRunning, ProjectCards, SectionTitle, TodayFlow } from './DashboardSections';
import { sessionReason, sessionState, TodoCheckRow } from '../components/blocks';
import { useDialogs } from '../components/GlobalDialogs';
import { IconClock } from '../components/icons';
import { prNo } from '../components/TaskPanel';
import { CodeBox, useUi } from '../components/ui';
import { dayHour, nextAt, parseCron } from '../lib/cron';
import { clock, dueLabel, dur, hm, longDate, money, since, stamp, when } from '../lib/format';
import { ENV, SESSION_ST, tone } from '../lib/labels';
import { daysLeft, dLeft, DOC_KIND, mdOf } from '../lib/mine';
import { firstLine } from '../lib/md';
import { useTaskPanel } from '../lib/nav';
import { usePrefs } from '../lib/prefs';
import { failureLabel, runKindLabel, runStart, runTitle } from '../lib/runs';
import { useNow } from '../lib/useNow';
import { useDocTitles, useToggleMine } from './Mine';

/** 처리할 일을 한곳에 모은 첫 화면. 칸마다 그 자리에서 끝낼 수 있는 동작을 붙인다 */
export function Today() {
  const { appFilter } = usePrefs();
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const apps = useApps();
  const inbox = useInbox();
  const app = appFilter === 'all' ? null : apps.data?.find((a) => a.code === appFilter);
  const appName = (code: string) => apps.data?.find((a) => a.code === code)?.name ?? code;
  const recent = useRuns({ status: ['done'], kind: 'implement', app: app?.code, limit: 4 });
  const empty = !inbox.loading && inbox.todoCount === 0;
  const now = Date.now();
  const firstInput = inbox.input[0];

  return (
    <div data-screen-label="대시보드" className="page" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <span className="page-sub">
            {longDate()} · {inbox.todoCount ? `처리할 일 ${inbox.todoCount}건` : '처리할 일 없음'}
          </span>
          <h1 className="page-title">대시보드</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => dialogs.open({ kind: 'gen', app: app?.code })}>
            기획 지금 생성
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/board')}>
            task 실행하기
          </button>
        </div>
      </div>
      <AppFilter />

      {app && !app.repoPath && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 12, background: 'var(--attn-card)', border: '1px solid var(--attn-line)' }}>
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--attn)' }}>{app.name}에는 저장소 경로가 없어요</span>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>실행과 기획 생성을 하려면 저장소 경로를 설정하세요.</span>
          </div>
          <button type="button" className="btn btn-attn" onClick={() => navigate(`/apps/${app.code}/settings`)}>
            앱 설정에서 경로 넣기
          </button>
        </div>
      )}

      <NowRunning runs={inbox.running} />

      <SectionTitle title="내가 답해야 할 것" sub="run의 질문과 답변을 기다리는 세션" />

      {inbox.input.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {inbox.input.map((r) => (
            <QuestionCard key={r.id} r={r} />
          ))}
        </div>
      )}

      {inbox.sessions.length > 0 && <WaitingSessions sessions={inbox.sessions} />}
      <AnswerSessions others={inbox.input.length + inbox.sessions.length} />

      <SectionTitle title="프로젝트 현황" />
      <ProjectCards />

      <SectionTitle title="오늘의 흐름" />
      <TodayFlow />

      <SectionTitle title="처리할 일" sub="배포 실패 · 실패한 run · 리뷰 PR · 기한 지난 내 할 일 · 만료·갱신 · 기획" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '3 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {inbox.deployFailures.length > 0 && <DeployFailures />}
          {inbox.failed.length > 0 && <FailedRuns runs={inbox.failed} appName={appName} />}
          {inbox.review.length > 0 && <ReviewTasks />}
          {(inbox.overdue.length > 0 || inbox.mineOverdue.length > 0) && <OverdueTodos />}
          {inbox.mineAlerts.length > 0 && <MineAlerts />}
          {empty && (
            <section style={{ background: 'var(--surface)', border: '1px dashed var(--line-strong)', borderRadius: 12, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>처리할 일이 없습니다</h2>
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>답변 대기, 실패한 run, 리뷰 대기, 검토할 기획이 생기면 여기에 모여요.</span>
            </section>
          )}
          {empty && (recent.data?.length ?? 0) > 0 && (
            <section className="card">
              <div className="card-head">
                <span aria-hidden="true" className="dot" style={{ background: 'var(--done-dot)' }} />
                <h2>최근 완료된 run</h2>
              </div>
              {recent.data!.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate(`/runs/${r.id}`)}
                  className="row-btn"
                  style={{ width: '100%', display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '12px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
                >
                  <CodeBox code={r.appCode ?? '–'} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
                      {runTitle(r, appName)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      run {r.id} · {stamp(r.endedAt)} · {r.endedAt ? dur((new Date(r.endedAt).getTime() - new Date(runStart(r)).getTime()) / 1000) : ''} · {money(r.costUsd)}
                    </span>
                  </span>
                  <span className="pill" style={{ padding: '4px 10px', background: 'var(--done-bg)', color: 'var(--done)' }}>
                    완료
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>
        <PendingIdeas />
      </div>
    </div>
  );
}

/** 답변을 기다리는 run. 서버에 빠른 답 선택지가 없어서 직접 입력만 받는다 */
function QuestionCard({ r }: { r: RunListItemDto }) {
  const ui = useUi();
  const navigate = useNavigate();
  const panel = useTaskPanel();
  const { m } = usePrefs();
  const answer = useAnswerRun();
  const [draft, setDraft] = useState('');
  const send = useAction(async () => {
    if (!draft.trim()) return;
    await answer(r.id, draft.trim());
    setDraft('');
    ui.toast(`run ${r.id}에 답을 보냈어요 · 같은 세션으로 이어서 실행해요`);
  });
  const answers = r.result.answers ?? [];
  const last = answers[answers.length - 1];
  const question = r.result.question ?? r.result.output?.question ?? '질문 내용을 읽지 못했어요 · 로그에서 확인하세요';
  return (
    <section style={{ background: 'var(--attn-card)', border: '1px solid var(--attn-line)', borderRadius: 12, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--attn)' }}>Claude가 답을 기다리고 있어요 · {dur(since(r.endedAt ?? runStart(r)))}째</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <CodeBox code={r.appCode ?? '–'} small style={{ borderColor: 'var(--attn-soft)' }} />
          <button type="button" className="title-btn" style={{ flex: '1 1 auto', minWidth: 0, fontSize: 15 }} onClick={() => (r.taskId ? panel.open(r.taskId) : navigate(`/runs/${r.id}`))}>
            {r.taskId && (
              <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: 'var(--attn-deep)' }}>
                #{r.taskId}{' '}
              </span>
            )}
            {r.taskTitle ?? runTitle(r)}
          </button>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{question}</p>
      {last && (
        <div style={{ fontSize: 13, color: 'var(--attn-deep)', lineHeight: 1.5 }}>
          앞서 보낸 답 {answers.length}개 · “{last.answer}” <span className="mono">{hm(last.ts)}</span>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          rows={2}
          className="textarea"
          aria-label={`run ${r.id}에 답하기`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send.run();
            }
          }}
          placeholder="답하기 · ⌘↵로 보내기"
          style={{ flex: '1 1 260px', borderColor: 'var(--attn-soft)' }}
        />
        <button type="button" className="btn btn-semi" disabled={!draft.trim() || send.busy} onClick={() => void send.run()}>
          답 보내기
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12, color: 'var(--attn-deep)' }}>
        <span>보내면 같은 세션으로 이어서 실행해요</span>
        <button type="button" className="link" style={{ fontSize: 12, fontWeight: 600, color: 'var(--attn)' }} onClick={() => navigate(`/runs/${r.id}`)}>
          run {r.id} 로그 보기
        </button>
      </div>
    </section>
  );
}

function WaitingSessions({ sessions }: { sessions: WaitingSession[] }) {
  const navigate = useNavigate();
  const apps = useApps();
  const codes = [...new Set(sessions.map((s) => s.appCode))];
  const details = useQueries({
    queries: codes.map((code) => {
      const id = apps.data?.find((a) => a.code === code)?.id ?? 0;
      return { queryKey: keys.sessions(id), queryFn: () => api.get<BgSessionView[]>(`/api/apps/${id}/sessions`), enabled: !!id };
    }),
    combine: (rs) => rs.flatMap((r) => r.data ?? []),
  });
  return (
    <section className="card" style={{ borderColor: 'var(--attn-line)' }}>
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: 'var(--attn-dot)' }} />
        <h2>새 앱 세션 대기</h2>
        <span className="card-sub">Hub 밖에서 도는 원격 조종 세션이라 터미널이나 데스크톱 앱 목록에는 안 보여요</span>
      </div>
      {sessions.map((s) => {
        const d = details.find((x) => x.id === s.id);
        const st = tone(SESSION_ST, d ? sessionState(d) : 'input');
        return (
          <div key={s.id} className="card-row">
            <div className="row-main">
              <CodeBox code={s.appCode} />
              <div className="row-text">
                <button type="button" className="title-btn" onClick={() => navigate(`/sessions/${s.appCode}/${s.id}`)}>
                  {s.name}
                </button>
                <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{d ? sessionReason(d) : s.waitingFor ? `입력을 기다려요 · ${s.waitingFor}` : '입력을 기다려요'}</span>
                <span className="row-meta">
                  <span className="pill" style={{ background: st.bg, color: st.fg }}>
                    {st.label}
                  </span>
                </span>
              </div>
            </div>
            <div className="row-actions">
              {d?.remoteLink && (
                <a href={d.remoteLink} target="_blank" rel="noreferrer" className="link" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>
                  원격 조종 열기 ↗
                </a>
              )}
              <button type="button" className="btn btn-sm btn-attn" onClick={() => navigate(`/sessions/${s.appCode}/${s.id}`)}>
                Hub에서 보기
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function FailedRuns({ runs, appName }: { runs: RunListItemDto[]; appName(code: string): string }) {
  const navigate = useNavigate();
  const panel = useTaskPanel();
  const rerun = useRerun();
  const again = useAction(async (r: RunListItemDto) => {
    const next = await rerun(r);
    if (!r.taskId) navigate(`/runs/${next.id}`);
  });
  const sorted = [...runs].sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
  return (
    <section className="card">
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: 'var(--risk)' }} />
        <h2>실패한 run</h2>
        <span className="card-sub">사유를 보고 다시 실행하거나 메모를 남겨요</span>
      </div>
      {sorted.map((r) => (
        <div key={r.id} className="card-row">
          <div className="row-main">
            <CodeBox code={r.appCode ?? '새 앱'} />
            <div className="row-text">
              <button type="button" className="title-btn ellipsis" onClick={() => (r.taskId ? panel.open(r.taskId) : navigate(`/runs/${r.id}`))}>
                {runTitle(r, appName)}
              </button>
              {r.result.reason && (
                <span className="mono ellipsis" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {r.result.reason}
                </span>
              )}
              <span className="row-meta">
                <span className="pill" style={{ background: 'var(--risk-bg)', color: 'var(--risk)' }}>
                  {failureLabel(r)}
                </span>
                run {r.id} · {stamp(r.endedAt)}
              </span>
            </div>
          </div>
          <div className="row-actions">
            <button type="button" className="link" style={{ minHeight: 40, padding: '0 4px' }} onClick={() => navigate(`/runs/${r.id}`)}>
              로그 보기
            </button>
            <button type="button" className="btn btn-sm" disabled={again.busy} onClick={() => void again.run(r)}>
              다시 실행
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function ReviewTasks() {
  const ui = useUi();
  const navigate = useNavigate();
  const panel = useTaskPanel();
  const inbox = useInbox();
  const update = useUpdateTask();
  const done = useAction(async (id: string) => {
    await update(id, { status: 'done' });
    ui.toast(`#${id}를 완료로 바꿨어요`);
  });
  return (
    <section className="card">
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: 'var(--check-dot)' }} />
        <h2>리뷰 대기</h2>
        <span className="card-sub">GitHub에서 머지한 뒤 완료로 바꿔요</span>
        <button type="button" className="link" style={{ marginLeft: 'auto' }} onClick={() => navigate('/board')}>
          보드에서 보기
        </button>
      </div>
      {inbox.review.map((t) => {
        const notes = (t.metadata.notes as TaskNote[] | undefined) ?? [];
        const summary = firstLine([...notes].reverse().find((n) => n.status === 'review')?.note ?? notes[notes.length - 1]?.note);
        return (
          <div key={t.id} className="card-row">
            <div className="row-main">
              <CodeBox code={t.appCode} />
              <div className="row-text">
                <button type="button" className="title-btn ellipsis" onClick={() => panel.open(t.id)}>
                  #{t.id} {t.title}
                </button>
                {summary && (
                  <span className="ellipsis" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {summary}
                  </span>
                )}
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
                  {t.prUrl && <span style={{ fontWeight: 600, color: 'var(--check)' }}>PR {prNo(t.prUrl)}</span>}
                  <span className="mono" style={{ color: 'var(--text-3)' }}>
                    {t.branch}
                  </span>
                </span>
              </div>
            </div>
            <div className="row-actions">
              {t.prUrl && (
                <a href={t.prUrl} target="_blank" rel="noreferrer" className="link" style={{ minHeight: 40, padding: '0 4px', display: 'inline-flex', alignItems: 'center' }}>
                  PR 열기 ↗
                </a>
              )}
              <button type="button" className="btn btn-sm" disabled={done.busy} onClick={() => void done.run(t.id)}>
                완료로 바꾸기
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function DeployFailures() {
  const navigate = useNavigate();
  const inbox = useInbox();
  return (
    <section className="card" style={{ borderColor: 'var(--risk-line)' }}>
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: 'var(--risk)' }} />
        <h2>운영 배포 실패</h2>
        <span className="card-sub">운영·스토어의 가장 최근 배포가 실패했어요</span>
      </div>
      {inbox.deployFailures.map((d, i) => (
        <button
          key={`${d.appCode}-${d.repoName}-${d.env}-${i}`}
          type="button"
          onClick={() => navigate(`/apps/${d.appCode}/stage`)}
          className="row-btn"
          style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', padding: '14px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'var(--risk-bg)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
        >
          <CodeBox code={d.appCode} />
          <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
              {d.repoName ?? '앱 전체'} · {ENV[d.env]} {d.version ?? ''}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{stamp(d.at)} · 단계·배포 탭에서 보기</span>
          </span>
          <span className="pill" style={{ marginLeft: 'auto', background: 'var(--surface)', color: 'var(--risk)' }}>
            실패
          </span>
        </button>
      ))}
    </section>
  );
}

function OverdueTodos() {
  const ui = useUi();
  const inbox = useInbox();
  const update = useUpdateTask();
  const done = useAction(async (id: string) => {
    await update(id, { status: 'done' });
    ui.toast('완료로 바꿨어요', { undo: () => void update(id, { status: 'todo' }).catch(ui.fail) });
  });
  return (
    <section className="card" style={{ borderColor: 'var(--attn-line)' }}>
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: 'var(--attn-dot)' }} />
        <h2>기한 지난 내 할 일</h2>
        <span className="card-sub">내가 직접 할 일 · 체크하면 바로 완료돼요</span>
      </div>
      {inbox.overdue.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ paddingLeft: 12 }}>
            <CodeBox code={t.appCode} small />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TodoCheckRow t={t} busy={done.busy} onToggle={() => void done.run(t.id)} />
          </div>
        </div>
      ))}
      {inbox.mineOverdue.map((t) => (
        <MineOverdueRow key={`me${t.id}`} t={t} />
      ))}
    </section>
  );
}

/** 기한 지난 내 업무 할 일: 앱 대신 "공통"으로 표시하고, 누르면 내 업무로 간다 */
function MineOverdueRow({ t }: { t: MyTodoDto }) {
  const navigate = useNavigate();
  const toggle = useToggleMine();
  const titles = useDocTitles();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 56, padding: '6px 20px 6px 12px', borderTop: '1px solid var(--line-soft)' }}>
      <span style={{ flex: 'none', padding: '1px 8px', borderRadius: 6, border: '1px solid var(--line-strong)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>공통</span>
      <button type="button" role="checkbox" aria-checked={false} aria-label="완료로 표시" disabled={toggle.busy} onClick={() => void toggle.run(t)} style={{ width: 44, height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'none', cursor: 'pointer' }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid var(--attn-soft)', background: 'var(--surface)' }} />
      </button>
      <button type="button" onClick={() => navigate('/mine')} style={{ flex: 1, minWidth: 0, padding: 0, border: 0, background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45 }}>{t.title}</span>
        <span style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--attn)' }}>{dueLabel(t.dueDate)}</span>
          <span style={{ color: 'var(--text-3)' }}> · 내 업무{t.docId && titles.get(t.docId) ? ` · 문서 ${titles.get(t.docId)}` : ''}</span>
        </span>
      </button>
    </div>
  );
}

/** 14일 안에 만료·갱신·결제되는 보관함 문서. 공통 문서는 내 업무 보관함으로, 앱 전용 문서는 그 앱 페이지 보관함으로 연다 */
function MineAlerts() {
  const navigate = useNavigate();
  const inbox = useInbox();
  const apps = useApps();
  const codeOf = new Map((apps.data ?? []).map((a) => [a.id, a.code]));
  /** 문서 서랍 주소. 앱 코드를 아직 모르면 내 업무 보관함으로 */
  const docUrl = (appId: number | null, id: number) => {
    const code = appId === null ? null : codeOf.get(appId);
    return code ? `/apps/${code}/vault?doc=${id}` : `/mine?tab=vault&doc=${id}`;
  };
  return (
    <section className="card" style={{ borderColor: 'var(--attn-line)' }}>
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: 'var(--attn-dot)' }} />
        <h2>만료·갱신 예정</h2>
        <span className="card-sub">보관함 · 14일 안</span>
        <button type="button" className="link" style={{ marginLeft: 'auto', fontSize: 13 }} onClick={() => navigate('/mine?tab=vault')}>
          보관함 보기
        </button>
      </div>
      {inbox.mineAlerts.map((d) => {
        const off = daysLeft(d.expiresOn!);
        return (
          <button
            key={d.id}
            type="button"
            className="row-btn"
            onClick={() => navigate(docUrl(d.appId, d.id))}
            style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', minHeight: 52, padding: '8px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
          >
            <span style={{ flex: 'none', padding: '1px 8px', borderRadius: 6, border: '1px solid var(--line-strong)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{d.appId === null ? '공통' : (codeOf.get(d.appId) ?? '앱')}</span>
            <span style={{ flex: 'none', padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', fontSize: 12, color: 'var(--text-2)' }}>{DOC_KIND[d.kind]}</span>
            <span className="ellipsis" style={{ flex: '1 1 160px', minWidth: 0, fontSize: 14, fontWeight: 600 }}>
              {d.title || '제목 없음'}
            </span>
            <span style={{ flex: 'none', fontSize: 13, fontWeight: 600, color: off < 0 ? 'var(--risk)' : 'var(--attn)' }}>
              {d.renewLabel} {mdOf(d.expiresOn!)} · {dLeft(off)}
            </span>
          </button>
        );
      })}
    </section>
  );
}


function PendingIdeas() {
  const navigate = useNavigate();
  const inbox = useInbox();
  const apps = useApps();
  const ideation = useIdeationSettings();
  const { appFilter } = usePrefs();
  const sorted = [...inbox.ideas].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // 다음 자동 생성: 앱마다의 주기와 새 앱 기획 주기 가운데 가장 이른 것
  const now = new Date();
  const plans = [
    ...(apps.data ?? []).filter((a) => a.repoPath && (appFilter === 'all' || a.code === appFilter)).map((a) => ({ name: a.name, at: nextAt(parseCron(a.ideaCron), now) })),
    ...(appFilter === 'all' && ideation.data ? [{ name: '새 앱 기획', at: nextAt(parseCron(ideation.data.cron), now) }] : []),
  ].filter((p): p is { name: string; at: Date } => !!p.at);
  const soonest = plans.reduce<Date | null>((acc, p) => (!acc || p.at < acc ? p.at : acc), null);
  const next = soonest ? `다음 자동 생성 · ${dayHour(soonest, now)} · ${plans.filter((p) => p.at.getTime() === soonest.getTime()).map((p) => p.name).join(', ')}` : '자동 생성이 꺼져 있어요 · 앱 설정에서 주기를 정해요';

  return (
    <section className="card" style={{ flex: '2 1 300px' }}>
      <div className="card-head">
        <h2>대기 중 기획</h2>
        {sorted.length > 0 && (
          <span className="pill" style={{ background: 'var(--check-bg)', color: 'var(--check)' }}>
            검토 대기 {sorted.length}
          </span>
        )}
        <button type="button" className="link" style={{ marginLeft: 'auto' }} onClick={() => navigate('/ideas')}>
          모두 보기
        </button>
      </div>
      {sorted.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => navigate(`/ideas?idea=${i.id}`)}
          className="row-btn"
          style={{ width: '100%', display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '14px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
        >
          <CodeBox code={i.kind === 'app' ? '새 앱' : (i.appCode ?? '–')} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{i.title}</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
              v{i.currentVersion} · {when(i.createdAt)}
            </span>
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-ink)' }}>검토</span>
        </button>
      ))}
      {!sorted.length && <div className="card-empty">검토할 기획이 없어요</div>}
      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line-soft)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
        <IconClock size={16} />
        {next}
      </div>
    </section>
  );
}

