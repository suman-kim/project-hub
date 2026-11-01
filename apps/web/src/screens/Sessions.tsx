import { useApps, useAllSessions } from '../api/queries';
import { AppFilter } from '../components/AppFilter';
import { ErrorBox, Skeleton } from '../components/ui';
import { usePrefs } from '../lib/prefs';
import { SessionHint, SessionList } from './AppSessions';

/** 세션 메뉴: 모든 프로젝트의 Claude 세션. 앱 칩을 누르면 그 프로젝트 세션만 */
export function Sessions() {
  const { appFilter } = usePrefs();
  const apps = useApps();
  const all = useAllSessions();
  const list = (all.data ?? []).filter((s) => appFilter === 'all' || s.appCode === appFilter);
  // 앱 칩 숫자는 열린 세션 수. 앱이 없는 세션(키 '')도 "전체" 합계에는 들어간다.
  const counts: Record<string, number> = {};
  for (const s of all.data ?? []) if (s.open) counts[s.appCode ?? ''] = (counts[s.appCode ?? ''] ?? 0) + 1;
  const open = list.filter((s) => s.open).length;
  const appName = appFilter === 'all' ? null : (apps.data?.find((a) => a.code === appFilter)?.name ?? appFilter);

  return (
    <div data-screen-label="세션" className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="page-sub">
          {appName ? `${appName}의 Claude 세션` : '모든 프로젝트의 Claude 세션'} · 열린 세션 {open}개 · 최근 7일
        </span>
        <h1 className="page-title">세션</h1>
      </div>
      <AppFilter counts={counts} />
      <SessionHint />
      {all.isLoading && <Skeleton rows={5} height={64} />}
      {all.error && <ErrorBox error={all.error} onRetry={() => void all.refetch()} />}
      {all.data && <SessionList sessions={list} appOf={(code) => apps.data?.find((a) => a.code === code)} showApp />}
    </div>
  );
}
