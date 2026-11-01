export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'needs_input'] },
    summary: { type: 'string', description: '한 일과 결과. PR 본문에 들어간다' },
    question: { type: 'string', description: 'needs_input일 때 사용자에게 물을 질문' },
  },
  required: ['status', 'summary'],
} as const;

export interface PromptInput {
  task: { id: string; title: string; description: string | null };
  app: { code: string; name: string; defaultBranch: string };
  branch: string;
  specs: Array<{ kind: string; title: string; body: string }>;
}

const SPEC_MAX = 6000;

/** task 하나를 구현하게 하는 첫 프롬프트 */
export function buildTaskPrompt({ task, app, branch, specs }: PromptInput): string {
  const parts = [
    `너는 Hub가 띄운 세션이다. ${app.name}(${app.code}) 앱의 task ${task.id}를 구현한다.`,
    `작업 위치는 이 task 전용 git worktree이고, 브랜치는 ${branch}다 (기준: ${app.defaultBranch}).`,
    '',
    `## task ${task.id}: ${task.title}`,
    task.description?.trim() || '(설명 없음)',
  ];

  for (const s of specs) {
    const body = s.body.length > SPEC_MAX ? `${s.body.slice(0, SPEC_MAX)}\n…(이하 생략, get_spec으로 전문을 읽는다)` : s.body;
    parts.push('', `## ${s.kind === 'handoff' ? '인수인계' : '기획 명세'}: ${s.title}`, body);
  }

  parts.push(
    '',
    '## 완료 조건',
    '- 저장소의 기존 구조와 관례를 따른다. 저장소의 CLAUDE.md가 있으면 먼저 읽는다.',
    '- 관련 테스트를 돌려 통과시킨다. 테스트를 돌릴 수 없으면 그 이유를 summary에 적는다.',
    `- 변경을 이 브랜치에 커밋한다. 커밋 메시지는 "${task.id}: "로 시작한다.`,
    '- push, PR 생성, Hub task 상태 변경은 하지 않는다. Hub가 한다.',
    '- 작업 규칙의 Hub task 갱신(doing·review 변경, 테스트 결과 메모)은 이 세션에서는 Hub runner가 대신 한다. update_task_status를 찾거나 부르지 않는다.',
    '- DB 스키마나 아키텍처를 바꿔야 하거나, 요구사항이 모호해 결정이 필요하면 구현하지 말고 질문한다.',
    '',
    '## 출력',
    '- 끝까지 구현하고 커밋했으면 status "done"과 summary(한 일, 테스트 결과)를 낸다.',
    '- 사용자 답이 있어야 진행할 수 있으면 status "needs_input", question(구체적인 질문), summary(지금까지 한 일)를 낸다.',
  );
  return parts.join('\n');
}

/** 질문에 대한 답변으로 같은 세션을 이어 갈 때의 프롬프트 */
export function buildAnswerPrompt(answer: string): string {
  return [
    '사용자의 답변:',
    answer,
    '',
    '이 답을 반영해 task를 이어서 진행한다. 완료 조건과 출력 형식은 처음 지시와 같다.',
  ].join('\n');
}
