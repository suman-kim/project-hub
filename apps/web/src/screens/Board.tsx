import { useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskAssignee, TaskDto, TaskStatus, TaskType } from '@hub/shared';
import { TASK_SIZES, TASK_TYPES } from '@hub/shared';
import { useAction, useStartRun, useUpdateTask } from '../api/mutations';
import { useApps } from '../api/queries';
import { useTaskContext } from '../api/taskContext';
import { AppFilter } from '../components/AppFilter';
import { OpenSessionsStrip } from './AppSessions';
import { Segmented } from '../components/forms';
import { Select } from '../components/Select';
import { useDialogs } from '../components/GlobalDialogs';
import { IdeaBadge, prNo } from '../components/TaskPanel';
import { CodeBox, ErrorBox, Skeleton, useUi } from '../components/ui';
import { clock, since } from '../lib/format';
import { RUN_ST, SEVERITY, TASK_ST, TASK_TYPE, tone, TONE } from '../lib/labels';
import { useTaskPanel } from '../lib/nav';
import { readPref, usePrefs, writePref } from '../lib/prefs';
import { useNow } from '../lib/useNow';

type View = 'kanban' | 'list';

const num = (id: string) => Number(id.split('-')[1]) || 0;
const asc = (a: TaskDto, b: TaskDto) => (a.appCode === b.appCode ? num(a.id) - num(b.id) : a.appCode < b.appCode ? -1 : 1);
/** 완료·취소는 최근에 바뀐 것부터 */
const recent = (a: TaskDto, b: TaskDto) => b.updatedAt.localeCompare(a.updatedAt);

/** 검색어를 비교용으로 다듬는다. 앞의 #은 ID 표기라 뗀다 */
export const searchNeedle = (q: string) => q.trim().toLowerCase().replace(/^#/, '');
/** 제목이나 ID에 검색어가 들어 있으면 true. 빈 검색어는 모두 통과 */
export const matchesSearch = (t: TaskDto, needle: string) => !needle || t.title.toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle);

