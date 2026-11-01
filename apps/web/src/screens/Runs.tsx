import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunListItemDto, RunStatus } from '@hub/shared';
import { useApps, useRuns } from '../api/queries';
import { AppFilter } from '../components/AppFilter';
import { CodeBox, ErrorBox, Skeleton } from '../components/ui';
import { clock, dur, hm, money, since, stamp } from '../lib/format';
import { RUN_ST, tone } from '../lib/labels';
import { usePrefs } from '../lib/prefs';
import { runKindLabel, runStart, runTitle } from '../lib/runs';
import { useNow } from '../lib/useNow';

const STATUS_CHIPS: Array<['all' | RunStatus, string]> = [
  ['all', '전체'],
  ['running', '실행 중'],
  ['input', '답변 대기'],
  ['failed', '실패'],
  ['done', '완료'],
  ['stopped', '중지'],
];
const KINDS = ['구현', '세션 이어서', '기능 기획', '새 앱 기획', '새 앱 시작'];

function Chip({ on, label, count, onClick, small }: { on: boolean; label: string; count: number; onClick(): void; small?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="chip"
      style={small ? { minHeight: 36, padding: '0 12px', fontSize: 12 } : undefined}
    >
      {label}
      <span className="chip-count">{count}</span>
    </button>
  );
}

/** implement·idea_gen·bootstrap run을 한곳에서 최근 것부터 */
export function Runs() {
  const navigate = useNavigate();
  const { appFilter } = usePrefs();
  const apps = useApps();
  const runs = useRuns({ app: appFilter === 'all' ? undefined : appFilter, limit: 300 });
  const [status, setStatus] = useState<'all' | RunStatus>('all');
  const [kind, setKind] = useState('all');
  const now = useNow();
  const appName = (code: string) => apps.data?.find((a) => a.code === code)?.name ?? code;
  const all = runs.data ?? [];
  // 다시 실행해서 완료된 실패·중지는 실패·중지 목록에서 뺀다(전체에는 남긴다).
  const inStatus = (r: RunListItemDto, k: 'all' | RunStatus) => k === 'all' || (r.status === k && !r.resolvedBy);
  const rows = all.filter((r) => inStatus(r, status) && (kind === 'all' || runKindLabel(r) === kind));

  return (
    <div data-screen-label="실행 기록" className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="page-sub">Hub가 돌린 run의 지난 기록을 찾아보는 곳이에요 · 지금 열린 Claude 세션은 세션 메뉴에서 봐요</span>
        <h1 className="page-title">실행 기록</h1>
      </div>
      <AppFilter />
      <div role="group" aria-label="상태 필터" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {STATUS_CHIPS.map(([k, label]) => (
          <Chip key={k} on={status === k} label={label} count={all.filter((r) => inStatus(r, k)).length} onClick={() => setStatus(k)} />
        ))}
      </div>
      <div role="group" aria-label="종류 필터" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginTop: -8 }}>
        {['all', ...KINDS].map((k) => (
          <Chip key={k} small on={kind === k} label={k === 'all' ? '모든 종류' : k} count={k === 'all' ? all.length : all.filter((r) => runKindLabel(r) === k).length} onClick={() => setKind(k)} />
        ))}
      </div>
      {runs.error && <ErrorBox error={runs.error} onRetry={() => void runs.refetch()} />}
      <section className="card">
        {runs.isLoading && <Skeleton rows={8} height={40} />}
        {rows.map((r) => {
          const st = tone(RUN_ST, r.status);
          const start = runStart(r);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => navigate(`/runs/${r.id}`)}
              className="row-btn"
              style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', minHeight: 60, padding: '10px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
            >
              <CodeBox code={r.appCode ?? '새 앱'} />
              <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
                  {runTitle(r, appName)}
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  run {r.id} · {r.kind} · {runKindLabel(r)}
                  {r.resolvedBy ? ` · 다시 실행해 완료 (run ${r.resolvedBy})` : ''}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>
                <span className="mono" style={{ color: 'var(--text-3)' }}>
                  {stamp(start) || hm(start)} · {r.endedAt ? dur((new Date(r.endedAt).getTime() - new Date(start).getTime()) / 1000) : clock(since(start, now))} · {money(r.costUsd)}
                </span>
                <span className="pill" style={{ padding: '4px 10px', background: st.bg, color: st.fg }}>
                  {st.label}
                </span>
              </span>
            </button>
          );
        })}
        {!runs.isLoading && !rows.length && <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--text-3)', textAlign: 'center' }}>이 조건의 run이 없어요</div>}
      </section>
    </div>
  );
}
