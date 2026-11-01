/**
 * 대시보드에서 보낸 메시지를 세션에 넣는 글.
 * hook이 넣는 글(additionalContext 등)은 Claude에게만 가고 CLI·웹 대화 화면에는 사용자 글로 보이지 않는다.
 * 그래서 CLI에는 systemMessage로 보여 주고, Claude가 답 첫 줄에 인용 줄을 써서 대화(웹 포함)에도 남긴다.
 */
export const hubMessageTag = (id: number) => `[Hub 메시지 #${id}]`;

/** Claude가 답 첫 줄에 쓰는 인용 줄의 머리 */
export const HUB_QUOTE = '> 📨 Hub에서 보낸 메시지';
/** Hub 대화 화면은 같은 메시지를 사용자 말풍선으로 보여 주므로 인용 줄을 뺀다(예전 문구 "Hub 메시지"도) */
export const isHubQuoteLine = (line: string) => /^> 📨 Hub(에서 보낸)? 메시지/.test(line);

const QUOTE_FULL_MAX = 300;
const QUOTE_HEAD_MAX = 120;
/** CLI 알림(systemMessage)에 보여 줄 본문 길이 */
const DISPLAY_MAX = 1500;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** 짧은 메시지는 한 줄로 전부, 긴 메시지(task 정보 글 등)는 첫 줄과 줄 수만 */
export function hubQuote(text: string): string {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const short = lines.length <= 3 && text.length <= QUOTE_FULL_MAX;
  return `${HUB_QUOTE}: ${short ? lines.join(' / ') : `${clip(lines[0] ?? '', QUOTE_HEAD_MAX)} (전체 ${lines.length}줄)`}`;
}

export interface Delivery {
  /** Claude에게 넣을 글 */
  context: string;
  /** CLI에 보여 줄 알림 */
  display: string;
}

export function deliveryOf(messages: Array<{ id: number; text: string }>): Delivery {
  const sorted = [...messages].sort((a, b) => a.id - b.id);
  return {
    context: sorted
      .map((m) =>
        [
          `${hubMessageTag(m.id)} 사용자가 Hub 대시보드에서 이 세션에 보낸 메시지다. 지금 하던 일에 반영하고, 필요하면 답한다.`,
          '사용자의 터미널·웹 대화 화면에는 이 글이 보이지 않는다. 이 메시지를 받고 처음 쓰는 답의 첫 줄에 아래 인용 줄을 그대로 쓴다.',
          hubQuote(m.text),
          '메시지:',
          m.text,
        ].join('\n'),
      )
      .join('\n\n'),
    display: sorted.map((m) => `📨 Hub에서 보낸 메시지 #${m.id}\n${clip(m.text.trim(), DISPLAY_MAX)}`).join('\n\n'),
  };
}
