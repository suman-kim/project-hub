import { Select } from '../components/Select';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AppDto, BugSeverity, TaskDto } from '@hub/shared';
import { api } from '../api/client';
import { useAction, useUpdateTask } from '../api/mutations';
import { useIdeas, useRuns } from '../api/queries';
import { useTaskContext } from '../api/taskContext';
import { useDialogs } from '../components/GlobalDialogs';
import { CodeBox, Skeleton, useUi } from '../components/ui';
import { dueLabel, dueOffset, when } from '../lib/format';
import { IDEA_ST, PRIORITY, SEVERITY, TASK_ST, tone } from '../lib/labels';
import { useTaskPanel } from '../lib/nav';
import { Kanban, matchesSearch, searchNeedle } from './Board';

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>{children}</div>;
}

// ---- 개발: 이 앱의 Claude 담당 기능·잡무 ----

export function DevTab({ app }: { app: AppDto }) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const ctx = useTaskContext();
  const repos = ctx.reposOf(app.code);
  const [repo, setRepo] = useState<'all' | 'none' | number>('all');
  const [q, setQ] = useState('');
  const needle = searchNeedle(q);
  const mine = ctx.list.filter((t) => t.appCode === app.code && t.assignee === 'claude' && t.type !== 'bug');
  const inRepo = mine.filter((t) => repo === 'all' || (repo === 'none' ? !t.repoId : t.repoId === repo));
  const shown = inRepo.filter((t) => matchesSearch(t, needle));
  if (ctx.loading) return <Skeleton rows={5} height={48} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Toolbar>
        <input type="search" className="input" style={{ flex: '1 1 220px', maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="task 검색 (#ID, 제목)" aria-label="task 검색" />
        {needle && (
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {inRepo.length}개 중 {shown.length}개
          </span>
        )}
        {repos.length > 1 && (
          <div role="group" aria-label="저장소" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(
              [
                ['all', '모든 저장소'],
                ...repos.map((r) => [r.id, r.name] as [number, string]),
                ['none', '저장소 없음'],
              ] as Array<['all' | 'none' | number, string]>
            ).map(([k, label]) => (
              <button key={String(k)} type="button" className="chip" aria-pressed={repo === k} onClick={() => setRepo(k)}>
                {label}
                <span className="chip-count">{mine.filter((t) => (k === 'all' ? true : k === 'none' ? !t.repoId : t.repoId === k)).length}</span>
              </button>
            ))}
          </div>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => navigate('/board')}>
            태스크 보드
          </button>
          <button type="button" className="btn btn-primary" onClick={() => dialogs.open({ kind: 'createTask', app: app.code })}>
            task 추가
          </button>
        </span>
      </Toolbar>
      {repos.length > 1 && mine.some((t) => !t.repoId) && (
        <span style={{ fontSize: 13, color: 'var(--attn)' }}>저장소가 정해지지 않은 task는 실행할 수 없어요 · task를 열어 저장소를 고르세요</span>
      )}
      {shown.length ? (
        <Kanban tasks={shown} ctx={ctx} />
      ) : needle ? (
        <Empty text={`"${q.trim()}"에 맞는 task가 없어요 · 제목이나 #ID로 찾아요`} />
      ) : (
        <Empty text="Claude가 할 task가 없어요 · Task Master에서 가져오거나 task를 추가하세요" />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '28px 24px', border: '1px dashed var(--line-strong)', borderRadius: 12, background: 'var(--surface)', fontSize: 14, color: 'var(--text-3)' }}>{text}</div>;
}

// ---- 내 할 일 ----

/** 기한 지남 / 이번 주(7일 안) / 나중 / 완료 */
function todoGroup(t: TaskDto): 'overdue' | 'week' | 'later' | 'done' {
  if (t.status === 'done' || t.status === 'cancelled') return 'done';
  if (!t.dueDate) return 'later';
  const off = dueOffset(t.dueDate);
  return off < 0 ? 'overdue' : off <= 7 ? 'week' : 'later';
}

const TODO_GROUPS: Array<['overdue' | 'week' | 'later' | 'done', string]> = [
  ['overdue', '기한 지남'],
  ['week', '이번 주'],
  ['later', '나중'],
  ['done', '완료'],
];

export function TodoTab({ app }: { app: AppDto }) {
  const ui = useUi();
  const qc = useQueryClient();
  const ctx = useTaskContext();
  const update = useUpdateTask();
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const todos = ctx.list.filter((t) => t.appCode === app.code && t.assignee === 'me');
  const add = useAction(async () => {
    const title = draft.trim();
    if (!title) return;
    await api.post('/api/tasks', { app: app.code, title, assignee: 'me', type: 'chore' });
    setDraft('');
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
  });
  const toggle = useAction(async (t: TaskDto) => {
    const to = t.status === 'done' ? 'todo' : 'done';
    await update(t.id, { status: to });
    if (to === 'done') ui.toast('완료로 바꿨어요', { undo: () => void update(t.id, { status: 'todo' }).catch(ui.fail) });
  });
  const patch = useAction(async (t: TaskDto, p: Record<string, unknown>) => {
    await update(t.id, p);
  });
  const sortKey = (a: TaskDto, b: TaskDto) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.priority ?? 2) - (b.priority ?? 2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 880, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          aria-label="내 할 일 추가"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add.run();
          }}
          placeholder="내가 직접 할 일 · 한 줄로 쓰고 Enter (예: 스토어 심사 서류 준비)"
        />
        <button type="button" className="btn" disabled={!draft.trim() || add.busy} onClick={() => void add.run()}>
          추가
        </button>
      </div>
      <span className="field-hint" style={{ marginTop: -8 }}>
        Claude가 아니라 내가 할 일이에요 · 체크하면 바로 완료되고 리뷰 단계가 없어요 · 기한과 우선순위는 행에서 고쳐요
      </span>
      {ctx.loading && <Skeleton rows={4} height={48} />}
      {TODO_GROUPS.map(([g, label]) => {
        const rows = todos.filter((t) => todoGroup(t) === g).sort(g === 'done' ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) : sortKey);
        if (!rows.length) return null;
        const open = g !== 'done' || showDone;
        return (
          <section key={g} className="card">
            <button
              type="button"
              onClick={() => g === 'done' && setShowDone(!showDone)}
              aria-expanded={open}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '12px 20px', border: 0, background: 'none', color: 'var(--text)', cursor: g === 'done' ? 'pointer' : 'default', textAlign: 'left' }}
            >
              {g === 'done' && <span style={{ width: 12, fontSize: 11, color: 'var(--text-3)' }}>{open ? '▾' : '▸'}</span>}
              <span aria-hidden="true" className="dot" style={{ background: g === 'overdue' ? 'var(--attn-dot)' : g === 'done' ? 'var(--done-dot)' : 'var(--muted-dot)' }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: g === 'overdue' ? 'var(--attn)' : undefined }}>{label}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {rows.length}
              </span>
            </button>
            {open && rows.slice(0, g === 'done' ? 30 : undefined).map((t) => <TodoRow key={t.id} t={t} app={app} busy={toggle.busy || patch.busy} onToggle={() => void toggle.run(t)} onPatch={(p) => void patch.run(t, p)} />)}
          </section>
        );
      })}
      {!ctx.loading && !todos.length && <Empty text="내 할 일이 없어요 · 스토어 심사 제출, 도메인 연결처럼 Claude가 못 하는 일을 적어 두세요" />}
    </div>
  );
}