/** 보드 정렬. 기본은 앱·번호 순이고 완료·취소는 최근에 바뀐 것부터 */
export type BoardSort = 'default' | 'created_desc' | 'created_asc' | 'updated_desc' | 'priority' | 'due';
const SORTS: Record<BoardSort, { label: string; cmp: ((a: TaskDto, b: TaskDto) => number) | null }> = {
  default: { label: '기본 (번호 순)', cmp: null },
  created_desc: { label: '생성일 최신 순', cmp: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  created_asc: { label: '생성일 오래된 순', cmp: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  updated_desc: { label: '최근 변경 순', cmp: recent },
  // 우선순위는 1이 높음. 없는 것은 뒤로, 같으면 최신 생성 순
  priority: { label: '우선순위 높은 순', cmp: (a, b) => (a.priority ?? 9) - (b.priority ?? 9) || b.createdAt.localeCompare(a.createdAt) },
  // 기한이 없는 것은 뒤로
  due: { label: '기한 가까운 순', cmp: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt.localeCompare(a.createdAt) },
};
const SORT_KEYS = Object.keys(SORTS) as BoardSort[];
/** 고른 정렬. 기본이면 열마다 원래 순서(진행 중 등은 번호 순, 완료·취소는 최근 것부터) */
const sorter = (sort: BoardSort, st: TaskStatus) => SORTS[sort].cmp ?? (st === 'done' || st === 'cancelled' ? recent : asc);

const KANBAN: TaskStatus[] = ['todo', 'doing', 'input', 'review', 'done'];
const GROUPS: TaskStatus[] = ['input', 'doing', 'review', 'todo', 'done', 'cancelled'];

/** appCode가 있으면 앱 페이지의 태스크 보드 탭이다: 그 앱 task만 보이고, 앱 칩과 큰 제목은 없다 */
export function Board({ appCode }: { appCode?: string } = {}) {
  const { m, appFilter: prefFilter } = usePrefs();
  const appFilter = appCode ?? prefFilter;
  const ctx = useTaskContext();
  const apps = useApps();
  const dialogs = useDialogs();
  const [view, setViewState] = useState<View>(() => readPref<View>('hub.boardView', 'kanban', ['kanban', 'list']));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | TaskStatus>('all');
  const [tag, setTag] = useState('all');
  const [sizes, setSizes] = useState<string[]>([]);
  const [type, setType] = useState<'all' | TaskType>('all');
  const [assignee, setAssignee] = useState<'all' | TaskAssignee>('all');
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [sort, setSortState] = useState<BoardSort>(() => readPref<BoardSort>('hub.boardSort', 'default', SORT_KEYS));
  const setSort = (v: BoardSort) => {
    writePref('hub.boardSort', v);
    setSortState(v);
  };
  const setView = (v: View) => {
    writePref('hub.boardView', v);
    setViewState(v);
  };

  const inApp = useMemo(() => ctx.list.filter((t) => appFilter === 'all' || t.appCode === appFilter), [ctx.list, appFilter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of ctx.list) c[t.appCode] = (c[t.appCode] ?? 0) + 1;
    return c;
  }, [ctx.list]);
  const tags = useMemo(() => [...new Set(inApp.map((t) => t.tag).filter((x): x is string => !!x))].sort(), [inApp]);
  const needle = searchNeedle(q);
  const filtered = inApp.filter(
    (t) =>
      matchesSearch(t, needle) &&
      (status === 'all' || t.status === status) &&
      (tag === 'all' || t.tag === tag) &&
      (!sizes.length || (t.size && sizes.includes(t.size))) &&
      (type === 'all' || t.type === type) &&
      (assignee === 'all' || t.assignee === assignee),
  );
  const fActive = !!needle || status !== 'all' || tag !== 'all' || sizes.length > 0 || type !== 'all' || assignee !== 'all';
  const clear = () => {
    setQ('');
    setStatus('all');
    setTag('all');
    setSizes([]);
    setType('all');
    setAssignee('all');
  };
  const appName = appFilter === 'all' ? null : (apps.data?.find((a) => a.code === appFilter)?.name ?? appFilter);
  const byStatus = (st: TaskStatus) => filtered.filter((t) => t.status === st).sort(sorter(sort, st));

  return (
    <div data-screen-label="태스크 보드" className={appCode ? undefined : 'page'} style={appCode ? { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 } : undefined}>
      <div className="page-head">
        <div style={appCode ? { display: 'none' } : undefined}>
          <span className="page-sub">
            {appName ? `${appName}의 task` : `앱 ${apps.data?.length ?? 0}개의 task를 한 보드에서`} · {fActive ? `${inApp.length}개 중 ${filtered.length}개` : `${inApp.length}개`}
          </span>
          <h1 className="page-title">태스크 보드</h1>
        </div>
        <div style={{ flex: '0 1 auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <input type="search" className="input" style={{ flex: '1 1 220px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="task 검색 (#ID, 제목)" aria-label="task 검색" />
          <Segmented
            label="보기"
            options={[
              ['kanban', '칸반'],
              ['list', '목록'],
            ]}
            value={view}
            onChange={setView}
            style={{ alignSelf: 'center' }}
          />
          <button type="button" className="btn btn-primary" onClick={() => dialogs.open({ kind: 'createTask', app: appFilter === 'all' ? undefined : appFilter })}>
            task 추가
          </button>
        </div>
      </div>
      {!appCode && <AppFilter counts={counts} />}
      <OpenSessionsStrip appCode={appFilter} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Select<'all' | TaskStatus>
          label="상태"
          size="sm"
          value={status}
          onChange={setStatus}
          menuWidth={180}
          options={[{ value: 'all', label: '모든 상태' }, ...(Object.keys(TASK_ST) as TaskStatus[]).map((k) => ({ value: k, label: TASK_ST[k][0], dot: TONE[TASK_ST[k][1]].dot }))]}
        />
        <Select label="태그" size="sm" value={tag} onChange={setTag} menuWidth={180} options={[{ value: 'all', label: '모든 태그' }, ...tags.map((x) => ({ value: x, label: x }))]} />
        <Select<'all' | TaskType> label="종류" size="sm" value={type} onChange={setType} menuWidth={160} options={[{ value: 'all', label: '모든 종류' }, ...TASK_TYPES.map((k) => ({ value: k, label: TASK_TYPE[k] }))]} />
        <Select<'all' | TaskAssignee>
          label="담당"
          size="sm"
          value={assignee}
          onChange={setAssignee}
          menuWidth={160}
          options={[
            { value: 'all', label: '모든 담당' },
            { value: 'claude', label: 'Claude' },
            { value: 'me', label: '나' },
          ]}
        />
        <div role="group" aria-label="크기" style={{ display: 'flex', gap: 4 }}>
          {TASK_SIZES.map((z) => {
            const on = sizes.includes(z);
            return (
              <button
                key={z}
                type="button"
                aria-pressed={on}
                onClick={() => setSizes(on ? sizes.filter((x) => x !== z) : [...sizes, z])}
                className="mono"
                style={{ minWidth: 40, minHeight: 40, borderRadius: 8, border: `1px solid ${on ? 'var(--ink)' : 'var(--line-strong)'}`, background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--on-ink)' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {z}
              </button>
            );
          })}
        </div>
        {fActive && (
          <button type="button" className="link" style={{ minHeight: 40, padding: '0 6px' }} onClick={clear}>
            필터 지우기
          </button>
        )}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)' }}>
          정렬
          <Select<BoardSort> label="정렬" size="sm" value={sort} onChange={setSort} menuWidth={200} options={SORT_KEYS.map((k) => ({ value: k, label: SORTS[k].label }))} />
        </label>
      </div>

      {ctx.loading && <Skeleton rows={6} height={48} />}
      {ctx.error && <ErrorBox error={ctx.error} onRetry={() => void ctx.refetch()} />}

      {view === 'kanban' && filtered.length > 0 && <Kanban tasks={filtered} ctx={ctx} sort={sort} />}

      {view === 'list' && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {GROUPS.map((st) => {
            const ids = byStatus(st);
            if (!ids.length) return null;
            const fold = st === 'done' || st === 'cancelled';
            const open = status === st || (groupOpen[st] ?? !fold);
            const lim = st === 'done' ? (limits.listDone ?? 20) : ids.length;
            const shown = open ? ids.slice(0, lim) : [];
            const tp = tone(TASK_ST, st);
            const stale = st === 'doing' ? ids.filter((t) => !ctx.lastRun.has(t.id)).length : 0;
            return (
              <section key={st} className="card">
                <button
                  type="button"
                  onClick={() => setGroupOpen({ ...groupOpen, [st]: !open })}
                  aria-expanded={open}
                  style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', minHeight: 52, padding: '12px 20px', border: 0, background: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ width: 12, fontSize: 11, color: 'var(--text-3)' }}>{open ? '▾' : '▸'}</span>
                  <span aria-hidden="true" className="dot" style={{ background: tp.dot }} />
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{tp.label}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {ids.length}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{fold && !open ? '접어 둠' : shown.length < ids.length ? `${sort === 'default' ? '최근 ' : ''}${shown.length}개` : ''}</span>
                  {stale > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>{stale}개는 실행 기록이 없어요 · Task Master의 in-progress를 옮겨 온 상태</span>}
                </button>
                {shown.map((t) => (
                  <TaskRow key={t.id} t={t} ctx={ctx} />
                ))}
                {open && shown.length < ids.length && (
                  <button
                    type="button"
                    onClick={() => setLimits({ ...limits, listDone: lim + 20 })}
                    className="row-btn"
                    style={{ width: '100%', minHeight: 44, border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer', borderRadius: '0 0 12px 12px' }}
                  >
                    20개 더 보기 · 남은 {ids.length - shown.length}개
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}

      {!ctx.loading && !inApp.length && (
        <section style={{ background: 'var(--surface)', border: '1px dashed var(--line-strong)', borderRadius: 12, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{appName ?? '전체'}에는 task가 없어요</h2>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Task Master에서 가져오거나 직접 만드세요. 가져오기는 앱 설정에 있어요.</span>
          </div>
          <EmptyActions app={appFilter === 'all' ? null : appFilter} />
        </section>
      )}
      {inApp.length > 0 && !filtered.length && (
        <section style={{ background: 'var(--surface)', border: '1px dashed var(--line-strong)', borderRadius: 12, padding: '28px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: 'var(--text-2)' }}>조건에 맞는 task가 없어요</span>
          <button type="button" className="link" style={{ fontSize: 14 }} onClick={clear}>
            필터 지우기
          </button>
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: 12, color: 'var(--text-3)' }}>
        <span>task 상태는 Claude Code가 허브 MCP로 바꿔요 · 화면에서는 허용된 전이만 누를 수 있어요</span>
        <span>할 일 카드의 "실행"을 누르면 worktree를 만들고 시작해요</span>
      </div>
    </div>
  );
}

function EmptyActions({ app }: { app: string | null }) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" className="btn btn-primary" onClick={() => navigate(app ? `/apps/${app}/settings` : '/new-app')}>
        Task Master에서 가져오기
      </button>
      <button type="button" className="btn" onClick={() => dialogs.open({ kind: 'createTask', app: app ?? undefined })}>
        task 추가
      </button>
    </div>
  );
}

export type Ctx = ReturnType<typeof useTaskContext>;

/** 카드와 목록 행이 같이 쓰는 표시 값 */
function useCardModel(t: TaskDto, ctx: Ctx) {
  const ui = useUi();
  const navigate = useNavigate();
  const panel = useTaskPanel();
  const startRun = useStartRun();
  const update = useUpdateTask();
  const active = ctx.activeRun(t.id);
  const now = useNow(1000, !!active);
  const last = ctx.lastRun.get(t.id);
  const blockers = ctx.blockers(t);
  const run = useAction(async (e?: MouseEvent) => {
    e?.stopPropagation();
    await startRun(t.id);
  });
  const done = useAction(async () => {
    await update(t.id, { status: 'done' });
    ui.toast(`#${t.id}를 완료로 바꿨어요`);
  });
  const meta = active
    ? `run ${active.id} · ${clock(since(active.startedAt ?? active.createdAt, now))}`
    : t.status === 'done'
      ? '완료'
      : t.status === 'cancelled'
        ? '취소'
        : `크기 ${t.size ?? '–'}${t.dependsOn.length ? ` · 의존 #${t.dependsOn.join(', #')}` : ''}`;
  return {
    active,
    last,
    blockers,
    meta,
    runBlock: ctx.runBlock(t),
    repoName: ctx.repoName(t),
    multiRepo: ctx.reposOf(t.appCode).length > 1,
    open: () => panel.open(t.id),
    viewRun: (id: number) => navigate(`/runs/${id}`),
    run,
    done,
  };
}

export function TaskCard({ t, ctx }: { t: TaskDto; ctx: Ctx }) {
  const c = useCardModel(t, ctx);
  const panel = useTaskPanel();
  const sel = panel.taskId === t.id;
  const sev = t.type === 'bug' ? (t.metadata.bug as { severity?: string } | undefined)?.severity : undefined;
  return (
    <article
      style={{ background: sel ? 'var(--accent-sel)' : 'var(--surface)', border: `1px solid ${t.status === 'input' ? 'var(--attn-line)' : sel ? 'var(--accent)' : 'var(--line)'}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <CodeBox code={t.appCode} small />
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
          #{t.id}
        </span>
        {c.multiRepo && (
          <span className="mono ellipsis" style={{ fontSize: 11, color: c.repoName ? 'var(--text-3)' : 'var(--attn)' }}>
            {c.repoName ?? '저장소 없음'}
          </span>
        )}
        {sev && (
          <span className="pill" style={{ background: tone(SEVERITY, sev).bg, color: tone(SEVERITY, sev).fg }}>
            {tone(SEVERITY, sev).label}
          </span>
        )}
        {c.blockers.length > 0 && (
          <span className="pill" title={`완료되지 않은 선행 task: #${c.blockers.join(', #')}`} style={{ marginLeft: 'auto', background: 'var(--attn-bg)', color: 'var(--attn)' }}>
            막힘
          </span>
        )}
      </div>
      <button type="button" className="title-btn" onClick={c.open} style={{ lineHeight: 1.45 }}>
        {t.title}
      </button>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <IdeaBadge ideaId={t.ideaId} />
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>{t.tag ?? '태그 없음'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{c.meta}</span>
      </div>
      {t.status === 'todo' &&
        (t.assignee === 'me' ? (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>내 할 일 · 직접 하고 완료로 바꿔요</span>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            onClick={(e) => void c.run.run(e)}
            disabled={!!c.runBlock || c.run.busy}
            title={c.runBlock ?? '실행'}
            style={{ fontSize: 13 }}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4l12 8-12 8z" />
            </svg>
            {c.runBlock === '저장소를 먼저 고르세요' ? '저장소를 먼저 고르세요' : '실행'}
          </button>
        ))}
      {t.status === 'input' && c.active && (
        <button type="button" className="btn btn-sm btn-attn-solid" style={{ border: 0 }} onClick={() => c.viewRun(c.active!.id)}>
          질문에 답하기
        </button>
      )}
      {t.status === 'doing' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 }}>
          {c.active ? (
            <button type="button" className="link" style={{ minHeight: 32 }} onClick={() => c.viewRun(c.active!.id)}>
              실시간 로그 보기
            </button>
          ) : c.last ? (
            <button type="button" className="link" style={{ minHeight: 32 }} onClick={() => c.viewRun(c.last!.id)}>
              최근 run {RUN_ST[c.last.status][0]} · 로그
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>실행 기록 없음</span>
          )}
        </div>
      )}
      {t.status === 'review' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 }}>
            {t.prUrl && <span style={{ fontWeight: 600, color: 'var(--check)', whiteSpace: 'nowrap' }}>PR {prNo(t.prUrl)}</span>}
            <span className="mono ellipsis" style={{ color: 'var(--text-3)' }}>
              {t.branch ?? ''}
            </span>
            {t.prUrl && (
              <a href={t.prUrl} target="_blank" rel="noreferrer" className="link" style={{ marginLeft: 'auto', flex: 'none', fontSize: 12 }}>
                PR 열기
              </a>
            )}
          </div>
          <button type="button" className="btn btn-sm" disabled={c.done.busy} onClick={() => void c.done.run()}>
            완료로 바꾸기
          </button>
        </>
      )}
    </article>
  );
}

export function TaskRow({ t, ctx }: { t: TaskDto; ctx: Ctx }) {
  const c = useCardModel(t, ctx);
  const panel = useTaskPanel();
  const sel = panel.taskId === t.id;
  const st = c.active ? tone(RUN_ST, c.active.status) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={c.open}
      onKeyDown={(e) => e.key === 'Enter' && c.open()}
      className="row-btn"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', minHeight: 48, padding: '8px 20px', borderTop: '1px solid var(--line-soft)', background: sel ? 'var(--accent-sel)' : undefined, cursor: 'pointer' }}
    >
      <CodeBox code={t.appCode} small />
      <span className="mono" style={{ width: 64, flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>
        #{t.id}
      </span>
      <span style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="ellipsis" style={{ fontSize: 14, fontWeight: 500 }}>
          {t.title}
        </span>
        {c.blockers.length > 0 && (
          <span className="pill" title={`완료되지 않은 선행 task: #${c.blockers.join(', #')}`} style={{ flex: 'none', background: 'var(--attn-bg)', color: 'var(--attn)' }}>
            막힘
          </span>
        )}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>
        {c.multiRepo && <span className="mono" style={{ color: c.repoName ? 'var(--text-3)' : 'var(--attn)' }}>{c.repoName ?? '저장소 없음'}</span>}
        <IdeaBadge ideaId={t.ideaId} />
        <span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>{t.tag ?? '태그 없음'}</span>
        <span className="mono" style={{ color: 'var(--text-2)' }}>
          {t.size ?? ''}
        </span>
        {t.prUrl && (
          <span className="mono" style={{ color: 'var(--check)' }}>
            PR {prNo(t.prUrl)}
          </span>
        )}
        {st && <span style={{ fontWeight: 600, color: st.fg }}>{st.label}</span>}
        {t.assignee === 'me' && <span style={{ color: TONE.muted.fg }}>내 할 일</span>}
      </span>
    </div>
  );
}

/** 상태별 칸반. 할 일·진행 중·리뷰는 12개, 완료는 10개씩 보여 준다 */
export function Kanban({ tasks, ctx, sort = 'default' }: { tasks: TaskDto[]; ctx: Ctx; sort?: BoardSort }) {
  const { m } = usePrefs();
  const [limits, setLimits] = useState<Record<string, number>>({});
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8, margin: '0 -2px', scrollSnapType: 'x mandatory' }}>
      <div style={{ display: 'grid', gridTemplateColumns: m ? 'repeat(5, 82vw)' : 'repeat(5, minmax(232px, 1fr))', gap: 16, alignItems: 'start', padding: '0 2px' }}>
        {KANBAN.map((st) => {
          const ids = tasks.filter((t) => t.status === st).sort(sorter(sort, st));
          const step = st === 'done' ? 10 : 12;
          const lim = limits[st] ?? step;
          const shown = ids.slice(0, lim);
          const tp = tone(TASK_ST, st);
          return (
            <section key={st} style={{ background: 'var(--sunken)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 200, minWidth: 0, scrollSnapAlign: 'start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 2px' }}>
                <span aria-hidden="true" className="dot" style={{ background: tp.dot }} />
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{tp.label}</h2>
                {st === 'done' && sort === 'default' && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>최근 것부터</span>}
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-2)' }}>
                  {ids.length}
                </span>
              </div>
              {!ids.length && <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>이 조건에는 없어요</div>}
              {shown.map((t) => (
                <TaskCard key={t.id} t={t} ctx={ctx} />
              ))}
              {ids.length > shown.length && (
                <button
                  type="button"
                  onClick={() => setLimits({ ...limits, [st]: lim + step })}
                  style={{ minHeight: 40, borderRadius: 8, border: '1px dashed var(--line-strong)', background: 'transparent', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                >
                  {Math.min(step, ids.length - shown.length)}개 더 보기 · 남은 {ids.length - shown.length}개
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
