import { z } from 'zod';
import { TASK_SIZES, type IdeaBody } from '@hub/shared';

/** 새 앱 기획 run의 출력 스키마. 필드 이름은 claude가 읽기 쉽게 snake_case로 둔다. */
export const CONCEPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '앱 기획 제목 (한 줄)' },
    one_liner: { type: 'string', description: '한 문장 소개' },
    target_users: { type: 'string', description: '누가 쓰는가' },
    problem: { type: 'string', description: '그 사용자가 겪는 문제' },
    solution: { type: 'string', description: '어떻게 해결하는가' },
    mvp_features: { type: 'array', items: { type: 'string' }, description: 'MVP에 꼭 들어갈 기능' },
    scenarios: { type: 'array', items: { type: 'string' }, description: '사용 시나리오' },
    mvp_spec: { type: 'string', description: 'MVP 명세 (markdown): 화면, 데이터, 외부 연동' },
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, url: { type: 'string' }, difference: { type: 'string', description: '이 앱과 무엇이 다른가' } },
        required: ['name', 'difference'],
      },
      description: '웹 조사로 찾은 비슷한 서비스',
    },
    market: { type: 'string', description: '시장과 수요에 대한 조사 요약' },
    monetization: { type: 'string', description: '수익 모델' },
    tech_stack: { type: 'string', description: '추천 기술 스택과 이유' },
    risks: { type: 'array', items: { type: 'string' } },
    validation: { type: 'string', description: '만들기 전에 수요를 싸게 확인하는 방법' },
    app: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '대문자 2~4자 앱 코드. task ID 앞부분이 된다' },
        name: { type: 'string', description: '앱 이름' },
        folder: { type: 'string', description: '로컬 폴더와 GitHub 저장소 이름. 영문 소문자, 숫자, 하이픈' },
      },
      required: ['code', 'name', 'folder'],
    },
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
    alternatives: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, one_liner: { type: 'string' } }, required: ['title', 'one_liner'] },
      description: '깊게 쓰지 않은 다른 후보 2~4개',
    },
    sources: { type: 'array', items: { type: 'string' }, description: '참고한 웹 페이지 URL' },
    change_summary: { type: 'string', description: '수정 요청을 반영한 버전일 때만: 앞 버전에서 무엇이 바뀌었는지 한두 문장' },
  },
  required: [
    'title', 'one_liner', 'target_users', 'problem', 'solution', 'mvp_features', 'scenarios', 'mvp_spec', 'competitors',
    'market', 'monetization', 'tech_stack', 'risks', 'validation', 'app', 'expected_tasks', 'alternatives', 'sources',
  ],
} as const;

export const APP_CODE = /^[A-Z]{2,4}$/;
export const APP_FOLDER = /^[a-z0-9][a-z0-9-]{0,62}$/;

const conceptOutputSchema = z.object({
  title: z.string().min(1),
  one_liner: z.string().min(1),
  target_users: z.string().default(''),
  problem: z.string().min(1),
  solution: z.string().min(1),
  mvp_features: z.array(z.string()).default([]),
  scenarios: z.array(z.string()).default([]),
  mvp_spec: z.string().default(''),
  competitors: z.array(z.object({ name: z.string(), url: z.string().optional(), difference: z.string().default('') })).default([]),
  market: z.string().default(''),
  monetization: z.string().default(''),
  tech_stack: z.string().default(''),
  risks: z.array(z.string()).default([]),
  validation: z.string().default(''),
  app: z.object({ code: z.string(), name: z.string(), folder: z.string() }),
  expected_tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        size: z.enum(TASK_SIZES).optional(),
        depends_on_index: z.array(z.number().int()).optional(),
      }),
    )
    .max(12)
    .default([]),
  alternatives: z.array(z.object({ title: z.string(), one_liner: z.string() })).max(6).default([]),
  sources: z.array(z.string()).default([]),
  change_summary: z.string().optional(),
});

/** claude의 구조화 출력을 새 앱 기획 본문으로 바꾼다. 형식이 맞지 않으면 null */
export function parseConceptOutput(structured: unknown): { title: string; body: IdeaBody } | null {
  const parsed = conceptOutputSchema.safeParse(structured);
  if (!parsed.success) return null;
  const o = parsed.data;
  return {
    title: o.title,
    body: {
      problem: o.problem,
      proposal: o.solution,
      scenarios: o.scenarios,
      spec: o.mvp_spec,
      ...(o.change_summary ? { changeSummary: o.change_summary } : {}),
      expectedTasks: o.expected_tasks.map((t) => ({ title: t.title, description: t.description, size: t.size, dependsOnIndex: t.depends_on_index })),
      concept: {
        oneLiner: o.one_liner,
        targetUsers: o.target_users,
        mvpFeatures: o.mvp_features,
        competitors: o.competitors,
        market: o.market,
        monetization: o.monetization,
        techStack: o.tech_stack,
        risks: o.risks,
        validation: o.validation,
        // 형식이 어긋나도 승인할 때 고칠 수 있게 그대로 둔다. 검사는 승인할 때 한다.
        app: { code: o.app.code.trim().toUpperCase(), name: o.app.name.trim(), folder: o.app.folder.trim().toLowerCase() },
        alternatives: o.alternatives.map((a) => ({ title: a.title, oneLiner: a.one_liner })),
        sources: o.sources,
      },
    },
  };
}

