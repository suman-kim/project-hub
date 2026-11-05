import type {
  ActivityActor,
  AppLifecycle,
  BugSeverity,
  DeployEnv,
  DeploySource,
  DeployStatus,
  IdeaKind,
  IdeaStatus,
  RunStatus,
  RuleScope,
  SessionOrigin,
  SpecKind,
  TaskAssignee,
  TaskSize,
  TaskStatus,
  TaskType,
} from './status';

export interface AppDto {
  id: number;
  code: string;
  name: string;
  repoPath: string | null;
  defaultBranch: string;
  folderNames: string[];
  setupCmd: string | null;
  ideaCron: string | null;
  guardEnabled: boolean;
  directionNote: string | null;
  /** null이면 Hub 기본 허용 도구 목록 */
  allowedTools: string[] | null;
  /** push 전에 돌리는 검사 명령(화면의 "가드"). 실패하면 PR을 만들지 않는다 */
  checkCmd: string | null;
  /** worktree를 만들 곳. null이면 ~/.hub/worktrees */
  worktreeRoot: string | null;
  /** 다음에 만들 task 번호 (LK-<번호>) */
  nextTaskSeq: number;
  description: string | null;
  /** github, production, staging, appStore, playStore, docs 등 이름 → 주소 */
  links: Record<string, string>;
  stack: string | null;
  /** 이 앱의 개발 단계. 기본은 기획·디자인·개발·테스트·배포·운영 */
  stages: AppStage[];
  /** 현재 단계 key */
  stage: string | null;
  lifecycle: AppLifecycle;
}

export interface AppStage {
  key: string;
  name: string;
}

/** 앱의 저장소 하나. 앱 폴더 아래 backend, frontend처럼 여러 개일 수 있다 */
export interface AppRepoDto {
  id: number;
  appCode: string;
  name: string;
  path: string;
  /** owner/repo. GitHub 원격이 없으면 null */
  github: string | null;
  defaultBranch: string;
  setupCmd: string | null;
  /** push 전 검사 명령. 비어 있으면 앱의 checkCmd */
  checkCmd: string | null;
  /** GitHub Actions 워크플로 이름 → 배포 환경 */
  deployRules: Array<{ workflow: string; env: DeployEnv }>;
}

/** 버그 task의 metadata.bug */
export interface BugInfo {
  severity: BugSeverity;
  steps?: string;
  expected?: string;
  actual?: string;
  env?: string;
  version?: string;
}

export interface TaskNote {
  ts: string;
  status: TaskStatus;
  note: string;
}

/** GET /api/tasks/:id/brief: 다른 세션에 넘길 task 전체 정보 글 */
export interface TaskBriefDto {
  taskId: string;
  text: string;
}

