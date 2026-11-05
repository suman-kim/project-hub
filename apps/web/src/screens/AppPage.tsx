import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AppDto, AppLifecycle, AppOverviewDto, DeploymentDto } from '@hub/shared';
import { APP_LIFECYCLES } from '@hub/shared';
import { useAction, useUpdateApp, useUpdateTask } from '../api/mutations';
import { useAppByCode, useAppSessions, useClaudeSessions, useOverview, useTasks } from '../api/queries';
import { ActivityRow, SessionCard, StatCard, StatGrid, TodoCheckRow, useActivityNav } from '../components/blocks';
import { IconChevronDown, IconClock, IconCode, IconDoc, IconGlobe, IconPhone } from '../components/icons';
import { ErrorBox, Skeleton, useUi } from '../components/ui';
import { ago, dueLabel, money, stamp } from '../lib/format';
import { DEPLOY_ST, ENV, LIFE, LIFE_HINT, tone, TONE } from '../lib/labels';
import { readPref, writePref } from '../lib/prefs';
import { tildify } from '../lib/paths';
import { DocsTab } from './AppDocs';
import { NotesTab } from './AppNotes';
import { SessionsTab } from './AppSessions';
import { AppSettings } from './AppSettings';
import { IdeasTab } from './AppTabs';
import { Board } from './Board';
import { HistoryTab, StageTab } from './AppStageHistory';

export type AppTab = 'overview' | 'board' | 'sessions' | 'stage' | 'history' | 'ideas' | 'notes' | 'docs' | 'design' | 'settings';

const TABS: Array<[AppTab, string]> = [
  ['overview', '개요'],
  ['board', '태스크 보드'],
  ['sessions', '세션'],
  ['stage', '단계·배포'],
  ['history', '히스토리'],
  ['ideas', '기획'],
  ['notes', '노트'],
  ['docs', '문서'],
  ['design', '디자인'],
  ['settings', '설정'],
];

/** links의 이름 → 아이콘과 표시 이름. 그 밖의 이름은 그대로 보여 준다 */
const LINK_META: Record<string, [string, (p: { size?: number }) => JSX.Element]> = {
  github: ['GitHub', IconCode],
  web: ['운영 주소', IconGlobe],
  ios: ['App Store', IconPhone],
  android: ['Play 스토어', IconPhone],
  doc: ['문서', IconDoc],
};
export const LINK_KEYS = Object.keys(LINK_META);
export const linkLabel = (key: string) => LINK_META[key]?.[0] ?? key;

/** 알림 띠의 "계속"은 서버가 기억하지 않는다. 이 브라우저에서 14일 동안 닫아 둔다 */
const NUDGE_HIDE_DAYS = 14;

