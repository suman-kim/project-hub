import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { AppRepoDto, RunListItemDto, TaskDto, TaskStatus } from '@hub/shared';
import { canTransitionTask } from '@hub/shared';
import { api } from './client';
import { keys, useApps, useRuns, useTasks } from './queries';

const ACTIVE = ['queued', 'running', 'input'];

/**
 * 보드·오늘·task 상세가 함께 쓰는 판단 재료: 모든 task, task마다 가장 최근 run, 앱마다 저장소.
 * 서버가 거부할 동작(실행, 상태 전이)을 화면에서 미리 막는 데 쓴다.
 */
export function useTaskContext() {
  const tasks = useTasks();
  const runs = useRuns({ kind: 'implement', latest: true, limit: 500 });
  const apps = useApps();
  const repoLists = useQueries({
    queries: (apps.data ?? []).map((a) => ({ queryKey: keys.repos(a.id), queryFn: () => api.get<AppRepoDto[]>(`/api/apps/${a.id}/repos`) })),
    combine: (results) => results.map((r) => r.data),
  });

  return useMemo(() => {
    const byId = new Map<string, TaskDto>((tasks.data ?? []).map((t) => [t.id, t]));
    const lastRun = new Map<string, RunListItemDto>();
    for (const r of runs.data ?? []) if (r.taskId && !lastRun.has(r.taskId)) lastRun.set(r.taskId, r);
    const reposOf = new Map<string, AppRepoDto[]>();
    (apps.data ?? []).forEach((a, i) => reposOf.set(a.code, repoLists[i] ?? []));
    const appOf = new Map((apps.data ?? []).map((a) => [a.code, a]));

    const activeRun = (id: string) => {
      const r = lastRun.get(id);
      return r && ACTIVE.includes(r.status) ? r : null;
    };
    /** 완료되지 않은 선행 task. 목록에 없는 ID는 지워진 것이라 막지 않는다 */
    const blockers = (t: TaskDto) => t.dependsOn.filter((d) => byId.has(d) && byId.get(d)!.status !== 'done');
    const hasRepo = (code: string) => !!appOf.get(code)?.repoPath || (reposOf.get(code)?.length ?? 0) > 0;

    /** 실행할 수 없으면 그 이유. 실행할 수 있으면 null */
    const runBlock = (t: TaskDto): string | null => {
      if (t.assignee === 'me') return '내 할 일은 실행하지 않아요';
      if (!['todo', 'doing', 'input'].includes(t.status)) return `${t.status === 'review' ? '리뷰' : t.status === 'done' ? '완료' : '취소'} 상태에서는 실행할 수 없어요`;
      if (activeRun(t.id)) return '이미 실행 중인 run이 있어요';
      if (!hasRepo(t.appCode)) return '저장소 경로를 설정하세요';
      if ((reposOf.get(t.appCode)?.length ?? 0) > 1 && !t.repoId) return '저장소를 먼저 고르세요';
      return null;
    };

    return {
      loading: tasks.isLoading,
      error: tasks.error,
      refetch: tasks.refetch,
      list: tasks.data ?? [],
      byId,
      lastRun,
      activeRun,
      blockers,
      runBlock,
      reposOf: (code: string) => reposOf.get(code) ?? [],
      repoName: (t: TaskDto) => (t.repoId ? reposOf.get(t.appCode)?.find((r) => r.id === t.repoId)?.name ?? null : null),
    };
  }, [tasks.data, tasks.isLoading, tasks.error, tasks.refetch, runs.data, apps.data, repoLists]);
}

/** 상세 패널의 상태 버튼. input(답변 대기)은 run이 정하므로 화면에서 고르지 않는다 */
export function transitionTargets(t: TaskDto): Array<{ to: TaskStatus; ok: boolean }> {
  const all: TaskStatus[] = t.assignee === 'me' ? ['todo', 'doing', 'done', 'cancelled'] : ['todo', 'doing', 'review', 'done', 'cancelled'];
  return all.filter((s) => s !== t.status).map((to) => ({ to, ok: canTransitionTask(t.status, to, t.assignee) }));
}
