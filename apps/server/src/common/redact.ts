// run_logs, session_events에 비밀값이 남지 않도록 저장 전에 가린다.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /((?:api[_-]?key|secret|password|passwd|token|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,
];

const MAX_STRING = 8000;

export function redactText(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, prefix?: string) =>
      typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]',
    );
  }
  return out;
}

/** 객체 안의 모든 문자열을 가리고, 너무 긴 문자열은 잘라 저장한다. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') {
    const masked = redactText(value);
    return (masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…(${masked.length}자 중 잘림)` : masked) as T;
  }
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
