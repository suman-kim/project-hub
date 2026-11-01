import type { ChatItem } from '@hub/shared';
import { redactText } from '../../common/redact';
import { isHubQuoteLine } from './hub-message';

/** 한 메시지와 도구 결과를 화면에 보낼 때의 최대 길이 */
const TEXT_MAX = 20_000;
const RESULT_MAX = 4_000;
const SUMMARY_MAX = 300;

/** 도구 입력에서 한 줄 요약으로 쓸 값 (앞에 있는 것부터) */
const SUMMARY_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill', 'id'];

type Row = Record<string, any>;
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…(${s.length}자 중 잘림)` : s);
const clean = (s: string, max: number) => clip(redactText(s), max);

/** 도구 결과 content는 문자열이거나 블록 배열이다 */
function contentText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((b: Row) => (b?.type === 'text' ? String(b.text ?? '') : b?.type === 'image' ? '[이미지]' : '')).filter(Boolean).join('\n');
}

export function toolSummary(name: string, input: Row | undefined): string {
  const i = input ?? {};
  if (name.endsWith('__update_task_status')) return `${i.id ?? ''} → ${i.status ?? ''}`.trim();
  const key = SUMMARY_KEYS.find((k) => typeof i[k] === 'string' && i[k]);
  const text = key ? String(i[key]) : Object.entries(i).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Claude Code 대화 기록(~/.claude/projects/…/<세션>.jsonl)을 줄 단위로 받아 대화 화면 줄로 바꾼다.
 * 파일 끝에 줄이 붙으면 add를 이어 부르면 된다(도구 결과는 앞서 나온 도구 줄에 붙인다).
 * - 사람이 보낸 메시지: 문자열 user 줄, 작업 중에 보낸 메시지(queued_command 첨부, origin human)
 * - 빼는 것: 하위 에이전트(isSidechain), 메타 줄, 생각(thinking), 백그라운드 알림, 시스템 첨부
 */
export class TranscriptChat {
  readonly items: ChatItem[] = [];
  private readonly tools = new Map<string, ToolItem>();
  private readonly seen = new Set<string>();
  private seq = 0;

  add(row: Row): void {
    if (!row || row.isSidechain) return;
    switch (row.type) {
      case 'user':
        return this.user(row);
      case 'assistant':
        return this.assistant(row);
      case 'attachment': {
        const a = row.attachment;
        if (a?.type === 'queued_command' && a.origin?.kind === 'human') {
          const blocks: Row[] = Array.isArray(a.prompt) ? a.prompt : [];
          const text = typeof a.prompt === 'string' ? a.prompt : blocks.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n');
          this.userText(row, text, blocks.filter((b) => b?.type === 'image').length);
        }
        return;
      }
      case 'system':
        if (row.subtype === 'compact_boundary') this.note(row, '이전 대화를 요약하고 이어 갔어요', 'muted');
        return;
    }
  }

  private id(row: Row, suffix = ''): string {
    return `${row.uuid ?? `r${this.seq++}`}${suffix}`;
  }

  private note(row: Row, text: string, tone: Extract<ChatItem, { kind: 'note' }>['tone']): void {
    this.items.push({ kind: 'note', id: this.id(row, ':n'), at: row.timestamp ?? null, text, tone });
  }

  private user(row: Row): void {
    if (row.isMeta) return;
    // 백그라운드 작업 알림 등 사람이 보내지 않은 메시지
    if (row.origin?.kind && row.origin.kind !== 'human') return;
    if (row.isCompactSummary) return this.note(row, '이전 대화를 요약하고 이어 갔어요', 'muted');
    const c = row.message?.content;
    if (typeof c === 'string') return this.userText(row, c, 0);
    if (!Array.isArray(c)) return;
    const texts: string[] = [];
    let images = 0;
    for (const b of c as Row[]) {
      if (b?.type === 'tool_result') this.toolResult(b);
      else if (b?.type === 'text' && b.text) texts.push(String(b.text));
      else if (b?.type === 'image') images += 1;
    }
    if (texts.length || images) this.userText(row, texts.join('\n'), images);
  }

  private userText(row: Row, raw: string, images: number): void {
    // 대시보드에서 보낸 메시지의 전달문은 DB의 메시지로 보여 주므로 뺀다.
    if (raw.includes('[Hub 메시지 #')) return;
    if (/^\s*<(local-command-caveat|local-command-stdout|local-command-stderr|bash-stdout|bash-stderr|task-notification)>/.test(raw)) return;
    const cmd = /<command-name>([^<]+)<\/command-name>/.exec(raw);
    if (cmd) {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim();
      return this.note(row, `${cmd[1].trim()}${args ? ` ${clip(args, 200)}` : ''} 실행`, 'muted');
    }
    const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(raw);
    const text = bash ? `! ${bash[1].trim()}` : raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!text && !images) return;
    const id = this.id(row, ':u');
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.items.push({ kind: 'user', id, at: row.timestamp ?? null, text: clean(text, TEXT_MAX), from: 'me', images });
  }

  private assistant(row: Row): void {
    const m = row.message;
    if (!m || !Array.isArray(m.content)) return;
    (m.content as Row[]).forEach((b, i) => {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        // 한 응답이 블록마다 따로 기록되므로 응답 id와 블록 번호로 한 번만 넣는다.
        const id = `${m.id ?? row.uuid}:${row.apiBlockIndex ?? i}`;
        if (this.seen.has(id)) return;
        this.seen.add(id);
        // 대시보드 메시지 인용 줄은 사용자 말풍선(DB 메시지)과 겹치므로 뺀다.
        const text = b.text.split('\n').filter((l: string) => !isHubQuoteLine(l)).join('\n').trim();
        if (text) this.items.push({ kind: 'assistant', id, at: row.timestamp ?? null, text: clean(text, TEXT_MAX) });
      } else if (b?.type === 'tool_use' && b.id && !this.tools.has(b.id)) {
        const item: ToolItem = { kind: 'tool', id: String(b.id), at: row.timestamp ?? null, name: String(b.name ?? 'tool'), summary: clean(toolSummary(String(b.name ?? ''), b.input), SUMMARY_MAX), result: null, error: false };
        this.tools.set(item.id, item);
        this.items.push(item);
      }
    });
  }

  private toolResult(b: Row): void {
    const t = this.tools.get(String(b.tool_use_id));
    if (!t) return;
    t.result = clean(contentText(b.content), RESULT_MAX);
    t.error = !!b.is_error;
  }
}
