import type { McpServerDto, McpStatus } from '@hub/shared';

/**
 * SKILL.md·명령 .md 앞의 --- 블록에서 한 단계짜리 키만 읽는다.
 * 값은 한 줄, 따옴표, 접는 블록(>, >-)과 줄 블록(|, |-)을 받는다. 나머지 YAML 문법은 다루지 않는다.
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (/^[>|][+-]?$/.test(raw)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      out[key] = (raw.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ') : block.join('\n')).trim();
    } else {
      out[key] = raw.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
    }
  }
  return out;
}

const STATUS: Array<[RegExp, McpStatus]> = [
  [/^✔/, 'connected'],
  [/^! Needs authentication/i, 'needs_auth'],
  [/^✘/, 'failed'],
  [/^- Not configured/i, 'not_configured'],
];

/**
 * `claude mcp list` 출력 한 줄: "<이름>: <주소나 명령> - <상태>".
 * 이름은 처음 나오는 ": " 앞, 상태는 기호(✔ ! ✘ -)로 시작하는 마지막 " - " 뒤다.
 */
export function parseMcpList(stdout: string): McpServerDto[] {
  const out: McpServerDto[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^(.+?): (.*?) - ([✔!✘-] .*)$/.exec(line.trim());
    if (!m) continue;
    const [, fullName, target, rawStatus] = m;
    const status = STATUS.find(([re]) => re.test(rawStatus))?.[1] ?? 'unknown';
    const detail = status === 'failed' ? (rawStatus.split(' — ')[1]?.trim() ?? null) : status === 'unknown' ? rawStatus : null;
    const plugin = /^plugin:([^:]+):(.+)$/.exec(fullName);
    if (fullName.startsWith('claude.ai ')) {
      out.push({ name: fullName.slice('claude.ai '.length), source: 'claude_ai', plugin: null, target: target.trim(), status, detail, ko: null });
    } else if (plugin) {
      out.push({ name: plugin[2], source: 'plugin', plugin: plugin[1], target: target.trim(), status, detail, ko: null });
    } else {
      out.push({ name: fullName, source: 'local', plugin: null, target: target.trim(), status, detail, ko: null });
    }
  }
  return out;
}
