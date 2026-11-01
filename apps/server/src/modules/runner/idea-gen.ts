import { z } from 'zod';
import { TASK_SIZES, type IdeaBody } from '@hub/shared';

/** 아이디어 생성 run의 출력 스키마. 필드 이름은 claude가 읽기 쉽게 snake_case로 둔다. */
export const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '기획 제목 (한 줄)' },
    problem: { type: 'string', description: '지금 무엇이 문제이거나 아쉬운지' },
    proposal: { type: 'string', description: '무엇을 만들거나 바꿀지' },
    scenarios: { type: 'array', items: { type: 'string' }, description: '사용 시나리오' },
    spec: { type: 'string', description: '명세 (markdown). 근거가 된 파일 경로 포함' },
    impact: { type: 'string', description: '영향 범위. DB 스키마·아키텍처 변경이 있으면 명시' },
    spec_items: { type: 'array', items: { type: 'string' }, description: '명세를 한 줄짜리 항목으로 쪼갠 것' },
    impact_files: { type: 'array', items: { type: 'string' }, description: '바뀔 파일 경로' },
    change_summary: { type: 'string', description: '수정 요청을 반영한 버전일 때만: 앞 버전에서 무엇이 바뀌었는지 한두 문장' },
    expected_tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', description: '완료 조건 포함' },
          size: { type: 'string', enum: [...TASK_SIZES] },
          depends_on_index: { type: 'array', items: { type: 'integer' }, description: '이 목록에서 먼저 끝나야 하는 task의 0부터 시작하는 순번' },
        },
        required: ['title', 'description', 'size'],
      },
    },
  },
  required: ['title', 'problem', 'proposal', 'scenarios', 'spec', 'impact', 'expected_tasks'],
} as const;

const ideaOutputSchema = z.object({
  title: z.string().min(1),
  problem: z.string().min(1),
  proposal: z.string().min(1),
  scenarios: z.array(z.string()).default([]),
  spec: z.string().default(''),
  impact: z.string().default(''),
  spec_items: z.array(z.string()).default([]),
  impact_files: z.array(z.string()).default([]),
  change_summary: z.string().optional(),
  expected_tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        size: z.enum(TASK_SIZES).optional(),
        depends_on_index: z.array(z.number().int()).optional(),
      }),
    )
    .max(10)
    .default([]),
});

/** claude의 구조화 출력을 기획 본문으로 바꾼다. 형식이 맞지 않으면 null */
export function parseIdeaOutput(structured: unknown): { title: string; body: IdeaBody } | null {
  const parsed = ideaOutputSchema.safeParse(structured);
  if (!parsed.success) return null;
  const o = parsed.data;
  return {
    title: o.title,
    body: {
      problem: o.problem,
      proposal: o.proposal,
      scenarios: o.scenarios,
      spec: o.spec,
      impact: o.impact,
      specItems: o.spec_items,
      impactFiles: o.impact_files,
      ...(o.change_summary ? { changeSummary: o.change_summary } : {}),
      expectedTasks: o.expected_tasks.map((t) => ({
        title: t.title,
        description: t.description,
        size: t.size,
        dependsOnIndex: t.depends_on_index,
      })),
    },
  };
}

export interface IdeaPromptContext {
  app: { code: string; name: string; directionNote: string | null };
  openTasks: Array<{ id: string; title: string; status: string }>;
  recentIdeas: Array<{ id: number; title: string; status: string; rejectReason: string | null }>;
}

function contextSections(ctx: IdeaPromptContext): string[] {
  const parts = ['## 앱 방향성', ctx.app.directionNote?.trim() || '(방향성 메모 없음. 저장소의 README와 CLAUDE.md로 판단한다.)', ''];
  parts.push('## 이미 있는 열린 task (이것과 겹치지 않게)');
  parts.push(...(ctx.openTasks.length ? ctx.openTasks.map((t) => `- ${t.id} ${t.title} (${t.status})`) : ['(없음)']), '');
  parts.push('## 최근 기획');
  if (ctx.recentIdeas.length) {
    for (const i of ctx.recentIdeas) {
      parts.push(`- #${i.id} [${i.status}] ${i.title}${i.rejectReason ? ` — 반려 사유: ${i.rejectReason}` : ''}`);
    }
    parts.push('반려된 기획과 같은 방향은 다시 내지 않고, 반려 사유를 다음 기획에 반영한다.');
  } else {
    parts.push('(없음)');
  }
  return parts;
}

const RULES = [
  '## 작성 기준',
  '- 읽기 도구(Read, Grep, Glob)로 저장소를 살펴보고, 실제 코드와 구조를 근거로 쓴다. 파일은 고치지 않는다.',
  '- 한 번에 끝낼 수 있는 크기로 정한다. 예상 task는 1~5개, 크기는 S(반나절)/M(하루)/L(며칠).',
  '- 예상 task는 Hub runner가 그대로 실행할 수 있게 제목과 설명(완료 조건 포함)을 구체적으로 쓴다.',
  '- DB 스키마나 아키텍처 변경이 필요하면 영향 범위에 분명히 적는다.',
];

/** 새 기획 하나를 만드는 프롬프트 */
export function buildIdeaPrompt(ctx: IdeaPromptContext): string {
  return [
    `너는 Hub가 띄운 기획 세션이다. ${ctx.app.name}(${ctx.app.code}) 앱의 저장소를 읽고, 다음에 만들 만한 기능이나 개선 하나를 기획한다.`,
    '',
    ...contextSections(ctx),
    '',
    ...RULES,
    '',
    '## 출력',
    'JSON 스키마에 맞춰 title, problem, proposal, scenarios, spec, impact, expected_tasks를 낸다.',
  ].join('\n');
}

/** 수정 요청을 반영한 다음 버전을 만드는 프롬프트 */
export function buildRevisePrompt(
  ctx: IdeaPromptContext,
  idea: { id: number; title: string; version: number; body: IdeaBody },
  note: string,
): string {
  return [
    `너는 Hub가 띄운 기획 세션이다. ${ctx.app.name}(${ctx.app.code}) 앱의 기획 #${idea.id}에 수정 요청이 왔다. 요청을 반영한 다음 버전을 만든다.`,
    '',
    `## 고칠 기획 #${idea.id} v${idea.version}: ${idea.title}`,
    '```json',
    JSON.stringify(idea.body, null, 2),
    '```',
    '',
    '## 수정 요청',
    note,
    '',
    ...contextSections(ctx),
    '',
    ...RULES,
    '',
    '## 출력',
    '요청을 반영한 다음 버전 전체를 JSON 스키마에 맞춰 낸다. 바꾸지 않은 부분도 빠짐없이 다시 쓴다.',
    'change_summary에는 앞 버전에서 무엇이 바뀌었는지 한두 문장으로 쓴다.',
  ].join('\n');
}
