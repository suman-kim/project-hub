import type { AppStatusDto, DeployEnv, DeployStatus, IdeaDto, MyDocDto, MyTodoDto, RunListItemDto, TaskDto } from '@hub/shared';
import { dueOffset } from '../lib/format';
import { docAlerts, overdueMine, useMine } from '../lib/mine';
import { usePrefs } from '../lib/prefs';
import { useAppStatus, useApps, useIdeas, useRuns, useTasks } from './queries';

/** task가 없는 실패(기획 생성, 새 앱 시작)는 다시 실행할 곳이 없어 이 기간만 오늘에 남긴다 */
const LOOSE_FAILURE_DAYS = 7;

export interface WaitingSession {
  appCode: string;
  id: string;
  name: string;
  waitingFor: string | null;
}

export interface DeployFailure {
  appCode: string;
  repoName: string | null;
  env: DeployEnv;
  status: DeployStatus;
  version: string | null;
  at: string | null;
}

/** 처리할 일: 답변 대기 → 허락 대기 세션 → 운영 배포 실패 → 실패한 run → 리뷰 대기 → 기한 지난 내 할 일(내 업무 포함) → 만료·갱신 예정 → 대기 중 기획. 실행 중은 따로 센다 */
export interface Inbox {
  /** 운영·스토어의 가장 최근 배포가 실패한 것 */
  deployFailures: DeployFailure[];
  /** 기한이 지난 내 할 일 */
  overdue: TaskDto[];
  /** 기한이 지난 내 업무 할 일 (앱 필터가 전체일 때만) */
  mineOverdue: MyTodoDto[];
  /** 14일 안에 만료·갱신되는 보관함 문서. 공통 문서는 앱 필터가 전체일 때만, 앱 전용 문서는 그 앱이 보일 때 */
  mineAlerts: MyDocDto[];
  /** 사이드바 내 업무 배지: 앱 필터와 상관없이 공통 보관함의 만료 임박 문서 + 기한 지난 할 일 (앱 전용 문서는 앱 페이지에 있어 세지 않는다) */
  mineBadge: number;
  input: RunListItemDto[];
  sessions: WaitingSession[];
  failed: RunListItemDto[];
  review: TaskDto[];
  ideas: IdeaDto[];
  running: RunListItemDto[];
  /** 앱 필터와 상관없이 실행 중인 run 수 (실행 기록 메뉴 배지) */
  runningAll: number;
  todoCount: number;
  loading: boolean;
}

/** 오늘 화면과 사이드바 배지가 같이 쓴다. 앱 필터가 걸려 있으면 그 앱 것만 센다 */
export function useInbox(): Inbox {
  const { appFilter } = usePrefs();
  const runs = useRuns({ status: ['queued', 'running', 'input', 'failed'], latest: true, limit: 200 });
  const review = useTasks({ status: ['review'] });
  const ideas = useIdeas({ status: ['pending'] });
  const status = useAppStatus();
  const todos = useTasks({ assignee: 'me', status: ['todo', 'doing'] });
  const mine = useMine();
  const apps = useApps();

  const okApp = (code: string | null) => appFilter === 'all' || code === appFilter;
  const all = runs.data ?? [];
  const now = Date.now();
  const input = all.filter((r) => r.status === 'input' && okApp(r.appCode));
  const failed = all.filter(
    (r) =>
      r.status === 'failed' &&
      !r.resolvedBy &&
      okApp(r.appCode) &&
      (r.taskId
        ? !['done', 'cancelled', 'review'].includes(r.taskStatus ?? '')
        : now - new Date(r.endedAt ?? r.createdAt).getTime() < LOOSE_FAILURE_DAYS * 86_400_000),
  );
  const running = all.filter((r) => (r.status === 'running' || r.status === 'queued') && okApp(r.appCode));
  const sessions = waitingSessions(status.data ?? []).filter((s) => okApp(s.appCode));
  const reviewTasks = (review.data ?? []).filter((t) => okApp(t.appCode));
  // 새 앱 기획은 앱이 없으므로 전체를 볼 때만 센다.
  const pendingIdeas = (ideas.data ?? []).filter((i) => (i.kind === 'app' ? appFilter === 'all' : okApp(i.appCode)));

  const deployFailures = (status.data ?? [])
    .flatMap((a) => a.signals.deploy.filter((d) => d.status === 'failure' && (d.env === 'production' || d.env === 'store')).map((d) => ({ appCode: a.code, ...d })))
    .filter((d) => okApp(d.appCode));
  const overdue = (todos.data ?? []).filter((t) => okApp(t.appCode) && !!t.dueDate && dueOffset(t.dueDate) < 0).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  // 내 업무는 어느 앱에도 묶이지 않아서 전체를 볼 때만 처리할 일에 넣는다.
  const allMineOverdue = overdueMine(mine.data?.todos ?? []);
  const allMineAlerts = docAlerts(mine.data?.docs ?? []);
  const codeOf = new Map((apps.data ?? []).map((a) => [a.id, a.code]));
  const mineOverdue = appFilter === 'all' ? allMineOverdue : [];
  // 앱 전용 보관함 문서는 그 앱 것으로 걸러 보인다
  const mineAlerts = allMineAlerts.filter((d) => (d.appId === null ? appFilter === 'all' : okApp(codeOf.get(d.appId) ?? null)));

  return {
    deployFailures,
    overdue,
    mineOverdue,
    mineAlerts,
    mineBadge: allMineOverdue.length + allMineAlerts.filter((d) => d.appId === null).length,
    input,
    sessions,
    failed,
    review: reviewTasks,
    ideas: pendingIdeas,
    running,
    runningAll: all.filter((r) => r.status === 'running').length,
    todoCount: deployFailures.length + overdue.length + mineOverdue.length + mineAlerts.length + input.length + sessions.length + failed.length + reviewTasks.length + pendingIdeas.length,
    loading: runs.isLoading || review.isLoading || ideas.isLoading,
  };
}

function waitingSessions(list: AppStatusDto[]): WaitingSession[] {
  return list.flatMap((a) => a.signals.blocked.waitingSessions.map((s) => ({ appCode: a.code, ...s })));
}
