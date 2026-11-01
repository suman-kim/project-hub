import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  ActivityDto,
  AppDto,
  AppOverviewDto,
  AppRepoDto,
  AppStatusDto,
  DeploymentDto,
  HubDefaultsDto,
  IdeationSettingsDto,
  MistakeDto,
  ProjectFilesDto,
  SessionChatDto,
  SessionViewDto,
  IdeaDto,
  IdeaKind,
  IdeaStatus,
  RunKind,
  RunListItemDto,
  RunStatus,
  TaskAssignee,
  TaskDto,
  TaskStatus,
  TaskType,
  UsageDto,
} from '@hub/shared';
import { api, qs } from './client';

/**
 * 쿼리 키. WebSocket 이벤트가 오면 앞부분(예: ['tasks'])으로 묶어서 무효화한다.
 * 그래서 목록은 [이름, 필터] 모양으로 둔다.
 */
export const keys = {
  me: ['me'] as const,
  apps: ['apps'] as const,
  appStatus: ['appStatus'] as const,
  usage: ['usage'] as const,
  runs: (f: RunFilter = {}) => ['runs', f] as const,
  run: (id: number) => ['run', id] as const,
  runLogs: (id: number) => ['runLogs', id] as const,
  tasks: (f: TaskFilter = {}) => ['tasks', f] as const,
  task: (id: string) => ['task', id] as const,
  ideas: (f: IdeaFilter = {}) => ['ideas', f] as const,
  idea: (id: number) => ['idea', id] as const,
  overview: (appId: number) => ['overview', appId] as const,
  sessions: (appId: number) => ['sessions', appId] as const,
  repos: (appId: number) => ['repos', appId] as const,
  projectFiles: (appId: number) => ['projectFiles', appId] as const,
  mistakes: (code: string) => ['mistakes', code] as const,
  defaults: ['settings', 'defaults'] as const,
  ideation: ['settings', 'ideation'] as const,
  deployments: (appId: number) => ['deployments', appId] as const,
  activities: (f: ActivityFilter) => ['activities', f] as const,
};

export interface Me {
  loggedIn: boolean;
  passwordSet: boolean;
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/api/auth/me'), staleTime: Infinity, retry: false });
}

export function useApps() {
  return useQuery({ queryKey: keys.apps, queryFn: () => api.get<AppDto[]>('/api/apps'), staleTime: 60_000 });
}

/** 코드로 앱 찾기. API 경로는 숫자 id를 쓰고 화면 주소는 코드를 쓴다 */
export function useAppByCode(code: string | undefined) {
  const apps = useApps();
  return { ...apps, data: code ? apps.data?.find((a) => a.code.toUpperCase() === code.toUpperCase()) : undefined };
}

export function useAppStatus() {
  return useQuery({ queryKey: keys.appStatus, queryFn: () => api.get<AppStatusDto[]>('/api/apps/status'), staleTime: 30_000, refetchInterval: 60_000 });
}

export function useUsage() {
  return useQuery({ queryKey: keys.usage, queryFn: () => api.get<UsageDto>('/api/usage'), staleTime: 60_000 });
}

export interface RunFilter {
  status?: RunStatus[];
  app?: string;
  kind?: RunKind;
  latest?: boolean;
  limit?: number;
}

export function useRuns(f: RunFilter = {}) {
  return useQuery({
    queryKey: keys.runs(f),
    queryFn: () => api.get<RunListItemDto[]>(`/api/runs${qs({ status: f.status?.join(','), app: f.app, kind: f.kind, latest: f.latest, limit: f.limit })}`),
    placeholderData: keepPreviousData,
  });
}

export interface TaskFilter {
  app?: string;
  status?: TaskStatus[];
  type?: TaskType;
  assignee?: TaskAssignee;
  stage?: string;
  repoId?: number;
}