export interface TaskDto {
  id: string;
  appCode: string;
  ideaId: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  type: TaskType;
  assignee: TaskAssignee;
  /** 1(높음)~3(낮음) */
  priority: number | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  stage: string | null;
  repoId: number | null;
  size: TaskSize | null;
  tag: string | null;
  dependsOn: string[];
  branch: string | null;
  prUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SpecDto {
  id: number;
  ideaId: number | null;
  taskId: string | null;
  kind: SpecKind;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** 기획 본문: 문제, 제안, 시나리오, 명세, 영향 범위, 예상 task */
export interface IdeaBody {
  problem: string;
  /** 새 앱 기획에서는 해결 방식 */
  proposal: string;
  scenarios?: string[];
  /** 새 앱 기획에서는 MVP 명세 */
  spec?: string;
  impact?: string;
  expectedTasks?: Array<{ title: string; description?: string; size?: TaskSize; dependsOnIndex?: number[] }>;
  /** 명세를 항목으로 쪼갠 것 (화면의 기능 명세 목록) */
  specItems?: string[];
  /** 바뀔 파일 경로 (화면의 영향 범위 목록) */
  impactFiles?: string[];
  /** 수정 요청으로 만든 버전에서 앞 버전과 달라진 점 */
  changeSummary?: string;
  /** 새 앱 기획(kind=app)에만 있다 */
  concept?: AppConcept;
}

/** 새 앱 기획에만 있는 내용 */
export interface AppConcept {
  oneLiner: string;
  targetUsers: string;
  mvpFeatures: string[];
  /** 웹 조사로 찾은 비슷한 서비스와 차이 */
  competitors: Array<{ name: string; url?: string; difference: string }>;
  market: string;
  monetization: string;
  techStack: string;
  risks: string[];
  /** 수요를 싸게 확인하는 방법 */
  validation: string;
  /** 승인하면 만들 앱. 승인할 때 바꿀 수 있다. folder는 로컬 폴더와 GitHub 저장소 이름 */
  app: { code: string; name: string; folder: string };
  /** 깊게 쓰지 않은 다른 후보. 고르면 그 후보로 다시 생성한다 */
  alternatives: Array<{ title: string; oneLiner: string }>;
  sources: string[];
  /** 다른 기획의 후보를 깊게 쓴 것이면 그 기획 */
  sourceIdeaId?: number;
  /** 생성할 때 덧붙인 "이번 요청" */
  requestNote?: string;
}

/** 승인해서 task를 실행하면 드는 시간과 비용의 범위. 지난 실행을 크기별로 모아 계산한다 */
export interface IdeaEstimate {
  label: string;
  minutes: [number, number];
  costUsd: [number, number];
  /** history: 지난 실행 기록, default: 기록이 모자라 기본값 */
  basis: 'history' | 'default';
}

export interface IdeaVersionDto {
  version: number;
  body: IdeaBody;
  revisionNote: string | null;
  runId: number | null;
  createdAt: string;
}

export interface IdeaDto {
  id: number;
  kind: IdeaKind;
  /** 새 앱 기획은 승인해서 앱이 생기기 전까지 null */
  appCode: string | null;
  title: string;
  status: IdeaStatus;
  currentVersion: number;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  versions?: IdeaVersionDto[];
  /** 상세에서만 */
  estimate?: IdeaEstimate;
}

/** 세션에서 지적받은 실수(record_mistake). active인 것만 새 세션 맥락에 들어간다 */
export interface MistakeDto {
  id: number;
  appCode: string;
  what: string;
  correctWay: string;
  active: boolean;
  createdAt: string;
}

/** 앱 등록 창의 프로젝트 폴더 고르기: 새 앱 폴더 위치 바로 아래의 git 프로젝트 */
export interface ProjectCandidateDto {
  path: string;
  name: string;
  /** 폴더가 git 저장소면 그 하나, 아니면 바로 아래의 git 저장소들 */
  repos: Array<{ path: string; name: string; github: string | null; branch: string | null }>;
  /** 이미 이 폴더로 등록된 앱 */
  appCode: string | null;
}

/** Hub 기본값 (앱 설정 화면이 "Hub 기본값"으로 보여 준다) */
export interface HubDefaultsDto {
  allowedTools: string[];
  worktreeRoot: string;
}

export interface RuleDto {
  id: number;
  scope: RuleScope;
  appCode: string | null;
  position: number;
  body: string;
}

export interface SessionDto {
  id: number;
  claudeSessionId: string;
  appCode: string | null;
  taskId: string | null;
  origin: SessionOrigin;
  cwd: string;
  startedAt: string;
  endedAt: string | null;
}

/**
 * 세션 상태(hook 기록으로 짐작). working: 일하는 중, idle: 입력 대기(턴이 끝남),
 * quiet: 일하던 중 30분 넘게 소식 없음(터미널을 닫았을 수 있음), ended: 끝남
 */
export type SessionState = 'working' | 'idle' | 'quiet' | 'ended';

/** 앱 페이지 세션 탭의 한 줄 */
export interface SessionViewDto {
  id: number;
  claudeSessionId: string;
  /** 등록되지 않은 폴더의 세션은 null */
  appCode: string | null;
  cwd: string;
  /** local: 내가 연 세션, hub: Hub가 띄운 세션 */
  origin: SessionOrigin;
  /** Hub가 띄운 세션의 run */
  run: { id: number; kind: RunKind; status: RunStatus } | null;
  /** 이 세션이 진행 중인 task (세션 연결, 없으면 run의 task) */
  task: { id: string; title: string; status: TaskStatus } | null;
  state: SessionState;
  /** 아직 열려 있는 세션(끝남 기록이 없고 3일 안에 활동) */
  open: boolean;
  startedAt: string;
  endedAt: string | null;
  lastAt: string | null;
  /** 마지막으로 받은 사용자 메시지 요약 */
  lastPrompt: string | null;
  /** 마지막 기록: 이벤트 이름과 요약 (예: PostToolUse, "Bash pnpm test") */
  lastEvent: { event: string; summary: string } | null;
}

/**
 * 대화 화면의 한 줄. 세션 대화 기록(transcript)과 run 로그를 같은 모양으로 바꿔 보여 준다.
 * user: 사람(또는 Hub)이 보낸 메시지, assistant: Claude 답변, tool: 도구 사용과 결과, note: 가운데 안내 줄
 * user.delivery: 대시보드에서 일하는 중인 세션에 보낸 메시지의 전달 상태
 */
export type ChatItem =
  | { kind: 'user'; id: string; at: string | null; text: string; from: 'me' | 'hub'; images: number; delivery?: 'pending' | 'delivered' }
  | { kind: 'assistant'; id: string; at: string | null; text: string }
  | { kind: 'tool'; id: string; at: string | null; name: string; summary: string; result: string | null; error: boolean }
  | { kind: 'note'; id: string; at: string | null; text: string; tone: 'muted' | 'attn' | 'risk' | 'done' };

/** 세션 대화. 긴 대화는 뒤에서부터 limit개만 준다 */
export interface SessionChatDto {
  session: SessionViewDto;
  items: ChatItem[];
  /** 전체 줄 수. items보다 많으면 앞쪽이 생략된 것이다 */
  total: number;
  /** 대화 기록 파일을 못 찾은 경우의 이유 */
  missing: string | null;
}

/** run 비용 합계. 구독으로 실행하면 실제 청구액이 아니라 claude가 알려 준 API 환산 비용이다. */
export interface CostTotal {
  costUsd: number;
  runs: number;
}

export interface MonthlyCostDto extends CostTotal {
  /** YYYY-MM (Asia/Seoul) */
  month: string;
}

export interface CostSummaryDto extends MonthlyCostDto {
  timezone: string;
  byApp: Array<CostTotal & { appCode: string | null }>;
  byKind: Array<CostTotal & { kind: string }>;
  byDay: Array<CostTotal & { date: string }>;
}

/** 새 앱 기획 설정 (hub_settings의 ideation) */
export interface IdeationSettingsDto {
  /** 관심 분야와 조건. 예: 1인 개발, 3개월 MVP, Flutter + NestJS */
  directionNote: string | null;
  /** 자동 생성 주기 (cron 5필드, Asia/Seoul). null이면 끈다 */
  cron: string | null;
  /** 새 앱 폴더를 만들 곳 */
  projectRoot: string;
  /** GitHub 저장소 소유자. null이면 gh 로그인 계정 */
  githubOwner: string | null;
  /** 새 앱 시작 세션의 권한 모드. auto는 분류기가 허락을 대신 판단해 멈추지 않고 진행한다 */
  sessionPermissionMode: SessionPermissionMode;
}

export const SESSION_PERMISSION_MODES = ['auto', 'acceptEdits'] as const;
export type SessionPermissionMode = (typeof SESSION_PERMISSION_MODES)[number];

export interface DeploymentDto {
  id: number;
  appCode: string;
  repoId: number | null;
  repoName: string | null;
  source: DeploySource;
  externalId: string;
  /** 원래 환경 이름. 예: "Cyphers Meta / production", "서버 배포" */
  environment: string;
  env: DeployEnv;
  version: string | null;
  sha: string | null;
  status: DeployStatus;
  url: string | null;
  notes: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** 앱 히스토리 한 줄 */
export interface ActivityDto {
  id: number;
  appCode: string | null;
  at: string;
  /** task.created, task.status, task.note, run.finished, idea.*, app.stage, app.lifecycle, deploy, note 등 */
  kind: string;
  actor: ActivityActor;
  refType: string | null;
  refId: string | null;
  summary: string;
  data: Record<string, unknown>;
}

/** 사이드바 점 색: risk(배포 실패·심각한 버그), attn(내 답·허락 대기), prog(실행 중), quiet(조용함), ok */
export type AppDot = 'risk' | 'attn' | 'prog' | 'quiet' | 'ok';

export interface AppSignals {
  dot: AppDot;
  deploy: Array<{ repoName: string | null; env: DeployEnv; status: DeployStatus; version: string | null; at: string | null }>;
  blocked: { waitingRuns: number; failedRuns: number; waitingSessions: Array<{ id: string; name: string; waitingFor: string | null }> };
  running: number;
  bugs: { open: number; critical: number };
  activity: { lastAt: string | null; quietDays: number | null };
  stage: { key: string; name: string; index: number; total: number } | null;
  /** "개발 중"인데 오래 조용하면 띄우는 질문 */
  nudge: string | null;
}

export interface AppStatusDto {
  code: string;
  name: string;
  lifecycle: AppLifecycle;
  signals: AppSignals;
}

/** implement: task 구현, idea_gen: 기획 생성·수정, bootstrap: 새 앱 폴더·저장소·세션 시작 */
/** session: 끝났거나 닫은 세션을 대시보드에서 이어서 한 run */
export type RunKind = 'implement' | 'idea_gen' | 'bootstrap' | 'session';

/** run의 최종 판정과 진행 정보 */
export interface RunResult {
  /** claude가 출력 스키마로 돌려준 값 */
  output?: { status: 'done' | 'needs_input'; summary: string; question?: string };
  /** 답변 대기 중인 질문 */
  question?: string;
  /** 지금까지 받은 답변 */
  answers?: Array<{ ts: string; answer: string }>;
  /** failed, stopped 사유 */
  reason?: string;
  /** rate_limit | process | no_output | no_commit | check | git | pr | hub_restart */
  failure?: string;
  /** 마지막으로 받은 사용량 정보 (rate_limit_event) */
  rateLimit?: unknown;
  commits?: number;
  /** implement run을 돌린 저장소 */
  repo?: { id: number; name: string; path: string };
  /**
   * idea_gen run: 기획 종류, 대상 앱(새 앱 기획은 null), 수정할 기획과 요청, 깊게 쓸 후보, 결과로 생긴 기획.
   * kind가 없으면 feature (새 앱 기획이 생기기 전에 만든 run)
   */
  idea?: {
    kind?: IdeaKind;
    appId: number | null;
    ideaId?: number | null;
    note?: string | null;
    seed?: { title: string; oneLiner: string; fromIdeaId?: number } | null;
    resultIdeaId?: number;
    auto?: boolean;
  };
  /** bootstrap run: 만든 저장소, 띄운 세션, 세션을 못 띄워 대신 시작한 runner run */
  /** session run: 이어서 한 세션과 보낸 메시지 */
  session?: { sessionId: number; claudeSessionId: string; appId: number; cwd: string; message: string };
  bootstrap?: {
    ideaId: number;
    appId: number;
    repoUrl?: string;
    firstTaskId?: string;
    rc?: { name: string; output: string; verified: boolean; id?: string; link?: string | null };
    fallbackRunId?: number;
    fallbackReason?: string;
  };
}

export interface RunDto {
  id: number;
  taskId: string | null;
  kind: RunKind;
  status: RunStatus;
  claudeSessionId: string | null;
  worktreePath: string | null;
  branch: string | null;
  costUsd: number;
  result: RunResult;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

/** 전체 run 목록의 한 줄. 앱은 task의 앱, 기획 생성·시작 run은 result에 적힌 앱이다 */
export interface RunListItemDto extends RunDto {
  appCode: string | null;
  taskTitle: string | null;
  taskStatus: TaskStatus | null;
  /** 실패·중지 run을 다시 실행해 완료한 run id. 있으면 실패 목록에서 뺀다 */
  resolvedBy: number | null;
}

/** 문서 탭에 보이는 파일 종류. 그 밖의 파일(js, css 등)은 목록에 없고 보기 주소로만 열린다 */
export type ProjectFileKind = 'md' | 'text' | 'html' | 'image' | 'pdf';

/** 프로젝트 docs/·design/ 아래 파일 한 개 */
export interface ProjectFileDto {
  /** roots의 index */
  root: number;
  /** 루트 기준 경로. docs/ 또는 design/으로 시작한다 */
  path: string;
  kind: ProjectFileKind;
  size: number;
  modifiedAt: string;
}

/** 앱 폴더와 저장소마다의 docs/·design/ 파일 목록 */
export interface ProjectFilesDto {
  roots: Array<{
    index: number;
    /** 앱 폴더면 "앱 폴더", 저장소면 저장소 이름 */
    label: string;
    path: string;
    /** 이 루트의 파일을 여는 서명된 임시 주소. 뒤에 path를 붙인다 (예: /view/…/docs/a.md) */
    viewBase: string;
    /** 파일이 너무 많아 목록을 자른 경우 */
    truncated: boolean;
  }>;
  files: ProjectFileDto[];
}

export interface RunLogDto {
  id: string;
  runId: number;
  seq: number;
  ts: string;
  /** hub, system, assistant, tool_use, tool_result, result, rate_limit, stderr, check */
  kind: string;
  text: string;
  raw: Record<string, unknown> | null;
}

export interface UsageWindowDto {
  /** 0~1 */
  utilization: number | null;
  resetsAt: string | null;
  status: string | null;
}

/** 가장 최근 run이 받은 사용량. Hub가 claude를 실행할 때만 갱신된다 */
export interface UsageDto {
  /** 값을 받은 시각. 받은 적이 없으면 null */
  at: string | null;
  runId: number | null;
  fiveHour: UsageWindowDto | null;
  sevenDay: UsageWindowDto | null;
  /** 자동 생성을 건너뛰는 기준 (0.8) */
  limit: number;
  /** 지금 기준을 넘어 자동 생성을 건너뛰는지 */
  high: boolean;
}

export interface AppOverviewDto {
  app: AppDto;
  repos: AppRepoDto[];
  signals: AppSignals;
  counts: { tasks: number; bugs: number; todos: number; overdueTodos: number };
  costThisMonthUsd: number;
  latestDeployments: DeploymentDto[];
  recentActivities: ActivityDto[];
  nextTodos: TaskDto[];
}

// ---- 이 맥북의 Claude Code 환경 (스킬·플러그인·커넥터) ----

/** claude.ai 계정에서 동기화된 것 / 이 맥북에 직접 설치한 것 / 플러그인에 딸린 것 / 앱 저장소의 .claude */
export type EnvSource = 'claude_ai' | 'local' | 'plugin' | 'project';

export interface PluginDto {
  name: string;
  version: string | null;
  description: string | null;
  source: 'claude_ai' | 'local';
  marketplace: string | null;
  /** settings.json enabledPlugins에서 끈 플러그인만 false */
  enabled: boolean;
  path: string;
  skills: number;
  commands: number;
  /** 설명의 한국어 요약. 아직 만들지 않았으면 null */
  ko: string | null;
}

export interface SkillDto {
  name: string;
  description: string;
  kind: 'skill' | 'command';
  source: EnvSource;
  /** source가 plugin이면 플러그인 이름 */
  plugin: string | null;
  /** source가 project면 앱 코드 */
  appCode: string | null;
  path: string;
  ko: string | null;
}

export interface EnvironmentDto {
  scannedAt: string;
  plugins: PluginDto[];
  skills: SkillDto[];
  ko: KoProgressDto;
}

/** 한국어 요약 만들기 진행 상황. Claude(haiku)로 40개씩 만든다 */
export interface KoProgressDto {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
}

export type McpStatus = 'connected' | 'needs_auth' | 'failed' | 'not_configured' | 'unknown';

export interface McpServerDto {
  /** claude.ai 커넥터는 "claude.ai " 뒤 이름, 플러그인 MCP는 서버 이름 */
  name: string;
  source: 'claude_ai' | 'plugin' | 'local';
  plugin: string | null;
  target: string;
  status: McpStatus;
  detail: string | null;
  /** 무엇을 하는 서버인지 한국어 한 줄. 아직 만들지 않았으면 null */
  ko: string | null;
}

/** claude mcp list 결과. 확인에 30초쯤 걸려서 Hub가 마지막 결과를 들고 있다 */
export interface McpCheckDto {
  checkedAt: string | null;
  running: boolean;
  error: string | null;
  servers: McpServerDto[];
}

// ---- 규칙 화면의 CLAUDE.md ----

export interface ClaudeMdFileDto {
  /** global, app:<코드>, repo:<저장소 id>. 서버가 정한 파일만 고칠 수 있다 */
  key: string;
  label: string;
  appCode: string | null;
  path: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
}

export interface ClaudeMdDto extends ClaudeMdFileDto {
  text: string;
  /** 읽을 때 내용의 해시. 저장할 때 다시 보내서 그 사이에 바뀌었으면 409 */
  version: string;
}

// ---- 내 업무 (앱에 묶이지 않는 내 할 일·문서·키) ----

export const MY_DOC_KINDS = ['store', 'apikey', 'billing', 'domain', 'legal', 'memo'] as const;
export type MyDocKind = (typeof MY_DOC_KINDS)[number];
export const MY_SECRET_MODES = ['value', 'ref', 'none'] as const;
export type MySecretMode = (typeof MY_SECRET_MODES)[number];
export const MY_DOC_RENEWS = ['만료', '갱신', '결제'] as const;
export type MyDocRenew = (typeof MY_DOC_RENEWS)[number];

export interface MyTodoDto {
  id: number;
  /** ME-<id> */
  key: string;
  /** 하위 할 일이면 상위 할 일 id (한 단계만) */
  parentId: number | null;
  title: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  priority: 1 | 2 | 3;
  done: boolean;
  doneAt: string | null;
  docId: number | null;
  createdAt: string;
}

/** 키 값 원문은 담지 않는다. 보기·복사는 GET /api/mine/docs/:id/secret으로 따로 받는다 */
export interface MyDocDto {
  id: number;
  kind: MyDocKind;
  title: string;
  fields: Array<[string, string]>;
  secretMode: MySecretMode;
  secretRef: string;
  hasValue: boolean;
  /** 저장한 값의 끝 4자리 */
  secretLast4: string | null;
  /** YYYY-MM-DD */
  expiresOn: string | null;
  renewLabel: MyDocRenew;
  memo: string;
  /** 첨부 파일, 올린 순 */
  files: MyDocFileDto[];
  updatedAt: string;
}

/** 첨부 파일 보기 방식: pdf·md·text·image는 화면 안에서 보고, other는 내려받기만 한다 */
export const MY_FILE_KINDS = ['pdf', 'md', 'text', 'image', 'other'] as const;
export type MyFileKind = (typeof MY_FILE_KINDS)[number];

/** 내 업무 문서의 첨부 파일. 내용은 Hub 폴더(~/.hub/files/)에 그대로 두고 목록만 DB에 있다 */
export interface MyDocFileDto {
  id: number;
  /** 첨부한 문서 id */
  docId: number;
  /** 올린 파일 이름 */
  name: string;
  kind: MyFileKind;
  /** 바이트 */
  size: number;
  /** 화면 안에서 여는 주소. 뒤에 ?download=1을 붙이면 내려받는다 */
  url: string;
  createdAt: string;
}

export interface MineDto {
  todos: MyTodoDto[];
  docs: MyDocDto[];
}

/** 앱별 노트: 명령어 보관, 간단한 메모, 할 일 등 자유 글. 본문은 markdown */
export interface AppNoteDto {
  id: number;
  /** 노트가 속한 앱 id */
  appId: number;
  /** 노트를 묶는 폴더 이름. 비우면 폴더 없음 */
  folder: string;
  /** 제목. 비우면 화면에서 본문 첫 줄을 보여 준다 */
  title: string;
  /** 본문 (markdown) */
  body: string;
  /** 목록 맨 위 고정 */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}
