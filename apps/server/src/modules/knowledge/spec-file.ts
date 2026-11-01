import { HUB_TIMEZONE } from '../../config/hub-config';

/** Hub 문서를 프로젝트에 쓰는 곳 (앱 폴더 기준) */
export const SPEC_DIR = ['docs', 'hub'] as const;

const KIND_LABEL: Record<string, string> = { spec: '기획 명세', handoff: '인수인계' };

/** 같은 문서는 번호 앞부분으로 찾는다. 제목이 바뀌면 파일 이름도 바뀐다 */
export const specFilePrefix = (id: number) => `${String(id).padStart(4, '0')}-`;

/** 0004-인수인계-task-100-강제-가드.md. 글자·숫자만 남기고 나머지는 -로 */
export function specFileName(id: number, title: string): string {
  const slug = title
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${specFilePrefix(id)}${slug || 'doc'}.md`;
}

/** 파일 머리에 Hub 사본이라는 것과 출처를 적는다. 본문이 이미 제목으로 시작하면 제목을 다시 넣지 않는다 */
export function renderSpecFile(s: { id: number; kind: string; title: string; body: string; taskId: string | null; ideaId: number | null; updatedAt: Date }): string {
  const when = new Intl.DateTimeFormat('sv-SE', { timeZone: HUB_TIMEZONE, dateStyle: 'short', timeStyle: 'short' }).format(s.updatedAt);
  const from = [s.taskId ? `task ${s.taskId}` : null, s.ideaId ? `기획 #${s.ideaId}` : null].filter(Boolean).join(' · ');
  const head = [
    `<!-- Hub 문서 #${s.id}의 사본. Hub에 저장할 때마다 다시 쓰니, 고칠 때는 Hub(save_spec)에서 고친다. -->`,
    ...(/^\s*#\s/.test(s.body) ? [] : [`# ${s.title}`, '']),
    `> ${KIND_LABEL[s.kind] ?? s.kind}${from ? ` · ${from}` : ''} · ${when} 저장`,
    '',
  ];
  return `${head.join('\n')}\n${s.body.trim()}\n`;
}
