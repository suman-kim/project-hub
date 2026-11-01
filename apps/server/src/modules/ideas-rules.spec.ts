import { canTransitionIdea } from '@hub/shared';
import { renderIdeaSpec } from './ideas/ideas.service';
import { buildIdeaPrompt, buildRevisePrompt, parseIdeaOutput } from './runner/idea-gen';
import { parseRulesFile, renderRulesFile } from './rules/rules-file';

describe('기획 상태 전이', () => {
  it.each([
    ['pending', 'revising', true],
    ['revising', 'pending', true],
    ['pending', 'approved', true],
    ['pending', 'rejected', true],
    ['revising', 'approved', false],
    ['approved', 'pending', false],
    ['rejected', 'revising', false],
  ] as const)('%s → %s: %s', (from, to, ok) => expect(canTransitionIdea(from, to)).toBe(ok));
});

describe('기획 출력 파싱', () => {
  const out = {
    title: '알림 묶음',
    problem: 'p',
    proposal: 'q',
    scenarios: ['s1'],
    spec: '# spec',
    impact: 'i',
    expected_tasks: [
      { title: 'A', description: 'a', size: 'S' },
      { title: 'B', description: 'b', size: 'M', depends_on_index: [0] },
    ],
  };
  it('snake_case 출력을 기획 본문으로', () => {
    expect(parseIdeaOutput(out)).toEqual({
      title: '알림 묶음',
      body: {
        problem: 'p',
        proposal: 'q',
        scenarios: ['s1'],
        spec: '# spec',
        impact: 'i',
        specItems: [],
        impactFiles: [],
        expectedTasks: [
          { title: 'A', description: 'a', size: 'S', dependsOnIndex: undefined },
          { title: 'B', description: 'b', size: 'M', dependsOnIndex: [0] },
        ],
      },
    });
  });
  it('형식이 맞지 않으면 null', () => {
    expect(parseIdeaOutput({ title: 'x' })).toBeNull();
    expect(parseIdeaOutput(undefined)).toBeNull();
  });
  it('명세 markdown', () => {
    const md = renderIdeaSpec('알림 묶음', parseIdeaOutput(out)!.body);
    expect(md).toContain('## 문제\np');
    expect(md).toContain('- B (M)');
  });
});

describe('기획 프롬프트', () => {
  const ctx = {
    app: { code: 'LK', name: 'Link', directionNote: '체류 시간 늘리기' },
    openTasks: [{ id: 'LK-7', title: '배포', status: 'doing' }],
    recentIdeas: [{ id: 3, title: '다크 모드', status: 'rejected', rejectReason: '디자인 시스템 개편 후에' }],
  };
  it('방향성, 열린 task, 반려 사유가 들어간다', () => {
    const p = buildIdeaPrompt(ctx);
    expect(p).toContain('체류 시간 늘리기');
    expect(p).toContain('- LK-7 배포 (doing)');
    expect(p).toContain('반려 사유: 디자인 시스템 개편 후에');
  });
  it('수정 프롬프트에 이전 버전과 요청이 들어간다', () => {
    const p = buildRevisePrompt(ctx, { id: 5, title: 't', version: 2, body: { problem: 'pp', proposal: 'qq' } }, '범위를 줄여 줘');
    expect(p).toContain('기획 #5 v2');
    expect(p).toContain('"problem": "pp"');
    expect(p).toContain('## 수정 요청\n범위를 줄여 줘');
  });
});

describe('규칙 파일', () => {
  const current = `# 작업 규칙

<!-- 초안. 나중에는 Hub의 "규칙" 화면에서 편집하고,
Hub가 이 파일을 다시 써 준다. -->

1. 코드를 바꾸기 전에 Hub task부터 갱신한다.
2. 큰 기능을 끝낼 때는 \`save_spec\`으로 인수인계 문서를 남긴다.
`;
  it('지금 쓰는 초안 형식을 읽는다', () => {
    expect(parseRulesFile(current)).toEqual([
      { appCode: null, body: '코드를 바꾸기 전에 Hub task부터 갱신한다.' },
      { appCode: null, body: '큰 기능을 끝낼 때는 `save_spec`으로 인수인계 문서를 남긴다.' },
    ]);
  });
  it('쓰고 다시 읽으면 같다 (앱 규칙, 여러 줄 포함)', () => {
    const rules = [
      { appCode: null, body: '전역 1' },
      { appCode: null, body: '전역 2 첫 줄\n이어지는 줄' },
      { appCode: 'LK', body: 'LK 규칙' },
    ];
    const text = renderRulesFile(rules, new Map([['LK', 'Link']]));
    expect(text).toContain('## Link (LK)에서만');
    expect(text).toContain('2. 전역 2 첫 줄\n   이어지는 줄');
    expect(parseRulesFile(text)).toEqual(rules);
  });
});