export function useTasks(f: TaskFilter = {}, enabled = true) {
  return useQuery({
    queryKey: keys.tasks(f),
    queryFn: () =>
      api.get<TaskDto[]>(`/api/tasks${qs({ app: f.app, status: f.status?.join(','), type: f.type, assignee: f.assignee, stage: f.stage, repoId: f.repoId })}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export interface IdeaFilter {
  app?: string;
  status?: IdeaStatus[];
  kind?: IdeaKind;
}

export function useIdeas(f: IdeaFilter = {}) {
  return useQuery({
    queryKey: keys.ideas(f),
    queryFn: () => api.get<IdeaDto[]>(`/api/ideas${qs({ app: f.app, status: f.status?.join(','), kind: f.kind })}`),
    placeholderData: keepPreviousData,
  });
}

export function useOverview(appId: number | undefined) {
  return useQuery({
    queryKey: keys.overview(appId ?? 0),
    queryFn: () => api.get<AppOverviewDto>(`/api/apps/${appId}/overview`),
    enabled: !!appId,
    placeholderData: keepPreviousData,
  });
}

/** 이 앱 폴더에서 도는 Hub 밖 세션(claude --bg) */
export interface BgSessionView {
  id: string;
  sessionId: string;
  name: string | null;
  cwd: string;
  /** running, waiting 등 claude agents --json의 값 */
  status: string;
  waitingFor: string | null;
  /** 허락을 기다리는 명령 */
  pending: { tool: string; cmd: string } | null;
  remoteLink: string | null;
  attachCommand: string | null;
}

export function useAppSessions(appId: number | undefined) {
  return useQuery({
    queryKey: keys.sessions(appId ?? 0),
    queryFn: () => api.get<BgSessionView[]>(`/api/apps/${appId}/sessions`),
    enabled: !!appId,
    refetchInterval: 30_000,
  });
}

export function useRepos(appId: number | undefined) {
  return useQuery({ queryKey: keys.repos(appId ?? 0), queryFn: () => api.get<AppRepoDto[]>(`/api/apps/${appId}/repos`), enabled: !!appId });
}

/** 문서 탭: docs/·design/ 파일. 폴더 감시를 하지 않으니 탭을 열거나 창으로 돌아올 때마다 다시 읽는다 */
export function useProjectFiles(appId: number | undefined) {
  return useQuery({
    queryKey: keys.projectFiles(appId ?? 0),
    queryFn: () => api.get<ProjectFilesDto>(`/api/apps/${appId}/files`),
    enabled: !!appId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useMistakes(code: string | undefined) {
  return useQuery({ queryKey: keys.mistakes(code ?? ''), queryFn: () => api.get<MistakeDto[]>(`/api/mistakes?app=${code}`), enabled: !!code });
}

export function useDefaults() {
  return useQuery({ queryKey: keys.defaults, queryFn: () => api.get<HubDefaultsDto>('/api/settings/defaults'), staleTime: Infinity });
}

export function useIdeationSettings() {
  return useQuery({ queryKey: keys.ideation, queryFn: () => api.get<IdeationSettingsDto>('/api/settings/ideation') });
}

export function useDeployments(appId: number | undefined) {
  return useQuery({ queryKey: keys.deployments(appId ?? 0), queryFn: () => api.get<DeploymentDto[]>(`/api/apps/${appId}/deployments`), enabled: !!appId });
}

export interface ActivityFilter {
  app?: string;
  kind?: string;
  before?: number;
  limit?: number;
}

export function useActivities(f: ActivityFilter, enabled = true) {
  return useQuery({
    queryKey: keys.activities(f),
    queryFn: () => api.get<ActivityDto[]>(`/api/activities${qs({ app: f.app, kind: f.kind, before: f.before, limit: f.limit })}`),
    enabled,
  });
}

/**
 * 세션 탭: 이 앱의 Claude 세션(내가 연 것, Hub가 띄운 것). hook 이벤트가 올 때마다 ['sessions']로 무효화되고,
 * "N분 전"과 quiet 판정이 바뀌도록 30초마다 다시 읽는다.
 */
export function useClaudeSessions(appId: number | undefined) {
  return useQuery({
    queryKey: ['sessions', 'hook', appId ?? 0],
    queryFn: () => api.get<SessionViewDto[]>(`/api/apps/${appId}/claude-sessions`),
    enabled: !!appId,
    refetchInterval: 30_000,
  });
}

/** 세션 메뉴: 모든 앱의 세션(7일). 앱 거르기는 화면에서 한다 */
export function useAllSessions() {
  return useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<SessionViewDto[]>('/api/sessions'), refetchInterval: 30_000 });
}

/** 대화 보기. hook 이벤트가 올 때마다 ['sessions']로 무효화되어 거의 실시간으로 따라간다 */
export function useSessionChat(id: number, limit: number) {
  return useQuery({
    queryKey: ['sessions', 'chat', id, limit],
    queryFn: () => api.get<SessionChatDto>(`/api/sessions/${id}/chat?limit=${limit}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

/** 이 앱 폴더에서 열려 있는 내 세션(터미널의 claude). hook 기록으로 찾는다 */
export interface OpenSession {
  id: number;
  claudeSessionId: string;
  cwd: string;
  taskId: string | null;
  startedAt: string;
  lastAt: string | null;
}

export function useOpenSessions(appId: number | undefined) {
  return useQuery({ queryKey: ['openSessions', appId ?? 0], queryFn: () => api.get<OpenSession[]>(`/api/apps/${appId}/open-sessions`), enabled: !!appId, refetchInterval: 30_000 });
}
