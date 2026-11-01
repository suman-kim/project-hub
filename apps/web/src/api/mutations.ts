import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppDto, RunDto, RunListItemDto, TaskDto } from '@hub/shared';
import { useUi } from '../components/ui';
import { api } from './client';
import { keys } from './queries';

/** 버튼 하나의 비동기 동작: 도는 동안 busy, 실패하면 토스트 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const run = async (...args: A): Promise<R | undefined> => {
    setBusy(true);
    try {
      return await fn(...args);
    } catch (e) {
      ui.fail(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/** 앱 설정을 바꾸고 목록·상태·개요를 맞춘다 (WebSocket app.updated로도 다시 읽는다) */
export function useUpdateApp() {
  const qc = useQueryClient();
  return async (id: number, patch: Partial<AppDto>): Promise<AppDto> => {
    const app = await api.patch<AppDto>(`/api/apps/${id}`, patch);
    qc.setQueryData<AppDto[]>(keys.apps, (list) => list?.map((a) => (a.id === id ? app : a)));
    void qc.invalidateQueries({ queryKey: keys.appStatus });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: ['activities'] });
    return app;
  };
}

/** task 상태·필드 바꾸기. 서버가 허용하지 않는 전이는 409로 돌아온다 */
export function useUpdateTask() {
  const qc = useQueryClient();
  return async (id: string, patch: Record<string, unknown>): Promise<TaskDto> => {
    const task = await api.patch<TaskDto>(`/api/tasks/${id}`, patch);
    qc.setQueryData(keys.task(task.id), task);
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: keys.appStatus });
    return task;
  };
}

/** task 실행: worktree를 만들고 시작한다. 막힌 이유는 서버가 409로 알려 준다 */
export function useStartRun() {
  const qc = useQueryClient();
  const ui = useUi();
  return async (taskId: string): Promise<RunDto> => {
    const run = await api.post<RunDto>(`/api/tasks/${taskId}/run`);
    void qc.invalidateQueries({ queryKey: ['runs'] });
    void qc.invalidateQueries({ queryKey: ['taskRuns', taskId] });
    ui.toast(`#${taskId} 실행을 시작했어요 · run ${run.id}`);
    return run;
  };
}

/** run에 답하면 같은 세션으로 이어서 실행한다 */
export function useAnswerRun() {
  const qc = useQueryClient();
  return async (runId: number, answer: string): Promise<RunDto> => {
    const run = await api.post<RunDto>(`/api/runs/${runId}/answer`, { answer });
    void qc.invalidateQueries({ queryKey: ['runs'] });
    void qc.invalidateQueries({ queryKey: keys.run(runId) });
    return run;
  };
}

export function useStopRun() {
  const qc = useQueryClient();
  const ui = useUi();
  return async (runId: number): Promise<boolean> => {
    if (!(await ui.confirm({ title: `run ${runId}를 중지할까요?`, body: '돌고 있는 claude를 멈추고 run을 중지로 끝내요. task는 그대로 두니 다시 실행할 수 있어요.', label: '중지' }))) return false;
    await api.post(`/api/runs/${runId}/stop`);
    void qc.invalidateQueries({ queryKey: ['runs'] });
    void qc.invalidateQueries({ queryKey: keys.run(runId) });
    ui.toast(`run ${runId}를 중지했어요`);
    return true;
  };
}

/** 실패·중지된 run을 같은 방식으로 다시 돌린다. task run은 task를, 기획·시작 run은 그 생성을 다시 한다 */
export function useRerun() {
  const qc = useQueryClient();
  const ui = useUi();
  const startRun = useStartRun();
  return async (r: RunDto | RunListItemDto): Promise<RunDto> => {
    // 세션 이어서 하기는 같은 세션에 같은 메시지로 다시 이어 받는다.
    if (r.kind === 'session' && r.result.session) {
      const next = await api.post<RunDto>(`/api/sessions/${r.result.session.sessionId}/resume`, { message: r.result.session.message, taskId: r.taskId });
      void qc.invalidateQueries({ queryKey: ['runs'] });
      ui.toast(`다시 실행했어요 · run ${next.id}`);
      return next;
    }
    if (r.taskId) return startRun(r.taskId);
    let next: RunDto;
    const idea = r.result.idea;
    if (r.kind === 'bootstrap' && r.result.bootstrap) next = await api.post<RunDto>(`/api/apps/${r.result.bootstrap.appId}/bootstrap`);
    else if (idea?.ideaId && idea.note) next = await api.post<RunDto>(`/api/ideas/${idea.ideaId}/revise`, { note: idea.note });
    else if (idea?.kind === 'app') next = await api.post<RunDto>('/api/concepts/generate', idea.note ? { note: idea.note } : {});
    else if (idea?.appId) next = await api.post<RunDto>(`/api/apps/${idea.appId}/ideas/generate`);
    else throw new Error('다시 실행할 방법을 모르는 run이에요');
    void qc.invalidateQueries({ queryKey: ['runs'] });
    ui.toast(`다시 실행했어요 · run ${next.id}`);
    return next;
  };
}
