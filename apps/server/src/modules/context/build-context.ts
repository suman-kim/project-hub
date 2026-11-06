export interface ContextInput {
  cwd: string;
  source: string;
  app: { code: string; name: string } | null;
  /** HUB_TASK_ID로 넘어왔지만 DB에 없는 ID */
  unknownTaskId: string | null;
  task: { id: string; title: string; status: string; specs: Array<{ id: number; kind: string; title: string }> } | null;
  openTasks: Array<{ id: string; title: string; status: string }>;
  mistakes: Array<{ what: string; correctWay: string }>;
  /** 보관함 문서(모든 앱 공통 + 이 앱 전용). 키 값 원문은 넣지 않는다 */
  myDocs?: Array<{ title: string; kind: string; secret: string; expires: string | null; scope?: '공통' | '이 앱' }>;
  /** task: task가 연결되기 전까지 수정을 막는다, register: 등록 안 된 프로젝트 폴더라 막는다 */
  guard?: 'task' | 'register' | null;
}

const GUARD_LINE = {
  task: '진행 중인 task가 연결되기 전에는 파일 수정과 Bash가 막힌다. 맞는 task를 update_task_status로 doing으로 바꾸거나, 없으면 create_tasks로 만든 뒤 doing으로 바꾼다.',
  register: '등록되기 전에는 파일 수정과 Bash가 막힌다. 사용자에게 Hub 대시보드 사이드바의 "앱" 옆 + 버튼으로 이 프로젝트를 등록하자고 안내한다.',
};

/**
 * [Hub context] 블록을 만든다. 순서는 앱 → 이 세션의 task → 열린 task → 실수 기록 → 보관함 문서로 고정한다.
 * 상한을 넘으면 뒤에서부터 줄 단위로 잘라 앞쪽의 중요한 내용을 남긴다.
 */
export function buildContext(input: ContextInput, maxChars: number): string {
  const lines = ['[Hub context]'];
  if (!input.app) {
    lines.push(`이 작업 폴더(${input.cwd})는 Hub에 등록된 앱이 아니다.`);
    if (input.guard === 'register') lines.push(GUARD_LINE.register);
    return truncateLines(lines, maxChars);
  }

  lines.push(`앱: ${input.app.name} (${input.app.code})`);
  lines.push(`세션 시작 방식: ${input.source}`);

  if (input.task) {
    lines.push(`이 세션의 task: ${input.task.id} ${input.task.title} (상태: ${input.task.status})`);
    if (input.task.specs.length) {
      lines.push('이 task의 문서가 Hub에 있다. get_spec으로 읽는다:');
      for (const s of input.task.specs) lines.push(`- spec id ${s.id} [${s.kind}] ${s.title}`);
    } else {
      lines.push('이 task에 연결된 기획 명세나 인수인계 문서는 없다.');
    }
  } else if (input.unknownTaskId) {
    lines.push(`HUB_TASK_ID ${input.unknownTaskId}는 Hub에 없는 task다. 이 세션에 연결된 task는 없다.`);
  } else {
    lines.push('이 세션에 연결된 task는 아직 없다.');
  }
  if (input.guard === 'task') lines.push(GUARD_LINE.task);

  if (input.openTasks.length) {
    lines.push('이 앱의 다른 열린 task:');
    for (const t of input.openTasks) lines.push(`- ${t.id} ${t.title} (${t.status})`);
  }

  if (input.mistakes.length) {
    lines.push('이 앱에서 기록된 실수:');
    for (const m of input.mistakes) lines.push(`- ${m.what} → ${m.correctWay}`);
  }

  if (input.myDocs?.length) {
    lines.push('보관함 (모든 앱 공통과 이 앱 전용 계정·키·결제·도메인. 키 값은 Hub에만 있고 여기에는 위치나 끝 4자리만 있다):');
    for (const d of input.myDocs) lines.push(`- [${d.scope ? `${d.scope} · ` : ''}${d.kind}] ${d.title}${d.secret ? ` · ${d.secret}` : ''}${d.expires ? ` · ${d.expires}` : ''}`);
  }
  return truncateLines(lines, maxChars);
}

export function truncateLines(lines: string[], maxChars: number): string {
  const out = [...lines];
  while (out.length > 1 && out.join('\n').length > maxChars) out.pop();
  const text = out.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
