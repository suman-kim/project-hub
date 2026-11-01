import type { IdeaKind, IdeaStatus, RunStatus } from './status';
import type { ActivityDto, AppDto, DeploymentDto, TaskDto } from './dto';

/** WebSocket으로 UI에 밀어 주는 이벤트. 이름과 페이로드를 여기서 고정한다. */
export interface HubEvents {
  'run.log': { runId: number; seq: number; ts: string; kind: string; text: string };
  'run.status': { runId: number; taskId: string | null; status: RunStatus; reason?: string };
  'task.updated': { task: TaskDto };
  'idea.created': { ideaId: number; kind: IdeaKind; appCode: string | null; title: string };
  'idea.updated': { ideaId: number; kind: IdeaKind; appCode: string | null; status: IdeaStatus; currentVersion: number };
  'app.updated': { app: AppDto };
  'settings.updated': { key: string };
  'activity.created': { activity: ActivityDto };
  'deployment.updated': { deployment: DeploymentDto };
  'session.event': { sessionId: string; appCode: string | null; event: string; toolName: string | null; summary: string };
}

export type HubEventName = keyof HubEvents;
