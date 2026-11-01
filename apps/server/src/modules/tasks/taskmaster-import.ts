import type { TaskStatus } from '@hub/shared';

/** Task Master tasks.json의 task 한 개 (필요한 필드만) */
export interface TmTask {
  id: number | string;
  title: string;
  description?: string;
  details?: string;
  testStrategy?: string;
  status?: string;
  priority?: string;
  dependencies?: Array<number | string>;
  subtasks?: unknown[];
}

export interface TmTagged {
  tag: string;
  tasks: TmTask[];
}

const STATUS_MAP: Record<string, TaskStatus> = {
  pending: 'todo',
  deferred: 'todo',
  blocked: 'todo',
  'in-progress': 'doing',
  review: 'review',
  done: 'done',
  cancelled: 'cancelled',
};

export function mapTmStatus(status: string | undefined): TaskStatus {
  return STATUS_MAP[status ?? 'pending'] ?? 'todo';
}

/** 태그 형식({ master: { tasks } })과 예전 형식({ tasks })을 모두 받는다. */
export function parseTaskmasterFile(json: unknown): TmTagged[] {
  if (!json || typeof json !== 'object') throw new Error('tasks.json이 객체가 아니다');
  const root = json as Record<string, unknown>;
  if (Array.isArray(root.tasks)) return [{ tag: 'master', tasks: root.tasks as TmTask[] }];
  return Object.entries(root)
    .filter(([, v]) => v && typeof v === 'object' && Array.isArray((v as { tasks?: unknown }).tasks))
    .map(([tag, v]) => ({ tag, tasks: (v as { tasks: TmTask[] }).tasks }));
}

export function composeDescription(t: TmTask): string | null {
  const parts = [t.description?.trim()];
  if (t.details?.trim()) parts.push(`## 상세\n\n${t.details.trim()}`);
  if (t.testStrategy?.trim()) parts.push(`## 테스트 전략\n\n${t.testStrategy.trim()}`);
  const text = parts.filter(Boolean).join('\n\n');
  return text || null;
}