export interface ConceptPromptContext {
  directionNote: string | null;
  /** 이번 생성에만 덧붙인 요청 */
  note: string | null;
  /** 다른 기획의 후보를 골라 깊게 쓰는 경우 */
  seed: { title: string; oneLiner: string } | null;
  myApps: Array<{ code: string; name: string; repoPath: string | null; directionNote: string | null }>;
  /** 이미 쓰고 있는 폴더 이름 (새 앱 폴더와 겹치면 안 된다) */
  takenFolders: string[];
  recentConcepts: Array<{ id: number; title: string; status: string; rejectReason: string | null }>;
}

function contextSections(ctx: ConceptPromptContext): string[] {
  const parts = ['## 구상 방향', ctx.directionNote?.trim() || '(방향 메모 없음. 아래 내 앱들을 보고 내가 잘 만들 수 있는 쪽으로 판단한다.)', ''];
  if (ctx.note?.trim()) parts.push('## 이번 요청', ctx.note.trim(), '');

  parts.push('## 내가 이미 만들고 있는 앱 (겹치지 않게, 익숙한 스택 파악용)');
  for (const a of ctx.myApps) {
    parts.push(`- ${a.code} ${a.name}${a.repoPath ? ` — ${a.repoPath} (README.md, CLAUDE.md를 읽어 볼 수 있다)` : ''}${a.directionNote ? ` · 방향: ${a.directionNote}` : ''}`);
  }
  if (!ctx.myApps.length) parts.push('(없음)');
  parts.push('', `이미 쓰는 앱 코드: ${ctx.myApps.map((a) => a.code).join(', ') || '(없음)'}`);
  parts.push(`이미 있는 폴더 이름: ${ctx.takenFolders.join(', ') || '(없음)'}`, '');

  parts.push('## 최근 새 앱 기획');
  if (ctx.recentConcepts.length) {
    for (const i of ctx.recentConcepts) {
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
  '- WebSearch와 WebFetch로 비슷한 서비스와 시장을 반드시 조사하고, competitors와 market에 근거로 쓴다. 참고한 URL은 sources에 넣는다.',
  '- 내 앱 저장소는 Read, Grep, Glob으로 읽기만 한다. 파일은 만들거나 고치지 않는다.',
  '- 혼자 몇 주 안에 MVP를 낼 수 있는 크기로 정한다. 예상 task는 3~8개, 크기는 S(반나절)/M(하루)/L(며칠).',
  '- 첫 task는 프로젝트 뼈대다: 고른 스택으로 실행되는 최소 앱, 테스트 1개, README의 실행 방법.',
  '- 예상 task는 그대로 실행할 수 있게 제목과 설명(완료 조건 포함)을 구체적으로 쓴다.',
  '- app.code는 대문자 2~4자로 이미 쓰는 코드와 겹치지 않게, app.folder는 영문 소문자·숫자·하이픈으로 이미 있는 폴더와 겹치지 않게 정한다. folder는 GitHub 저장소 이름이 된다.',
  '- alternatives에는 이번에 깊게 쓰지 않은 다른 후보 2~4개를 제목과 한 줄로 넣는다.',
];

/** 새 앱 기획 하나를 만드는 프롬프트 */
export function buildConceptPrompt(ctx: ConceptPromptContext): string {
  const goal = ctx.seed
    ? `다음 후보를 깊게 기획한다: "${ctx.seed.title}" — ${ctx.seed.oneLiner}`
    : '아직 없는 새 앱 하나를 구상해 기획한다.';
  return [
    `너는 Hub가 띄운 새 앱 기획 세션이다. ${goal}`,
    '',
    ...contextSections(ctx),
    '',
    ...RULES,
    '',
    '## 출력',
    'JSON 스키마에 맞춰 낸다.',
  ].join('\n');
}

/** 수정 요청을 반영한 다음 버전을 만드는 프롬프트 */
export function buildConceptRevisePrompt(
  ctx: ConceptPromptContext,
  idea: { id: number; title: string; version: number; body: IdeaBody },
  note: string,
): string {
  return [
    `너는 Hub가 띄운 새 앱 기획 세션이다. 새 앱 기획 #${idea.id}에 수정 요청이 왔다. 요청을 반영한 다음 버전을 만든다.`,
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
