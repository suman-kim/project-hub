import type {
  ActivityActor,
  AppDot,
  AppLifecycle,
  BugSeverity,
  DeployEnv,
  DeploySource,
  DeployStatus,
  IdeaStatus,
  RunKind,
  RunStatus,
  TaskAssignee,
  TaskStatus,
  TaskType,
} from '@hub/shared';

/** 상태 색. 색은 상태를 알리는 데만 쓴다 */
export type Tone = 'muted' | 'attn' | 'prog' | 'check' | 'risk' | 'done';

export const TONE: Record<Tone, { fg: string; bg: string; dot: string }> = {
  muted: { fg: 'var(--text-2)', bg: 'var(--muted-bg)', dot: 'var(--muted-dot)' },
  attn: { fg: 'var(--attn)', bg: 'var(--attn-bg)', dot: 'var(--attn-dot)' },
  prog: { fg: 'var(--prog)', bg: 'var(--prog-bg)', dot: 'var(--prog-dot)' },
  check: { fg: 'var(--check)', bg: 'var(--check-bg)', dot: 'var(--check-dot)' },
  risk: { fg: 'var(--risk)', bg: 'var(--risk-bg)', dot: 'var(--risk)' },
  done: { fg: 'var(--done)', bg: 'var(--done-bg)', dot: 'var(--done-dot)' },
};

type Labeled<K extends string> = Record<K, [label: string, tone: Tone]>;

export const TASK_ST: Labeled<TaskStatus> = {
  todo: ['할 일', 'muted'],
  doing: ['진행 중', 'prog'],
  input: ['답변 대기', 'attn'],
  review: ['리뷰', 'check'],
  done: ['완료', 'done'],
  cancelled: ['취소', 'muted'],
};

export const RUN_ST: Labeled<RunStatus> = {
  queued: ['대기', 'muted'],
  running: ['실행 중', 'prog'],
  input: ['답변 대기', 'attn'],
  done: ['완료', 'done'],
  stopped: ['중지', 'muted'],
  failed: ['실패', 'risk'],
};

export const IDEA_ST: Labeled<IdeaStatus> = {
  pending: ['검토 대기', 'check'],
  revising: ['수정 중', 'prog'],
  approved: ['승인', 'done'],
  rejected: ['반려', 'muted'],
};

export const LIFE: Labeled<AppLifecycle> = {
  developing: ['개발 중', 'prog'],
  operating: ['운영 중', 'done'],
  paused: ['멈춤', 'muted'],
  archived: ['보관', 'muted'],
};

export const LIFE_HINT: Record<AppLifecycle, string> = {
  developing: '만드는 중',
  operating: '출시해서 운영 중',
  paused: '잠시 손 놓음',
  archived: '사이드바 아래로 접어 둠',
};

export const DEPLOY_ST: Labeled<DeployStatus> = {
  queued: ['대기', 'muted'],
  in_progress: ['진행 중', 'prog'],
  success: ['성공', 'done'],
  failure: ['실패', 'risk'],
  cancelled: ['취소', 'muted'],
  inactive: ['교체됨', 'muted'],
};

export const SEVERITY: Labeled<BugSeverity> = {
  critical: ['치명', 'risk'],
  high: ['높음', 'risk'],
  medium: ['보통', 'attn'],
  low: ['낮음', 'muted'],
};

/** claude agents --json의 status. waiting은 허락을 기다리는 명령이 있으면 허락 대기다 */
export const SESSION_ST: Record<string, [string, Tone]> = {
  running: ['실행 중', 'prog'],
  input: ['입력 대기', 'attn'],
  permission: ['허락 대기', 'attn'],
  ended: ['끝남', 'muted'],
  unknown: ['상태를 알 수 없음', 'muted'],
};

export const ENV: Record<DeployEnv, string> = { production: '운영', staging: '스테이징', development: '개발', preview: '미리보기', store: '스토어' };
export const DEPLOY_SOURCE: Record<DeploySource, string> = { github_deployment: 'Railway·Vercel', workflow_run: 'GitHub Actions', manual: '직접', claude: 'Claude' };
export const ACTOR: Record<ActivityActor, string> = { me: '나', claude: 'Claude', hub: 'Hub', github: 'GitHub' };
export const TASK_TYPE: Record<TaskType, string> = { feature: '기능', bug: '버그', chore: '잡무' };
export const ASSIGNEE: Record<TaskAssignee, string> = { claude: 'Claude', me: '나' };
export const PRIORITY: Record<number, string> = { 1: '높음', 2: '보통', 3: '낮음' };

/** run 실패 사유 (result.failure) */
export const FAILURE: Record<string, string> = {
  rate_limit: '사용량 한도',
  process: '프로세스 오류',
  no_output: '결과 없음',
  no_commit: '커밋 없음',
  check: 'push 전 검사 실패',
  git: 'git 오류',
  pr: 'push·PR 실패',
  hub_restart: 'Hub 재시작',
};

export const RUN_KIND: Record<RunKind, string> = { implement: '구현', idea_gen: '기획 생성', bootstrap: '새 앱 시작', session: '세션 이어서' };

export const DOT_COLOR: Record<AppDot, string> = {
  risk: 'var(--risk)',
  attn: 'var(--attn-dot)',
  prog: 'var(--prog-dot)',
  quiet: 'var(--muted-dot)',
  ok: '',
};

export const DOT_LABEL: Record<AppDot, string> = {
  risk: '위험 · 배포 실패나 치명·높음 버그',
  attn: '확인 필요 · 답변 대기, 실패, 허락 대기',
  prog: '실행 중',
  quiet: '조용함 · 14일 넘게 활동 없음, 멈춤·보관',
  ok: '',
};

export function tone(map: Record<string, [string, Tone]>, key: string): { label: string; fg: string; bg: string; dot: string } {
  const [label, t] = map[key] ?? [key, 'muted'];
  return { label, ...TONE[t] };
}
