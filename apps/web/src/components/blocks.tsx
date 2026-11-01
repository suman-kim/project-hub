import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityActor, ActivityDto, TaskDto } from '@hub/shared';
import type { BgSessionView } from '../api/queries';
import { dueLabel, dueOffset, stamp } from '../lib/format';
import { ACTOR, PRIORITY, SESSION_ST, tone } from '../lib/labels';
import { useTaskPanel } from '../lib/nav';
import { usePrefs } from '../lib/prefs';

/** 숫자 칸. hot이면 색을 입힌다 */
export function StatCard({
  label,
  n,
  sub,
  hot,
  mono,
  onClick,
}: {
  label: string;
  n: ReactNode;
  sub: ReactNode;
  hot?: 'attn' | 'risk' | 'attnLine' | null;
  mono?: boolean;
  onClick?: () => void;
}) {
  const { m } = usePrefs();
  const c =
    hot === 'attn'
      ? { bg: 'var(--attn-card)', bd: 'var(--attn-line)', lfg: 'var(--attn)', nfg: 'var(--attn)', sfg: 'var(--attn-deep)' }
      : hot === 'risk'
        ? { bg: 'var(--risk-bg)', bd: 'var(--risk-line)', lfg: 'var(--risk)', nfg: 'var(--risk)', sfg: 'var(--risk)' }
        : hot === 'attnLine'
          ? { bg: 'var(--surface)', bd: 'var(--attn-line)', lfg: 'var(--text-3)', nfg: 'var(--text)', sfg: 'var(--attn)' }
          : { bg: 'var(--surface)', bd: 'var(--line)', lfg: 'var(--text-3)', nfg: 'var(--text)', sfg: 'var(--text-3)' };
  return (
    <button
      type="button"
      onClick={onClick}
      className="stat-card"
      style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 12, padding: m ? '14px 16px' : '18px 20px', display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--text)', minWidth: 0 }}
    >
      <span style={{ fontSize: 13, color: c.lfg }}>{label}</span>
      <span style={{ fontSize: m ? 26 : 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15, color: c.nfg }}>{n}</span>
      <span className="ellipsis" style={{ fontSize: 12, color: c.sfg, fontFamily: mono ? 'var(--mono)' : 'inherit', maxWidth: '100%' }}>
        {sub}
      </span>
    </button>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  const { m } = usePrefs();
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${m ? 140 : 200}px, 1fr))`, gap: m ? 10 : 16 }}>{children}</div>;
}

/** claude agents --json의 상태 → 화면 상태 */
export function sessionState(s: Pick<BgSessionView, 'status' | 'pending'>): keyof typeof SESSION_ST {
  if (s.status === 'waiting') return s.pending ? 'permission' : 'input';
  if (s.status === 'running' || s.status === 'busy' || s.status === 'idle') return 'running';
  if (s.status === 'stopped' || s.status === 'exited' || s.status === 'done') return 'ended';
  return 'unknown';
}

export function sessionReason(s: BgSessionView): string {
  const st = sessionState(s);
  if (st === 'permission' && s.pending) return `허락을 기다려요 · ${s.pending.tool} ${s.pending.cmd}`;
  if (st === 'input') return s.waitingFor ? `입력을 기다려요 · ${s.waitingFor}` : '입력을 기다려요';
  if (st === 'unknown') return '세션 상태를 읽지 못했어요';
  return '진행 중이에요';
}

/** 앱 개요의 새 앱 세션 카드 */
export function SessionCard({ s, appCode }: { s: BgSessionView; appCode: string }) {
  const navigate = useNavigate();
  const st = sessionState(s);
  const t = tone(SESSION_ST, st);
  const perm = st === 'permission';
  return (
    <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '16px 20px', borderRadius: 12, background: perm ? 'var(--attn-card)' : 'var(--surface)', border: `1px solid ${perm ? 'var(--attn-line)' : 'var(--line)'}` }}>
      <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>새 앱 세션 · Hub 밖에서 도는 원격 조종 세션</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{s.name ?? s.id}</span>
          <span className="pill" style={{ background: t.bg, color: t.fg }}>
            {t.label}
          </span>
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{sessionReason(s)}</span>
      </div>
      <div className="row-actions">
        {s.remoteLink && (
          <a href={s.remoteLink} target="_blank" rel="noreferrer" className="link" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>
            원격 조종 열기 ↗
          </a>
        )}
        <button type="button" className="btn btn-sm" onClick={() => navigate(`/sessions/${appCode}/${s.id}`)}>
          Hub에서 보기
        </button>
      </div>
    </section>
  );
}

export const ACTOR_FG: Record<ActivityActor, string> = { me: 'var(--accent-ink)', claude: 'var(--check)', hub: 'var(--text-2)', github: 'var(--done)' };

/** 히스토리 줄을 누르면 연결된 것으로 간다 */
export function useActivityNav(appCode: string | null) {
  const navigate = useNavigate();
  const panel = useTaskPanel();
  return (a: ActivityDto): (() => void) | undefined => {
    if (!a.refType || !a.refId) return undefined;
    if (a.refType === 'task') return () => panel.open(a.refId!);
    if (a.refType === 'run') return () => navigate(`/runs/${a.refId}`);
    if (a.refType === 'idea') return () => navigate(`/ideas?idea=${a.refId}`);
    if (a.refType === 'deployment' && appCode) return () => navigate(`/apps/${appCode}/stage`);
    if (a.refType === 'repo' && appCode) return () => navigate(`/apps/${appCode}/settings`);
    return undefined;
  };
}

export function ActivityRow({ a, onClick, style }: { a: ActivityDto; onClick?: () => void; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="activity-row"
      style={{ width: '100%', display: 'grid', gridTemplateColumns: 'auto auto minmax(0,1fr)', gap: '4px 12px', alignItems: 'baseline', minHeight: 44, padding: '10px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: onClick ? 'pointer' : 'default', ...style }}
    >
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
        {stamp(a.at)}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: ACTOR_FG[a.actor], whiteSpace: 'nowrap' }}>{ACTOR[a.actor]}</span>
      <span style={{ fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{a.summary}</span>
    </button>
  );
}

/** 체크하면 바로 완료되는 내 할 일 한 줄 */
export function TodoCheckRow({ t, onToggle, busy }: { t: TaskDto; onToggle(): void; busy?: boolean }) {
  const panel = useTaskPanel();
  const done = t.status === 'done';
  const overdue = !done && !!t.dueDate && dueOffset(t.dueDate) < 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 56, padding: '6px 20px 6px 8px', borderTop: '1px solid var(--line-soft)' }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? '완료 해제' : '완료로 표시'}
        onClick={onToggle}
        disabled={busy}
        style={{ width: 44, height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'none', cursor: 'pointer' }}
      >
        <span
          style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${done ? 'var(--accent)' : 'var(--line-strong)'}`, background: done ? 'var(--accent)' : 'var(--surface)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}
        >
          {done ? '✓' : ''}
        </span>
      </button>
      <button type="button" onClick={() => panel.open(t.id)} style={{ flex: 1, minWidth: 0, padding: 0, border: 0, background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45, textDecoration: done ? 'line-through' : undefined, color: done ? 'var(--text-3)' : undefined }}>{t.title}</span>
        <span style={{ fontSize: 12, color: overdue ? 'var(--attn)' : 'var(--text-3)' }}>
          {dueLabel(t.dueDate)} · 우선순위 {PRIORITY[t.priority ?? 2]}
        </span>
      </button>
    </div>
  );
}