function TodoRow({ t, app, busy, onToggle, onPatch }: { t: TaskDto; app: AppDto; busy: boolean; onToggle(): void; onPatch(p: Record<string, unknown>): void }) {
  const panel = useTaskPanel();
  const done = t.status === 'done';
  const overdue = !done && !!t.dueDate && dueOffset(t.dueDate) < 0;
  const stage = t.stage ? (app.stages.find((s) => s.key === t.stage)?.name ?? t.stage) : null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', minHeight: 56, padding: '6px 16px 6px 8px', borderTop: '1px solid var(--line-soft)' }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? '완료 해제' : '완료로 표시'}
        onClick={onToggle}
        disabled={busy}
        style={{ width: 44, height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'none', cursor: 'pointer' }}
      >
        <span style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${done ? 'var(--accent)' : 'var(--line-strong)'}`, background: done ? 'var(--accent)' : 'var(--surface)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{done ? '✓' : ''}</span>
      </button>
      <button type="button" onClick={() => panel.open(t.id)} style={{ flex: '1 1 220px', minWidth: 0, padding: 0, border: 0, background: 'none', color: done ? 'var(--text-3)' : 'var(--text)', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45, textDecoration: done ? 'line-through' : undefined }}>{t.title}</span>
        <span style={{ fontSize: 12, color: overdue ? 'var(--attn)' : 'var(--text-3)' }}>
          {dueLabel(t.dueDate)}
          {stage ? ` · ${stage}` : ''}
        </span>
      </button>
      {!done && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <input
            type="date"
            className="input"
            aria-label="기한"
            value={t.dueDate ?? ''}
            onChange={(e) => onPatch({ dueDate: e.target.value || null })}
            style={{ minHeight: 36, padding: '0 8px', fontSize: 12, borderColor: overdue ? 'var(--attn-soft)' : undefined }}
          />
          <Select
            label="우선순위"
            size="sm"
            value={String(t.priority ?? '')}
            onChange={(v) => onPatch({ priority: v ? Number(v) : null })}
            menuWidth={140}
            options={[{ value: '', label: '우선순위 없음' }, ...[1, 2, 3].map((p) => ({ value: String(p), label: PRIORITY[p] }))]}
            style={{ fontSize: 12 }}
          />
        </span>
      )}
    </div>
  );
}

// ---- 버그 ----

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const bugOf = (t: TaskDto) => (t.metadata.bug ?? {}) as { severity?: BugSeverity; env?: string; version?: string };

export function BugsTab({ app }: { app: AppDto }) {
  const dialogs = useDialogs();
  const panel = useTaskPanel();
  const ctx = useTaskContext();
  const [showDone, setShowDone] = useState(false);
  const bugs = ctx.list.filter((t) => t.appCode === app.code && t.type === 'bug');
  const open = bugs.filter((t) => !['done', 'cancelled'].includes(t.status)).sort((a, b) => (SEV_RANK[bugOf(a).severity ?? 'medium'] ?? 2) - (SEV_RANK[bugOf(b).severity ?? 'medium'] ?? 2) || a.createdAt.localeCompare(b.createdAt));
  const closed = bugs.filter((t) => ['done', 'cancelled'].includes(t.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const row = (t: TaskDto) => {
    const b = bugOf(t);
    const sev = tone(SEVERITY, b.severity ?? 'medium');
    const st = tone(TASK_ST, t.status);
    return (
      <div key={t.id} role="button" tabIndex={0} onClick={() => panel.open(t.id)} onKeyDown={(e) => e.key === 'Enter' && panel.open(t.id)} className="row-btn" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', minHeight: 52, padding: '8px 20px', borderTop: '1px solid var(--line-soft)', cursor: 'pointer' }}>
        <span className="pill" style={{ background: sev.bg, color: sev.fg, minWidth: 44, justifyContent: 'center' }}>
          {sev.label}
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
          #{t.id}
        </span>
        <span className="ellipsis" style={{ flex: '1 1 200px', fontSize: 14, fontWeight: 500 }}>
          {t.title}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
          {(b.env || b.version) && <span>{[b.env, b.version].filter(Boolean).join(' · ')}</span>}
          {ctx.repoName(t) && <span className="mono">{ctx.repoName(t)}</span>}
          <span className="pill" style={{ background: st.bg, color: st.fg }}>
            {t.status === 'done' ? '해결됨' : st.label}
          </span>
        </span>
      </div>
    );
  };
  if (ctx.loading) return <Skeleton rows={4} height={48} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960, minWidth: 0 }}>
      <Toolbar>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>심각도순 · 버그를 열어 "실행"을 누르면 Claude가 일반 task처럼 고쳐서 PR까지 만들어요</span>
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => dialogs.open({ kind: 'createTask', app: app.code, type: 'bug' })}>
          버그 등록
        </button>
      </Toolbar>
      <section className="card">
        <div className="card-head">
          <span aria-hidden="true" className="dot" style={{ background: open.some((t) => ['critical', 'high'].includes(bugOf(t).severity ?? '')) ? 'var(--risk)' : 'var(--muted-dot)' }} />
          <h2>열린 버그</h2>
          <span className="mono card-sub">{open.length}</span>
        </div>
        {open.map(row)}
        {!open.length && <div className="card-empty">열린 버그가 없어요</div>}
      </section>
      {closed.length > 0 && (
        <section className="card">
          <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '12px 20px', border: 0, background: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 12, fontSize: 11, color: 'var(--text-3)' }}>{showDone ? '▾' : '▸'}</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>해결됨</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {closed.length}
            </span>
          </button>
          {showDone && closed.map(row)}
        </section>
      )}
    </div>
  );
}

// ---- 기획 ----

export function IdeasTab({ app }: { app: AppDto }) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const ideas = useIdeas({ app: app.code });
  const boot = useRuns({ kind: 'bootstrap', app: app.code, limit: 1 });
  const originId = boot.data?.[0]?.result.bootstrap?.ideaId;
  const list = (ideas.data ?? []).filter((i) => i.id !== originId).sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
  const origin = (ideas.data ?? []).find((i) => i.id === originId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960, minWidth: 0 }}>
      <Toolbar>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>이 앱의 기획만 모았어요 · 읽고 승인하는 곳은 기획 인박스예요</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => navigate('/ideas')}>
            기획 인박스
          </button>
          <button type="button" className="btn btn-primary" onClick={() => dialogs.open({ kind: 'gen', app: app.code })}>
            기획 지금 생성
          </button>
        </span>
      </Toolbar>
      {originId && (
        <button type="button" onClick={() => navigate(`/ideas?idea=${originId}`)} className="list-item" style={{ textAlign: 'left', padding: '16px 18px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>이 앱을 만든 기획</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>새 앱 기획 #{originId} {origin?.title ?? ''}</span>
          <span style={{ fontSize: 13, color: 'var(--accent)' }}>기획 보기 →</span>
        </button>
      )}
      <section className="card">
        {ideas.isLoading && <Skeleton rows={3} height={44} />}
        {list.map((i) => {
          const st = tone(IDEA_ST, i.status);
          return (
            <button key={i.id} type="button" onClick={() => navigate(`/ideas?idea=${i.id}`)} className="row-btn" style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', minHeight: 56, padding: '10px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
              <CodeBox code={app.code} small />
              <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
                  {i.title}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  기획 #{i.id} · v{i.currentVersion} · {when(i.createdAt)} 생성
                </span>
              </span>
              <span className="pill" style={{ marginLeft: 'auto', background: st.bg, color: st.fg }}>
                {st.label}
              </span>
            </button>
          );
        })}
        {!ideas.isLoading && !list.length && <div className="card-empty" style={{ borderTop: 0 }}>이 앱의 기획이 아직 없어요 · 앱 설정에서 자동 생성 주기를 정하거나 지금 생성하세요</div>}
      </section>
    </div>
  );
}

