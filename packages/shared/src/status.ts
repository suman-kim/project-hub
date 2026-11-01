export const TASK_STATUSES = ['todo', 'doing', 'input', 'review', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = ['queued', 'running', 'input', 'done', 'failed', 'stopped'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const IDEA_STATUSES = ['pending', 'revising', 'approved', 'rejected'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** feature: 등록된 앱의 다음 기능 기획, app: 저장소 없이 구상하는 새 앱 기획 */
export const IDEA_KINDS = ['feature', 'app'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

export const TASK_SIZES = ['S', 'M', 'L'] as const;
export type TaskSize = (typeof TASK_SIZES)[number];

/** feature: 기능, bug: 버그, chore: 잡무 */
export const TASK_TYPES = ['feature', 'bug', 'chore'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** claude: Hub runner나 Claude 세션이 하는 일, me: 사용자가 직접 할 일 */
export const TASK_ASSIGNEES = ['claude', 'me'] as const;
export type TaskAssignee = (typeof TASK_ASSIGNEES)[number];

export const BUG_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

/** 앱 진행 상태. 사용자가 정한다 */
export const APP_LIFECYCLES = ['developing', 'operating', 'paused', 'archived'] as const;
export type AppLifecycle = (typeof APP_LIFECYCLES)[number];

/** 앱마다 바꿀 수 있는 개발 단계의 기본값 */
export const DEFAULT_STAGES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'plan', name: '기획' },
  { key: 'design', name: '디자인' },
  { key: 'develop', name: '개발' },
  { key: 'test', name: '테스트' },
  { key: 'deploy', name: '배포' },
  { key: 'operate', name: '운영' },
];

export const DEPLOY_ENVS = ['production', 'staging', 'development', 'preview', 'store'] as const;
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

export const DEPLOY_STATUSES = ['queued', 'in_progress', 'success', 'failure', 'cancelled', 'inactive'] as const;
export type DeployStatus = (typeof DEPLOY_STATUSES)[number];

/** github_deployment: Railway·Vercel 등이 남긴 GitHub 배포 기록, workflow_run: GitHub Actions, manual: 화면, claude: MCP */
export const DEPLOY_SOURCES = ['github_deployment', 'workflow_run', 'manual', 'claude'] as const;
export type DeploySource = (typeof DEPLOY_SOURCES)[number];

export const ACTIVITY_ACTORS = ['me', 'claude', 'hub', 'github'] as const;
export type ActivityActor = (typeof ACTIVITY_ACTORS)[number];

export const SPEC_KINDS = ['spec', 'handoff'] as const;
export type SpecKind = (typeof SPEC_KINDS)[number];

export const SESSION_ORIGINS = ['local', 'hub'] as const;
export type SessionOrigin = (typeof SESSION_ORIGINS)[number];

// todo → doing ⇄ input → review → done. cancelled는 어느 상태에서든 갈 수 있다.
const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['doing'],
  doing: ['input', 'review'],
  input: ['doing', 'review'],
  review: ['done'],
  done: [],
  cancelled: [],
};

// 내 할 일은 리뷰가 없다: todo ⇄ doing → done, todo → done, done → todo(다시 열기)
const MY_TODO_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['doing', 'done'],
  doing: ['todo', 'done'],
  input: ['doing', 'done'],
  review: ['done'],
  done: ['todo'],
  cancelled: [],
};

/** 같은 상태로의 "전이"는 메모만 남기는 용도라 허용한다. */
export function canTransitionTask(from: TaskStatus, to: TaskStatus, assignee: TaskAssignee = 'claude'): boolean {
  if (from === to) return true;
  if (to === 'cancelled') return true;
  return (assignee === 'me' ? MY_TODO_TRANSITIONS : TASK_TRANSITIONS)[from].includes(to);
}

// queued → running ⇄ input → done / failed / stopped
const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'stopped', 'failed'],
  running: ['input', 'done', 'failed', 'stopped'],
  input: ['running', 'stopped', 'failed'],
  done: [],
  failed: [],
  stopped: [],
};

// pending → revising(수정 요청으로 다음 버전 생성 중) → pending, pending → approved / rejected
const IDEA_TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  pending: ['revising', 'approved', 'rejected'],
  revising: ['pending'],
  approved: [],
  rejected: [],
};

export function canTransitionIdea(from: IdeaStatus, to: IdeaStatus): boolean {
  return IDEA_TRANSITIONS[from].includes(to);
}

export const RULE_SCOPES = ['global', 'app'] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return from === to || RUN_TRANSITIONS[from].includes(to);
}
