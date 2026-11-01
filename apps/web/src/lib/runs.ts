import type { RunDto, RunListItemDto } from '@hub/shared';
import { FAILURE } from './labels';

type AnyRun = RunDto & Partial<Pick<RunListItemDto, 'appCode' | 'taskTitle'>>;

/** 구현 · 기능 기획 · 새 앱 기획 · 새 앱 시작 */
export function runKindLabel(r: RunDto): string {
  if (r.kind === 'implement') return '구현';
  if (r.kind === 'bootstrap') return '새 앱 시작';
  if (r.kind === 'session') return '세션 이어서';
  return r.result.idea?.kind === 'app' ? '새 앱 기획' : '기능 기획';
}

/** 목록에 보여 줄 run 제목 */
export function runTitle(r: AnyRun, appName?: (code: string) => string): string {
  // 앱은 옆의 프로젝트 배지(CodeBox)가 이름으로 보여 주므로 제목에는 넣지 않는다.
  void appName;
  if (r.taskId) return `#${r.taskId} ${r.taskTitle ?? ''}`.trim();
  if (r.kind === 'bootstrap') return '새 앱 시작';
  const idea = r.result.idea;
  if (idea?.kind === 'app') return idea.seed ? `새 앱 기획 · ${idea.seed.title}` : idea.ideaId ? '새 앱 기획 수정' : '새 앱 기획 생성';
  return idea?.ideaId ? '기획 수정' : '기획 생성';
}

/** 실패 사유 이름 (result.failure) */
export function failureLabel(r: RunDto): string {
  return (r.result.failure && FAILURE[r.result.failure]) || (r.status === 'stopped' ? '중지' : '실패');
}

export function runStart(r: RunDto): string {
  return r.startedAt ?? r.createdAt;
}
