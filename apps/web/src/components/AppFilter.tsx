import { useApps } from '../api/queries';
import { usePrefs } from '../lib/prefs';

/** 오늘·보드·기획·실행 화면 위쪽의 앱 필터. counts가 있으면 칩 옆에 개수를 붙인다 */
export function AppFilter({ counts }: { counts?: Record<string, number> }) {
  const apps = useApps();
  const { appFilter, setAppFilter } = usePrefs();
  const live = (apps.data ?? []).filter((a) => a.lifecycle !== 'archived' || a.code === appFilter);
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const chips = [{ key: 'all', label: '전체', count: total }, ...live.map((a) => ({ key: a.code, label: a.name, count: counts ? (counts[a.code] ?? 0) : undefined }))];
  return (
    <div role="group" aria-label="앱 필터" style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', margin: '0 -2px -8px', padding: '0 2px 2px' }}>
      <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>앱</span>
      {chips.map((c) => (
        <button key={c.key} type="button" className="chip" aria-pressed={appFilter === c.key} onClick={() => setAppFilter(c.key)}>
          {c.label}
          {c.count !== undefined && <span className="chip-count">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}
