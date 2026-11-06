import { z } from 'zod';
import { BUG_SEVERITIES, TASK_ASSIGNEES, TASK_SIZES, TASK_STATUSES, TASK_TYPES } from '@hub/shared';

export const taskStatusSchema = z.enum(TASK_STATUSES);

const bugSchema = z.object({
  severity: z.enum(BUG_SEVERITIES),
  steps: z.string().optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  env: z.string().optional(),
  version: z.string().optional(),
});
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** 기능·버그·잡무, 담당, 우선순위, 기한, 단계, 저장소 */
const planningFields = {
  type: z.enum(TASK_TYPES).optional(),
  assignee: z.enum(TASK_ASSIGNEES).optional(),
  priority: z.number().int().min(1).max(3).nullable().optional(),
  dueDate: dueDate.nullable().optional(),
  stage: z.string().nullable().optional(),
  repoId: z.number().int().nullable().optional(),
  bug: bugSchema.optional(),
};

export const newTaskSchema = z.object({
  ...planningFields,
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  size: z.enum(TASK_SIZES).nullable().optional(),
  tag: z.string().nullable().optional(),
  ideaId: z.number().int().nullable().optional(),
  /** 이미 있는 task ID */
  dependsOn: z.array(z.string()).optional(),
  /** 같은 요청 안에서 앞에 있는 task의 0부터 시작하는 순번 */
  dependsOnIndex: z.array(z.number().int().min(0)).optional(),
});
export type NewTaskInput = z.infer<typeof newTaskSchema>;

export const createTaskSchema = newTaskSchema.extend({ app: z.string().min(1) });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  ...planningFields,
  status: taskStatusSchema.optional(),
  note: z.string().min(1).optional(),
  /** 앞뒤 공백은 떼고, 비면 거부한다 */
  title: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  size: z.enum(TASK_SIZES).nullable().optional(),
  tag: z.string().nullable().optional(),
  dependsOn: z.array(z.string()).optional(),
  branch: z.string().nullable().optional(),
  prUrl: z.string().nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z.object({
  app: z.string().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(taskStatusSchema).optional()),
  type: z.enum(TASK_TYPES).optional(),
  assignee: z.enum(TASK_ASSIGNEES).optional(),
  stage: z.string().optional(),
  repoId: z.coerce.number().int().optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const importTaskmasterSchema = z.object({
  app: z.string().min(1),
  /** 생략하면 <repo_path>/.taskmaster/tasks/tasks.json. 앱 저장소 안의 경로만 받는다. */
  path: z.string().optional(),
  /** true면 바꾸지 않고 무엇이 바뀔지만 돌려준다 */
  dryRun: z.boolean().optional(),
  /** 이미 가져온 task의 제목·설명·의존이 바뀌었으면 덮어쓴다. 상태는 Hub 것을 둔다 */
  update: z.boolean().optional(),
});
export type ImportTaskmasterInput = z.infer<typeof importTaskmasterSchema>;
