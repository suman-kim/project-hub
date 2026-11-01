import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { CostSummaryDto, RunListItemDto, SessionViewDto } from '@hub/shared';
import { api } from '../api/client';
import { useAllSessions, useApps, useAppStatus } from '../api/queries';
import { useTaskContext } from '../api/taskContext';
import { CodeBox, Skeleton } from '../components/ui';
import { ago, isoDay, money } from '../lib/format';
import { DOT_COLOR, LIFE, TASK_ST, tone } from '../lib/labels';
import { useSessionPanel } from '../lib/nav';
import { usePrefs } from '../lib/prefs';
import { runKindLabel, runTitle } from '../lib/runs';
import { AppTag, SESSION_STATE } from './AppSessions';

// ---- 대시보드 위쪽: 지금 도는 것, 내가 답해야 할 것, 프로젝트 현황, 오늘의 흐름 ----

export function SectionTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', marginBottom: -8 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
      {sub && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{sub}</span>}
    </div>
  );
}

const inApp = (code: string | null, filter: string) => filter === 'all' || code === filter;
/** Hub가 돌리는 구현·기획 run의 세션은 run 줄로 보여 주므로 세션 목록에서는 뺀다 */
const isRunSession = (s: SessionViewDto) => s.origin === 'hub' && !!s.run && s.run.kind !== 'session';

function Row({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="row-btn" style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', minHeight: 52, padding: '10px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
      {children}
    </button>
  );
}

function SessionLine({ s }: { s: SessionViewDto }) {
  const apps = useApps();
  const st = tone(SESSION_STATE, s.state);
  const ts = s.task ? tone(TASK_ST, s.task.status) : null;
  return (
    <>
      <AppTag name={apps.data?.find((a) => a.code === s.appCode)?.name ?? s.appCode} />
      <span className="pill" style={{ background: st.bg, color: st.fg }}>
        <span className="dot dot-6" style={{ background: st.dot }} />
        {st.label}
      </span>
      <span className="ellipsis" style={{ flex: '1 1 200px', fontSize: 14, fontWeight: s.task ? 600 : 400, color: s.task ? 'var(--text)' : 'var(--text-3)' }}>
        {s.task ? `#${s.task.id} ${s.task.title}` : '진행 중인 task 없음'}
      </span>
      {ts && <span style={{ fontSize: 12, fontWeight: 600, color: ts.fg }}>{ts.label}</span>}
      <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{ago(s.lastAt ?? s.startedAt)}</span>
    </>
  );
}

/** 1. 지금 도는 것: 열린 세션과 실행 중인 run */
export function NowRunning({ runs }: { runs: RunListItemDto[] }) {
  const { appFilter } = usePrefs();
  const navigate = useNavigate();
  const panel = useSessionPanel();
  const sessions = (useAllSessions().data ?? [])
    .filter((s) => s.open && !isRunSession(s) && inApp(s.appCode, appFilter))
    .sort((a, b) => Number(b.state === 'working') - Number(a.state === 'working'));
  return (
    <section className="card">
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: sessions.some((s) => s.state === 'working') || runs.length ? 'var(--prog-dot)' : 'var(--muted-dot)' }} />
        <h2>지금 도는 것</h2>
        <span className="card-sub">열린 세션 {sessions.length} · 실행 중인 run {runs.length}</span>
        <button type="button" className="link" style={{ marginLeft: 'auto', fontSize: 13 }} onClick={() => navigate('/sessions')}>
          세션 전체 보기
        </button>
      </div>
      {sessions.map((s) => (
        <Row key={`s${s.id}`} onClick={() => panel.open(s.id)}>
          <SessionLine s={s} />
        </Row>
      ))}
      {runs.map((r) => (
        <Row key={`r${r.id}`} onClick={() => navigate(`/runs/${r.id}`)}>
          <CodeBox code={r.appCode ?? '새 앱'} small />
          <span className="pill" style={{ background: 'var(--prog-bg)', color: 'var(--prog)' }}>
            {r.status === 'queued' ? '차례 대기' : 'run 실행 중'}
          </span>
          <span className="ellipsis" style={{ flex: '1 1 200px', fontSize: 14, fontWeight: 600 }}>
            {runTitle(r)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            run {r.id} · {runKindLabel(r)}
          </span>
        </Row>
      ))}
      {!sessions.length && !runs.length && <div className="card-empty">지금 도는 세션이나 run이 없어요</div>}
    </section>
  );
}

