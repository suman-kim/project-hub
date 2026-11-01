import type { TaskNote, TaskStatus } from '@hub/shared';
import type { Task } from '../tasks/task.entity';
import type { Spec } from './spec.entity';

const STATUS: Record<TaskStatus, string> = { todo: '할 일', doing: '진행 중', input: '답변 대기', review: '리뷰', done: '완료', cancelled: '취소' };
const TYPE: Record<string, string> = { feature: '기능', bug: '버그', chore: '잡무' };
const PRIORITY: Record<number, string> = { 1: '높음', 2: '보통', 3: '낮음' };

/** 세션 메시지 한 건에 실리도록 전체 길이를 줄인다(hook으로 넣는 맥락은 길면 잘린다) */
export const BRIEF_MAX = 8000;
/** 문서 본문은 앞부분만 싣고, 전문은 get_spec으로 읽게 한다 */
const SPEC_EXCERPT = 1500;
const NOTES_MAX = 10;

export interface TaskBriefInput {
  task: Task;
  repo: { name: string; path: string } | null;
  deps: Array<{ id: string; title: string; status: TaskStatus }>;
  specs: Spec[];
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function clip(text: string, max: number): { text: string; cut: boolean } {
  const t = text.trim();
  return t.length > max ? { text: `${t.slice(0, max).trimEnd()}…`, cut: true } : { text: t, cut: false };
}

/**
 * task 하나를 다른 세션(Hub에 연결되지 않은 세션, 웹 앱 포함)에 넘길 글로 만든다.
 * task 패널의 "task 정보 복사"와 "이 세션에서 진행하기"의 입력창 채우기가 같은 글을 쓴다.
 */
export function renderTaskBrief({ task: t, repo, deps, specs }: TaskBriefInput): string {
  const meta = [
    `- 앱: ${t.app.name} (${t.app.code})${repo ? ` · 저장소 ${repo.name} (${repo.path})` : t.app.repoPath ? ` · 폴더 ${t.app.repoPath}` : ''}`,
    `- 상태: ${STATUS[t.status]} · 종류 ${TYPE[t.type] ?? t.type}${t.size ? ` · 크기 ${t.size}` : ''}${t.stage ? ` · 단계 ${t.app.stages?.find((st) => st.key === t.stage)?.name ?? t.stage}` : ''}${t.priority ? ` · 우선순위 ${PRIORITY[t.priority] ?? t.priority}` : ''}`,
  ];
  if (t.branch || t.prUrl) meta.push(`- ${[t.branch && `브랜치 ${t.branch}`, t.prUrl && `PR ${t.prUrl}`].filter(Boolean).join(' · ')}`);
  if (t.ideaId) meta.push(`- 출처 기획: #${t.ideaId}`);

  const out = ['아래 Hub task를 이 세션에서 진행해 줘.', '', `## ${t.id} · ${t.title}`, ...meta];

  out.push('', '### 설명', t.description?.trim() || '(설명 없음)');

  const bug = t.metadata.bug as { severity?: string; steps?: string; expected?: string; actual?: string; env?: string; version?: string } | undefined;
  if (t.type === 'bug' && bug) {
    const rows = (
      [
        ['심각도', bug.severity],
        ['재현 단계', bug.steps],
        ['기대 결과', bug.expected],
        ['실제 결과', bug.actual],
        ['환경', bug.env],
        ['버전', bug.version],
      ] as const
    ).filter(([, v]) => v);
    if (rows.length) out.push('', '### 버그 정보', ...rows.map(([k, v]) => `- ${k}: ${v}`));
  }

  if (deps.length) out.push('', '### 선행 task', ...deps.map((d) => `- ${d.id} ${d.title} (${STATUS[d.status]})`));

  const notes = (t.metadata.notes as TaskNote[] | undefined) ?? [];
  if (notes.length) {
    out.push('', `### 진행 메모${notes.length > NOTES_MAX ? ` (최근 ${NOTES_MAX}개)` : ''}`);
    for (const n of notes.slice(-NOTES_MAX)) out.push(`- ${stamp(n.ts)} [${STATUS[n.status] ?? n.status}] ${n.note.trim().replace(/\n+/g, ' / ')}`);
  }

  if (specs.length) {
    out.push('', '### 연결 문서');
    for (const s of specs) {
      const body = clip(s.body, SPEC_EXCERPT);
      out.push('', `#### [${s.kind === 'spec' ? '명세' : '인수인계'}] ${s.title} (spec ${s.id})`, body.text);
      if (body.cut) out.push(`(앞부분만 실었다 · 전문은 get_spec ${s.id})`);
    }
  }

  out.push(
    '',
    '### 진행 방법',
    `1. Hub에 연결된 세션이면 update_task_status로 이 task(${t.id})를 doing으로 바꾸고 시작한다.`,
    '2. 구현하고 테스트를 돌린다. 판단이 필요한 질문이 생기면 input으로 바꾸고 메모에 질문을 남긴 뒤 묻는다.',
    '3. 끝나면 테스트 결과를 메모에 남기고 review로 넘긴다. main에 직접 push하지 않는다.',
  );

  const text = out.join('\n');
  return text.length > BRIEF_MAX ? `${text.slice(0, BRIEF_MAX - 40).trimEnd()}\n…(길어서 잘랐다 · get_task ${t.id})` : text;
}
