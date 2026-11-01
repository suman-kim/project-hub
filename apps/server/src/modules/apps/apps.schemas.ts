import { z } from 'zod';
import { APP_LIFECYCLES } from '@hub/shared';

const code = z.string().regex(/^[A-Z]{2,4}$/, '앱 코드는 대문자 2~4자');

export const stagesSchema = z
  .array(
    z.object({
      key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, '단계 key는 영문 소문자, 숫자, 하이픈'),
      name: z.string().trim().min(1).max(20),
    }),
  )
  .min(1)
  .max(12)
  .refine((arr) => new Set(arr.map((s) => s.key)).size === arr.length, '단계 key가 겹친다');

export const createAppSchema = z.object({
  code,
  name: z.string().min(1),
  repoPath: z.string().min(1).nullable().optional(),
  defaultBranch: z.string().min(1).optional(),
  folderNames: z.array(z.string().min(1)).optional(),
  setupCmd: z.string().nullable().optional(),
  /** 아이디어 자동 생성 주기 (cron 5필드, Asia/Seoul). null이면 끈다. */
  ideaCron: z
    .string()
    .regex(/^\S+(\s+\S+){4}$/, 'cron은 "분 시 일 월 요일" 5필드')
    .nullable()
    .optional(),
  guardEnabled: z.boolean().optional(),
  directionNote: z.string().nullable().optional(),
  /** null이면 Hub 기본 허용 도구 목록 */
  allowedTools: z.array(z.string().min(1)).nullable().optional(),
  /** push 전 검사 명령 (화면의 "가드") */
  checkCmd: z.string().nullable().optional(),
  worktreeRoot: z.string().startsWith('/', '절대 경로여야 합니다').nullable().optional(),
  description: z.string().nullable().optional(),
  links: z.record(z.string(), z.string().url()).optional(),
  stack: z.string().nullable().optional(),
  stages: stagesSchema.optional(),
  stage: z.string().nullable().optional(),
  lifecycle: z.enum(APP_LIFECYCLES).optional(),
});
export type CreateAppInput = z.infer<typeof createAppSchema>;

export const updateAppSchema = createAppSchema.omit({ code: true }).partial();
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
