import type { RunResult } from './run.entity';

/** claude -p --output-format stream-json 한 줄 */
export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  kind: string;
  text: string;
}

const TEXT_MAX = 2000;
// 로그 화면에 보일 필요가 없는 잡음. 원본 파일에는 남는다.
const SKIP_SYSTEM = new Set(['hook_started', 'thinking_tokens', 'commands_changed']);

function clip(text: string, max = TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function toolInputSummary(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  for (const key of ['command', 'file_path', 'pattern', 'url', 'description', 'prompt']) {
    if (typeof input[key] === 'string') return input[key] as string;
  }
  return JSON.stringify(input);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('\n');
  }
  return '';
}

/**
 * 스트림 이벤트 하나를 사람이 읽을 로그 줄로 바꾼다. 모르는 이벤트는 type만 남기고 넘어간다.
 * (Claude Code 업데이트로 형식이 바뀌어도 파서가 멈추지 않게 한다)
 */
export function toLogEntries(ev: StreamEvent): LogEntry[] {
  switch (ev.type) {
    case 'system': {
      if (ev.subtype && SKIP_SYSTEM.has(ev.subtype)) return [];
      if (ev.subtype === 'init') return [{ kind: 'system', text: `세션 시작 ${ev.session_id ?? ''} model=${String(ev.model ?? '')}` }];
      if (ev.subtype === 'hook_response') {
        return ev.outcome === 'success' ? [] : [{ kind: 'system', text: `hook ${String(ev.hook_name)} ${String(ev.outcome)}` }];
      }
      return [{ kind: 'system', text: ev.subtype ?? 'system' }];
    }
    case 'assistant': {
      const content = ((ev.message as { content?: unknown[] } | undefined)?.content ?? []) as Array<Record<string, unknown>>;
      return content.flatMap((c): LogEntry[] => {
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) return [{ kind: 'assistant', text: clip(c.text) }];
        if (c.type === 'tool_use') {
          return [{ kind: 'tool_use', text: clip(`${String(c.name)} ${toolInputSummary(c.input as Record<string, unknown>)}`, 500) }];
        }
        return [];
      });
    }
    case 'user': {
      const content = ((ev.message as { content?: unknown[] } | undefined)?.content ?? []) as Array<Record<string, unknown>>;
      return content
        .filter((c) => c.type === 'tool_result')
        .map((c) => ({ kind: 'tool_result', text: clip(`${c.is_error ? '[오류] ' : ''}${contentText(c.content)}`, 500) }));
    }
    case 'result':
      return [{ kind: 'result', text: `${String(ev.subtype)} turns=${String(ev.num_turns ?? '')} cost=$${String(ev.total_cost_usd ?? '')}` }];
    case 'rate_limit_event': {
      const info = ev.rate_limit_info as { status?: string; rateLimitType?: string } | undefined;
      return info?.status === 'allowed' ? [] : [{ kind: 'rate_limit', text: `사용량 한도: ${info?.status} (${info?.rateLimitType})` }];
    }
    default:
      return [{ kind: 'system', text: ev.type }];
  }
}

export interface ProcessOutcome {
  /** 마지막 result 이벤트 */
  result: StreamEvent | null;
  /** 마지막 rate_limit_event의 rate_limit_info */
  rateLimit: { status?: string; rateLimitType?: string; resetsAt?: number } | null;
  exitCode: number | null;
  stopped: boolean;
  stderr: string;
}

export type Verdict =
  | { kind: 'done'; output: NonNullable<RunResult['output']> }
  | { kind: 'needs_input'; output: NonNullable<RunResult['output']>; question: string }
  | { kind: 'failed'; failure: string; reason: string }
  | { kind: 'stopped'; reason: string };

export type ProcessVerdict =
  | { kind: 'ok'; structured: unknown }
  | { kind: 'failed'; failure: string; reason: string }
  | { kind: 'stopped'; reason: string };

/** 프로세스 수준 판정: 중지, 사용량 한도, 프로세스 오류를 걸러 내고 구조화된 출력을 돌려준다. */
export function judgeProcess(o: ProcessOutcome): ProcessVerdict {
  if (o.stopped) return { kind: 'stopped', reason: '사용자가 중지했다' };

  if (o.rateLimit && o.rateLimit.status && o.rateLimit.status !== 'allowed' && (!o.result || o.result.is_error)) {
    const resets = o.rateLimit.resetsAt ? ` (풀리는 시각 ${new Date(o.rateLimit.resetsAt * 1000).toISOString()})` : '';
    return { kind: 'failed', failure: 'rate_limit', reason: `사용량 한도에 걸렸다: ${o.rateLimit.rateLimitType ?? ''}${resets}` };
  }

  if (!o.result) {
    const tail = o.stderr.trim().split('\n').slice(-5).join('\n');
    return { kind: 'failed', failure: 'process', reason: `claude가 결과 없이 끝났다 (exit ${o.exitCode})${tail ? `: ${tail}` : ''}` };
  }

  if (o.result.is_error || o.result.subtype !== 'success') {
    const msg = typeof o.result.result === 'string' ? o.result.result : String(o.result.subtype);
    const failure = /limit|usage/i.test(msg) ? 'rate_limit' : 'process';
    return { kind: 'failed', failure, reason: clip(`claude 실행 오류 (${String(o.result.subtype)}): ${msg}`, 1000) };
  }

  return { kind: 'ok', structured: o.result.structured_output };
}

/** 구현 run 판정: 완료 / 질문 / 실패 / 중지 */
export function judge(o: ProcessOutcome): Verdict {
  const pv = judgeProcess(o);
  if (pv.kind !== 'ok') return pv;
  const out = pv.structured as RunResult['output'] | undefined;
  if (!out || (out.status !== 'done' && out.status !== 'needs_input')) {
    return { kind: 'failed', failure: 'no_output', reason: '출력 스키마(status, summary)를 받지 못했다' };
  }
  if (out.status === 'needs_input') {
    return { kind: 'needs_input', output: out, question: out.question?.trim() || out.summary };
  }
  return { kind: 'done', output: out };
}