export function AppPage() {
  const { code = '', tab: tabParam } = useParams();
  const navigate = useNavigate();
  const app = useAppByCode(code);
  const overview = useOverview(app.data?.id);
  const claude = useClaudeSessions(app.data?.id);
  // 예전 개발·내 할 일·버그 탭 주소는 태스크 보드로 연다.
  const wanted = ['dev', 'todo', 'bugs'].includes(tabParam ?? '') ? 'board' : tabParam;
  const tab: AppTab = TABS.some(([k]) => k === wanted) ? (wanted as AppTab) : 'overview';
  const goTab = (k: AppTab) => navigate(`/apps/${app.data?.code ?? code}${k === 'overview' ? '' : `/${k}`}`);

  if (app.isLoading) return <Skeleton rows={4} height={44} />;
  if (app.error) return <ErrorBox error={app.error} onRetry={() => void app.refetch()} />;
  if (!app.data)
    return (
      <div className="card card-empty" style={{ borderTop: '1px solid var(--line)' }}>
        {code.toUpperCase()} 앱이 없어요 · 사이드바 "앱" 옆 + 버튼으로 등록하세요
      </div>
    );

  const a = app.data;
  const ov = overview.data?.app.id === a.id ? overview.data : undefined;
  return (
    <div data-screen-label="앱 페이지" className="page">
      <AppHeader app={a} />
      {ov?.signals.nudge && <Nudge app={a} text={ov.signals.nudge} />}
      <div role="tablist" aria-label="앱 페이지" style={{ display: 'flex', gap: 2, overflowX: 'auto', overflowY: 'hidden', borderBottom: '1px solid var(--line)' }}>
        {TABS.map(([k, label]) => {
          const sel = tab === k;
          const count =
            k === 'board' ? (ov ? ov.counts.tasks + ov.counts.todos + ov.counts.bugs : undefined) : k === 'sessions' ? claude.data?.filter((s) => s.open).length : undefined;
          const red = k === 'board' && (ov?.signals.bugs.critical ?? 0) > 0;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => goTab(k)}
              style={{ flex: 'none', minHeight: 44, padding: '0 12px', marginBottom: -1, border: 0, borderBottom: `2px solid ${sel ? 'var(--accent)' : 'transparent'}`, background: 'none', color: sel ? 'var(--text)' : 'var(--text-3)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            >
              {label}
              {!!count && (
                <span style={{ fontSize: 12, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: red ? 'var(--risk-bg)' : 'var(--chip)', color: red ? 'var(--risk)' : 'var(--text-2)' }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
      {tab === 'overview' && (ov ? <Overview ov={ov} goTab={goTab} /> : overview.error ? <ErrorBox error={overview.error} onRetry={() => void overview.refetch()} /> : <Skeleton rows={5} height={52} />)}
      {tab === 'settings' && <AppSettings app={a} />}
      {tab === 'board' && <Board appCode={a.code} />}
      {tab === 'sessions' && <SessionsTab app={a} />}
      {tab === 'stage' && <StageTab app={a} ov={ov} />}
      {tab === 'history' && <HistoryTab app={a} />}
      {tab === 'ideas' && <IdeasTab app={a} />}
      {tab === 'notes' && <NotesTab app={a} />}
      {tab === 'docs' && <DocsTab key="docs" app={a} dir="docs" />}
      {tab === 'design' && <DocsTab key="design" app={a} dir="design" />}
    </div>
  );
}

function AppHeader({ app }: { app: AppDto }) {
  const ui = useUi();
  const update = useUpdateApp();
  const [lcOpen, setLcOpen] = useState(false);
  const lc = tone(LIFE, app.lifecycle);
  const si = app.stage ? app.stages.findIndex((s) => s.key === app.stage) : -1;
  const setLifecycle = useAction(async (to: AppLifecycle) => {
    setLcOpen(false);
    if (to === app.lifecycle) return;
    await update(app.id, { lifecycle: to });
    ui.toast(`${app.name} · ${LIFE[app.lifecycle][0]} → ${LIFE[to][0]}`);
  });
  const setStage = useAction(async (key: string) => {
    if (key === app.stage) return;
    await update(app.id, { stage: key });
    ui.toast(`단계를 ${app.stages.find((s) => s.key === key)?.name}(으)로 옮겼어요`);
  });
  const links = Object.entries(app.links ?? {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '12px 16px' }}>
        <span style={{ minWidth: 44, height: 44, padding: '0 8px', flex: 'none', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>
          {app.code}
        </span>
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px' }}>
            <h1 className="page-title" style={{ lineHeight: 1.25 }}>
              {app.name}
            </h1>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setLcOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={lcOpen}
                title="진행 상태 바꾸기"
                disabled={setLifecycle.busy}
                style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px 0 12px', borderRadius: 999, border: 0, background: lc.bg, color: lc.fg, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {lc.label}
                <IconChevronDown />
              </button>
              {lcOpen && (
                <>
                  <div onClick={() => setLcOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 24 }} />
                  <div role="menu" aria-label="진행 상태" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 25, width: 250, padding: 6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 12px 32px var(--shadow)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {APP_LIFECYCLES.map((k) => {
                      const on = k === app.lifecycle;
                      return (
                        <button
                          key={k}
                          type="button"
                          role="menuitemradio"
                          aria-checked={on}
                          className="menu-item"
                          onClick={() => void setLifecycle.run(k)}
                          style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', border: 0, borderRadius: 7, background: on ? 'var(--chip)' : 'transparent', color: 'var(--text)', fontSize: 14, fontWeight: 500, textAlign: 'left', cursor: 'pointer' }}
                        >
                          <span aria-hidden="true" className="dot" style={{ background: TONE[LIFE[k][1]].dot }} />
                          {LIFE[k][0]}
                          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>{LIFE_HINT[k]}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)' }}>{app.description || '소개가 없어요 · 설정 탭에서 넣어요'}</p>
        </div>
        {links.length > 0 && (
          <div aria-label="링크" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {links.map(([key, url]) => {
              const [label, Icon] = LINK_META[key] ?? [key, IconGlobe];
              return (
                <a key={key} href={url} target="_blank" rel="noreferrer" title={url} className="link-chip" style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', textDecoration: 'none' }}>
                  <Icon size={14} />
                  <span>{label}</span>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 8px', fontSize: 13 }}>
          <span style={{ color: 'var(--text-3)' }}>현재 단계</span>
          <span style={{ fontWeight: 600 }}>{si >= 0 ? `${app.stages[si].name} (${si + 1}/${app.stages.length})` : '단계 없음'}</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>· 단계를 누르면 그 단계로 옮겨요</span>
        </div>
        <div role="group" aria-label="단계" style={{ display: 'flex', gap: 4 }}>
          {app.stages.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => void setStage.run(s.key)}
              disabled={setStage.busy}
              aria-current={i === si ? 'step' : undefined}
              title={i === si ? '현재 단계' : `${s.name} 단계로 옮기기`}
              style={{ flex: '1 1 0', minWidth: 0, minHeight: 44, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: 0, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span style={{ display: 'block', height: 6, borderRadius: 3, background: i <= si ? 'var(--accent)' : 'var(--line-strong)' }} />
              <span className="ellipsis" style={{ fontSize: 12, fontWeight: i === si ? 700 : 500, color: i === si ? 'var(--accent-ink)' : i < si ? 'var(--text-2)' : 'var(--text-3)' }}>
                {s.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Nudge({ app, text }: { app: AppDto; text: string }) {
  const ui = useUi();
  const update = useUpdateApp();
  const key = `hub.nudge.${app.code}`;
  const [hiddenAt, setHiddenAt] = useState(() => Number(readPref(key, '0')));
  const pause = useAction(async () => {
    await update(app.id, { lifecycle: 'paused' });
    ui.toast(`${app.name}을 멈춤으로 바꿨어요`);
  });
  if (Date.now() - hiddenAt < NUDGE_HIDE_DAYS * 86_400_000) return null;
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '12px 16px', borderRadius: 10, background: 'var(--muted-bg)', border: '1px solid var(--line-strong)' }}>
      <span style={{ flex: 'none', color: 'var(--text-2)', display: 'flex' }}>
        <IconClock />
      </span>
      <span style={{ flex: '1 1 240px', fontSize: 14, lineHeight: 1.5 }}>{text}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const now = Date.now();
            writePref(key, String(now));
            setHiddenAt(now);
            ui.toast(`알림을 닫았어요 · ${LIFE[app.lifecycle][0]}으로 둬요`);
          }}
        >
          계속
        </button>
        <button type="button" className="btn btn-sm" disabled={pause.busy} onClick={() => void pause.run()} style={{ border: 0, background: 'var(--ink)', color: 'var(--on-ink)' }}>
          멈춤으로
        </button>
      </div>
    </div>
  );
}

function SectionCard({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {sub && <span className="card-sub">{sub}</span>}
        {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
      </div>
      {children}
    </section>
  );
}

function Overview({ ov, goTab }: { ov: AppOverviewDto; goTab: (k: AppTab) => void }) {
  const navigate = useNavigate();
  const ui = useUi();
  const { app, signals: sg, counts } = ov;
  const sessions = useAppSessions(app.id);
  const openDev = useTasks({ app: app.code, assignee: 'claude', status: ['doing', 'input', 'review'] });
  const updateTask = useUpdateTask();
  const actNav = useActivityNav(app.code);
  const toggle = useAction(async (id: string) => {
    await updateTask(id, { status: 'done' });
    ui.toast('완료로 바꿨어요', { undo: () => void updateTask(id, { status: 'todo' }).catch(ui.fail) });
  });

  const devRows = (openDev.data ?? []).filter((t) => t.type !== 'bug' && t.appCode === app.code);
  const nDoing = devRows.filter((t) => t.status === 'doing' || t.status === 'input').length;
  const nReview = devRows.filter((t) => t.status === 'review').length;
  const blocked = sg.blocked.waitingRuns + sg.blocked.failedRuns + sg.blocked.waitingSessions.length;
  const nextDue = ov.nextTodos.find((t) => t.dueDate)?.dueDate ?? null;
  const deps = [...ov.latestDeployments].sort((x, y) => Number(y.status === 'failure') - Number(x.status === 'failure'));
  const noRepo = !app.repoPath && ov.repos.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
      {noRepo && (
        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 12, background: 'var(--attn-card)', border: '1px solid var(--attn-line)' }}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--attn)' }}>저장소 경로를 넣으세요</span>
            <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{app.name}에는 저장소가 없어서 실행, 배포 기록, 기획 생성을 할 수 없어요.</span>
          </div>
          <button type="button" className="btn btn-attn" onClick={() => goTab('settings')}>
            설정 탭에서 경로 넣기
          </button>
        </section>
      )}
      <StatGrid>
        <StatCard label="열린 개발 task" n={counts.tasks} sub={counts.tasks ? `진행 중 ${nDoing} · 리뷰 ${nReview}` : '열린 task가 없어요'} onClick={() => goTab('board')} />
        <StatCard
          label="열린 버그"
          n={counts.bugs}
          sub={sg.bugs.critical ? `치명·높음 ${sg.bugs.critical}개` : counts.bugs ? '치명·높음 없음' : '열린 버그가 없어요'}
          hot={sg.bugs.critical ? 'risk' : null}
          onClick={() => goTab('board')}
        />
        <StatCard
          label="내 할 일"
          n={counts.todos}
          sub={counts.overdueTodos ? `기한 지남 ${counts.overdueTodos}개` : nextDue ? `가장 가까운 기한 ${dueLabel(nextDue)}` : counts.todos ? '기한 없음' : '남은 할 일이 없어요'}
          hot={counts.overdueTodos ? 'attnLine' : null}
          onClick={() => goTab('board')}
        />
        <StatCard label="이번 달 비용" n={money(ov.costThisMonthUsd)} sub="API 환산 · 실제 청구액이 아니에요" onClick={() => navigate('/costs')} />
      </StatGrid>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 24px', padding: '12px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--text-2)' }}>
        <Signal label="막힘" v={String(blocked)} dot={blocked ? 'var(--attn-dot)' : 'var(--line-strong)'} fg={blocked ? 'var(--attn)' : 'var(--text)'} />
        <Signal label="실행 중" v={String(sg.running)} dot={sg.running ? 'var(--prog-dot)' : 'var(--line-strong)'} />
        <Signal label="마지막 활동" v={sg.activity.lastAt ? ago(sg.activity.lastAt) : '없음'} dot={(sg.activity.quietDays ?? 0) > 14 || !sg.activity.lastAt ? 'var(--muted-dot)' : 'var(--done-dot)'} />
        {blocked > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            답변 대기 {sg.blocked.waitingRuns} · 실패한 실행 {sg.blocked.failedRuns} · 허락 대기 세션 {sg.blocked.waitingSessions.length}
          </span>
        )}
      </div>

      {(sessions.data ?? []).map((s) => (
        <SessionCard key={s.id} s={s} appCode={app.code} />
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '3 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SectionCard
            title="최근 배포"
            sub="저장소·환경마다 가장 최근 것"
            action={
              <button type="button" className="link" onClick={() => goTab('stage')}>
                단계·배포 보기
              </button>
            }
          >
            {deps.map((d) => (
              <DeployRow key={d.id} d={d} onClick={() => goTab('stage')} />
            ))}
            {!deps.length && <div className="card-empty">아직 배포 기록이 없어요</div>}
          </SectionCard>
          <SectionCard
            title="최근 히스토리"
            action={
              <button type="button" className="link" onClick={() => goTab('history')}>
                히스토리 전체 보기
              </button>
            }
          >
            {ov.recentActivities.map((a) => (
              <ActivityRow key={a.id} a={a} onClick={actNav(a)} />
            ))}
            {!ov.recentActivities.length && <div className="card-empty">아직 기록이 없어요</div>}
          </SectionCard>
        </div>
        <div style={{ flex: '2 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SectionCard
            title="다음 할 일"
            sub="내가 직접 할 일 · 기한 순"
            action={
              <button type="button" className="link" onClick={() => goTab('board')}>
                전체 보기
              </button>
            }
          >
            {ov.nextTodos.map((t) => (
              <TodoCheckRow key={t.id} t={t} busy={toggle.busy} onToggle={() => void toggle.run(t.id)} />
            ))}
            {!ov.nextTodos.length && <div className="card-empty">남은 내 할 일이 없어요</div>}
          </SectionCard>
          <SectionCard title="저장소" sub={<span className="mono">{ov.repos.length}</span>}>
            {ov.repos.map((r) => (
              <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 20px', borderTop: '1px solid var(--line-soft)', minWidth: 0 }}>
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                    {r.name}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>기본 브랜치 {r.defaultBranch}</span>
                </span>
                {r.github && (
                  <a href={`https://github.com/${r.github}`} target="_blank" rel="noreferrer" className="link" style={{ alignSelf: 'flex-start', overflowWrap: 'anywhere' }}>
                    github.com/{r.github} ↗
                  </a>
                )}
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
                  {tildify(r.path)}
                </span>
              </div>
            ))}
            {!ov.repos.length && <div className="card-empty">저장소가 없어요</div>}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function Signal({ label, v, dot, fg = 'var(--text)' }: { label: string; v: string; dot: string; fg?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span aria-hidden="true" className="dot" style={{ background: dot }} />
      {label}
      <strong style={{ fontWeight: 600, color: fg }}>{v}</strong>
    </span>
  );
}

export function DeployRow({ d, onClick }: { d: DeploymentDto; onClick?: () => void }) {
  const t = tone(DEPLOY_ST, d.status);
  const at = d.finishedAt ?? d.startedAt;
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-btn"
      style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', minHeight: 52, padding: '10px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: d.status === 'failure' ? 'var(--risk-bg)' : 'transparent', color: 'var(--text)', textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="mono ellipsis" style={{ fontSize: 13, fontWeight: 500 }}>
          {d.repoName ?? d.environment}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{at ? `${stamp(at)} · ${ago(at)}` : '시각 없음'}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>{ENV[d.env]}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {d.version ?? d.sha?.slice(0, 7) ?? ''}
        </span>
        <span className="pill" style={{ background: t.bg, color: t.fg }}>
          {t.label}
        </span>
      </span>
    </button>
  );
}
