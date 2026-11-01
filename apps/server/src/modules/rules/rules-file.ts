// ~/.claude/rules/hub-rules.md 형식: 전역 규칙은 번호 목록, 앱 규칙은 "## <앱 이름> (<코드>)에서만" 아래 번호 목록.

export interface RuleItem {
  appCode: string | null;
  body: string;
}

export const RULES_FILE_NOTICE =
  '<!-- Hub가 이 파일을 써 준다. 고칠 때는 Hub 규칙 화면(PUT /api/rules)에서 고친다. 여기서 직접 고치면 다음 저장 때 덮어쓴다. -->';

function numbered(items: string[]): string[] {
  return items.map((body, i) => {
    const [first, ...rest] = body.trim().split('\n');
    const pad = ' '.repeat(`${i + 1}. `.length);
    return [`${i + 1}. ${first}`, ...rest.map((l) => (l.trim() ? `${pad}${l}` : ''))].join('\n');
  });
}

export function renderRulesFile(rules: RuleItem[], appNames: Map<string, string>): string {
  const lines = ['# 작업 규칙', '', RULES_FILE_NOTICE, ''];
  const global = rules.filter((r) => !r.appCode).map((r) => r.body);
  lines.push(...(global.length ? numbered(global) : ['(전역 규칙 없음)']));

  const codes = [...new Set(rules.filter((r) => r.appCode).map((r) => r.appCode!))];
  for (const code of codes) {
    lines.push('', `## ${appNames.get(code) ?? code} (${code})에서만`, '');
    lines.push(...numbered(rules.filter((r) => r.appCode === code).map((r) => r.body)));
  }
  return `${lines.join('\n')}\n`;
}

/** 기존 파일(사람이 쓴 초안 포함)을 규칙 목록으로 읽는다. 번호 목록이 아닌 줄은 무시한다. */
export function parseRulesFile(text: string): RuleItem[] {
  const items: RuleItem[] = [];
  let appCode: string | null = null;
  let current: RuleItem | null = null;
  let inComment = false;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (inComment || line.trim().startsWith('<!--')) {
      inComment = !line.includes('-->');
      current = null;
      continue;
    }
    const section = /^##\s+.*\(([A-Z]{2,4})\)/.exec(line);
    if (section) {
      appCode = section[1];
      current = null;
      continue;
    }
    if (/^#/.test(line)) {
      current = null;
      continue;
    }
    const item = /^\d+\.\s+(.*)$/.exec(line);
    if (item) {
      current = { appCode, body: item[1] };
      items.push(current);
      continue;
    }
    if (current && /^\s+\S/.test(line)) {
      current.body += `\n${line.trim()}`;
      continue;
    }
    if (!line.trim()) continue;
    current = null;
  }
  return items;
}
