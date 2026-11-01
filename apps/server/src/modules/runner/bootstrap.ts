import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import type { AppConcept, IdeaBody } from '@hub/shared';

/** 새 앱 시작 세션에 더 허용하는 도구. push와 PR은 hub/ 브랜치로만 한다. */
export const RC_EXTRA_TOOLS = [
  'mcp__hub__update_task_status',
  'mcp__hub__create_tasks',
  'Bash(git checkout -b hub/*)',
  'Bash(git switch -c hub/*)',
  'Bash(git push -u origin hub/*)',
  'Bash(git push origin hub/*)',
  'Bash(gh pr create *)',
  'WebSearch',
  'WebFetch',
];

export function renderReadme(title: string, body: IdeaBody, appCode: string): string {
  const c = body.concept;
  const parts = [`# ${title}`, ''];
  if (c) parts.push(c.oneLiner, '');
  parts.push('## 문제', body.problem, '', '## 해결 방식', body.proposal);
  if (c?.mvpFeatures.length) parts.push('', '## MVP 핵심 기능', ...c.mvpFeatures.map((f) => `- ${f}`));
  parts.push('', '## 실행 방법', '', '(첫 task에서 채운다)', '', '---', '', `기획 전문은 [docs/concept.md](docs/concept.md). 이 저장소는 Hub 앱 \`${appCode}\`로 관리한다.`, '');
  return parts.join('\n');
}

export function renderClaudeMd(app: { code: string; name: string }, ideaId: number, concept: AppConcept | undefined): string {
  return [
    `# ${app.name} (${app.code})`,
    '',
    `- 기획 전문: docs/concept.md (Hub 기획 #${ideaId})`,
    `- Hub task ID는 \`${app.code}-<번호>\`다. 작업 브랜치는 \`hub/<task ID>-<slug>\`로 만들고 main에 직접 커밋하거나 push하지 않는다.`,
    ...(concept?.techStack ? [`- 기술 스택: ${concept.techStack}`] : []),
    '',
  ].join('\n');
}

export interface BootstrapPromptInput {
  app: { code: string; name: string };
  oneLiner: string;
  repoUrl: string;
  tasks: Array<{ id: string; title: string; size: string | null; dependsOn: string[] }>;
  first: { id: string; title: string };
}

/** claude --rc로 띄우는 새 앱 시작 세션의 첫 메시지 */
export function buildBootstrapPrompt(i: BootstrapPromptInput): string {
  return [
    `너는 Hub가 새 앱 ${i.app.name}(${i.app.code})을 시작하려고 띄운 세션이다. 사용자는 Remote Control(claude.ai, 휴대폰 앱)로 이 세션을 보고 답한다.`,
    '',
    '## 기획',
    `docs/concept.md에 승인된 기획 전문이 있다. 먼저 읽는다. 요약: ${i.oneLiner}`,
    `GitHub 저장소: ${i.repoUrl} (main에 첫 커밋이 올라가 있다)`,
    '',
    '## Hub task',
    ...i.tasks.map((t) => `- ${t.id} ${t.title}${t.size ? ` (${t.size})` : ''}${t.dependsOn.length ? ` · 먼저: ${t.dependsOn.join(', ')}` : ''}`),
    '',
    '## 진행 순서',
    '1. UI 디자인: 화면이 있는 앱이면 구현 전에 주요 화면의 UI 디자인부터 만든다. Artifact 도구가 있으면 Design 유형으로 만들고, 없으면 docs/design/에 HTML 시안을 만든다. 링크나 경로를 알려 주고 사용자 확인을 받은 뒤 다음으로 넘어간다. 화면이 없는 앱이면 건너뛴다.',
    `2. 첫 task ${i.first.id} "${i.first.title}": \`hub/${i.first.id}-<영문 slug>\` 브랜치를 만들어 작업한다. main에 직접 커밋하거나 push하지 않는다.`,
    '3. 테스트를 돌린 뒤 커밋하고, `git push -u origin <브랜치>`와 `gh pr create`로 PR을 만든다.',
    `4. Hub가 ${i.first.id}를 doing으로 바꿔 두었다. PR을 만들면 Hub MCP의 update_task_status로 테스트 결과와 PR 링크를 메모에 적고 review로 바꾼다. Hub MCP가 없으면 그 내용을 마지막에 정리해 알려 준다.`,
    '5. PR을 만들면 무엇을 했는지 요약하고, 다음 task로 넘어갈지 사용자에게 묻는다.',
    '',
    '막히거나 결정이 필요하면 추측하지 말고 사용자에게 묻는다.',
  ].join('\n');
}

/** Claude Code가 새 프로젝트 항목에 기본으로 두는 값 */
const PROJECT_DEFAULTS = {
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false,
};

/**
 * Hub가 방금 만든 폴더를 Claude Code 작업 공간 신뢰 목록(~/.claude.json)에 올린다.
 * 백그라운드 세션(claude --bg)은 신뢰하지 않은 폴더에서 시작을 거부하기 때문이다.
 * 다른 Claude 프로세스도 이 파일을 쓰므로 쓰기 직전에 다시 읽고, 임시 파일 + rename으로 한 번에 바꾼다.
 */
export function markWorkspaceTrusted(claudeJsonPath: string, dir: string): void {
  const file = existsSync(claudeJsonPath) ? realpathSync(claudeJsonPath) : claudeJsonPath;
  const data = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as { projects?: Record<string, Record<string, unknown>> };
  const projects = (data.projects ??= {});
  projects[dir] = { ...PROJECT_DEFAULTS, ...(projects[dir] ?? {}), hasTrustDialogAccepted: true };
  const tmp = `${file}.hub-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** ~/.claude.json에 hub MCP가 사용자 범위로 등록되어 있는지 */
export function hubMcpRegistered(claudeJsonPath: string): boolean {
  try {
    const data = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
    return Boolean(data.mcpServers?.hub);
  } catch {
    return false;
  }
}