/** 2. 내가 답해야 할 것(세션 쪽): task가 답변 대기인 열린 세션. 누르면 대화 패널에서 바로 답한다 */
export function AnswerSessions({ others }: { others: number }) {
  const { appFilter } = usePrefs();
  const panel = useSessionPanel();
  const list = (useAllSessions().data ?? []).filter((s) => s.open && !isRunSession(s) && s.task?.status === 'input' && inApp(s.appCode, appFilter));
  if (!list.length) return others ? null : <div style={{ fontSize: 13, color: 'var(--text-3)' }}>답해야 할 질문이 없어요</div>;
  return (
    <section className="card" style={{ borderColor: 'var(--attn-line)' }}>
      <div className="card-head">
        <span aria-hidden="true" className="dot" style={{ background: 'var(--attn-dot)' }} />
        <h2>답변을 기다리는 세션</h2>
        <span className="card-sub">누르면 대화가 열리고 아래 입력창에서 바로 답해요</span>
      </div>
      {list.map((s) => (
        <Row key={s.id} onClick={() => panel.open(s.id)}>
          <SessionLine s={s} />
        </Row>
      ))}
    </section>
  );
}

/** 3. 프로젝트 현황 카드 */
export function ProjectCards() {
  const { appFilter } = usePrefs();
  const navigate = useNavigate();
  const status = useAppStatus();
  const ctx = useTaskContext();
  const sessions = useAllSessions().data ?? [];
  const list = (status.data ?? []).filter((a) => a.lifecycle !== 'archived' && inApp(a.code, appFilter));
  if (status.isLoading) return <Skeleton rows={2} height={110} />;
  if (!list.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {list.map((a) => {
        const tasks = ctx.list.filter((t) => t.appCode === a.code);
        const open = tasks.filter((t) => ['todo', 'doing', 'input'].includes(t.status)).length;
        const review = tasks.filter((t) => t.status === 'review').length;
        const live = sessions.filter((s) => s.open && s.appCode === a.code).length;
        const dep = a.signals.deploy[0];
        const sg = a.signals;
        return (
          <button key={a.code} type="button" onClick={() => navigate(`/apps/${a.code}`)} className="list-item" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span aria-hidden="true" className="dot" style={{ background: DOT_COLOR[sg.dot] }} />
              <span className="ellipsis" style={{ fontSize: 15, fontWeight: 700 }}>
                {a.name}
              </span>
              <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>{LIFE[a.lifecycle][0]}</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>단계 {sg.stage ? `${sg.stage.name} (${sg.stage.index + 1}/${sg.stage.total})` : '없음'}</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 13 }}>
              <span>열린 task {open}</span>
              <span style={{ color: review ? 'var(--check)' : undefined }}>리뷰 {review}</span>
              <span style={{ color: sg.bugs.critical ? 'var(--risk)' : undefined }}>
                버그 {sg.bugs.open}
                {sg.bugs.critical ? ` (심각 ${sg.bugs.critical})` : ''}
              </span>
              <span style={{ color: live || sg.running ? 'var(--prog)' : undefined }}>
                세션 {live} · run {sg.running}
              </span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              배포 {dep ? `${dep.env} ${dep.status}${dep.at ? ` · ${ago(dep.at)}` : ''}` : '기록 없음'} · 마지막 활동 {sg.activity.lastAt ? ago(sg.activity.lastAt) : '없음'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 4. 오늘의 흐름: 오늘 끝난 task, 머지된 PR, 배포, 비용 */
export function TodayFlow() {
  const { appFilter } = usePrefs();
  const ctx = useTaskContext();
  const status = useAppStatus();
  const costs = useQuery({ queryKey: ['costs', 'summary'], queryFn: () => api.get<CostSummaryDto>('/api/costs') });
  const today = isoDay();
  const isToday = (at: string | null | undefined) => !!at && isoDay(new Date(at)) === today;
  const done = ctx.list.filter((t) => t.status === 'done' && isToday(t.updatedAt) && inApp(t.appCode, appFilter));
  const merged = done.filter((t) => t.prUrl);
  const deploys = (status.data ?? []).filter((a) => inApp(a.code, appFilter)).flatMap((a) => a.signals.deploy.filter((d) => isToday(d.at)));
  const days = costs.data?.byDay ?? [];
  const weekFrom = isoDay(new Date(Date.now() - 6 * 86_400_000));
  const todayCost = days.filter((d) => d.date === today).reduce((n, d) => n + d.costUsd, 0);
  const weekCost = days.filter((d) => d.date >= weekFrom).reduce((n, d) => n + d.costUsd, 0);
  const cell = (label: string, value: ReactNode, sub?: ReactNode) => (
    <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700 }}>{value}</span>
      {sub && (
        <span className="ellipsis" style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {sub}
        </span>
      )}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {cell('오늘 끝난 task', done.length, done.slice(0, 4).map((t) => `#${t.id}`).join(' · ') || '아직 없어요')}
      {cell('오늘 머지된 PR', merged.length, merged.slice(0, 4).map((t) => `#${t.id}`).join(' · ') || '아직 없어요')}
      {cell('오늘 배포', deploys.length, deploys.slice(0, 3).map((d) => `${d.env} ${d.status}`).join(' · ') || '아직 없어요')}
      {cell('비용 (전체 앱)', money(todayCost), `최근 7일 ${money(weekCost)}`)}
    </div>
  );
}
