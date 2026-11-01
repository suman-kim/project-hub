import type { AppDot, AppLifecycle, AppSignals } from '@hub/shared';

export const QUIET_DAYS = 14;

/** 가장 급한 신호 하나로 사이드바 점 색을 정한다 */
export function dotOf(s: Omit<AppSignals, 'dot' | 'nudge'>, lifecycle: AppLifecycle): AppDot {
  const deployFailed = s.deploy.some((d) => (d.env === 'production' || d.env === 'store') && d.status === 'failure');
  if (deployFailed || s.bugs.critical > 0) return 'risk';
  if (s.blocked.waitingRuns || s.blocked.failedRuns || s.blocked.waitingSessions.length) return 'attn';
  if (s.running) return 'prog';
  if (lifecycle === 'paused' || lifecycle === 'archived' || (s.activity.quietDays ?? 0) >= QUIET_DAYS) return 'quiet';
  return 'ok';
}

export function nudgeOf(lifecycle: AppLifecycle, quietDays: number | null): string | null {
  if (lifecycle !== 'developing' || quietDays === null || quietDays < QUIET_DAYS) return null;
  return `${quietDays}일째 조용해요. 계속할까요, 멈춤으로 둘까요?`;
}

export function quietDaysOf(lastAt: Date | null, now = Date.now()): number | null {
  return lastAt ? Math.floor((now - lastAt.getTime()) / 86_400_000) : null;
}
