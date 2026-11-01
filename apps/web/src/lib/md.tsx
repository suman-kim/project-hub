import type { ReactNode } from 'react';

/**
 * task 설명·명세·결과 요약·프로젝트 문서용 작은 markdown 렌더러 (디자인 시안의 md()를 옮긴 것).
 * 제목, 문단, 목록(체크박스), 코드 블록, 표, 인용, 구분선, 인라인 코드, 굵게, 링크만 다룬다. HTML 주석은 숨긴다.
 * Task Master에서 온 설명은 형식이 고르지 않아서, 이상한 곳을 warn으로 알려 준다.
 */

type Block =
  | { type: 'h'; level: number; text: string }
  | { type: 'p'; text: string }
  | { type: 'li'; indent: number; mark: string; text: string }
  | { type: 'code'; text: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const cells = (ln: string) => ln.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function parseMd(src: string | null | undefined): { blocks: Block[]; warn: string[] } {
  const out: Block[] = [];
  const warn: string[] = [];
  const marks = new Set<string>();
  const lines = String(src ?? '').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let m: RegExpMatchArray | null;
    if (/^\s*<!--/.test(ln)) {
      flush();
      while (i < lines.length && !lines[i].includes('-->')) i++;
    } else if (/^\s*```/.test(ln)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      if (i >= lines.length) warn.push('닫히지 않은 코드 블록');
      out.push({ type: 'code', text: body.join('\n') });
    } else if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      out.push({ type: 'h', level: m[1].length, text: m[2] });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) {
      flush();
      out.push({ type: 'hr' });
    } else if ((m = ln.match(/^\s*>\s?(.*)$/))) {
      flush();
      const prev = out[out.length - 1];
      if (prev?.type === 'quote') prev.text += ` ${m[1]}`;
      else out.push({ type: 'quote', text: m[1] });
    } else if ((m = ln.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/))) {
      flush();
      const num = /\d/.test(m[2]);
      if (!num) marks.add(m[2]);
      out.push({ type: 'li', indent: Math.min(3, Math.floor(m[1].length / 2)), mark: m[3] ? (/x/i.test(m[3]) ? '☑' : '☐') : num ? m[2].replace(')', '.') : '•', text: m[4] });
    } else if (TABLE_LINE.test(ln)) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && TABLE_LINE.test(lines[i]); i++) {
        const row = cells(lines[i]);
        // | --- | :---: | 같은 구분 줄은 뺀다
        if (!row.every((c) => /^:?-+:?$/.test(c))) rows.push(row);
      }
      i--;
      out.push({ type: 'table', rows });
    } else if (!ln.trim()) flush();
    else para.push(ln.trim());
  }
  flush();
  if (marks.size > 1) warn.push('목록 기호가 섞임');
  return { blocks: out, warn };
}

/** `코드`, **굵게**, [이름](주소), 맨 주소 */
export function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined)
      parts.push(
        <code key={k++} style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--chip)', fontFamily: 'var(--mono)', fontSize: '0.88em' }}>
          {m[1]}
        </code>,
      );
    else if (m[2] !== undefined) parts.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] !== undefined)
      parts.push(
        <a key={k++} href={m[4]} target="_blank" rel="noreferrer">
          {m[3]}
        </a>,
      );
    else
      parts.push(
        <a key={k++} href={m[5]} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
          {m[5]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 문서 보기(doc)에서 제목 단계별 글자 크기 차이 */
const H_STEP: Record<number, number> = { 1: 8, 2: 5, 3: 2, 4: 1 };

/** doc: 프로젝트 문서처럼 긴 글. 제목 단계마다 크기를 다르게 하고 간격을 넓힌다 */
export function Markdown({ src, size = 14, compact, doc }: { src: string | null | undefined; size?: number; compact?: boolean; doc?: boolean }) {
  const { blocks } = parseMd(src);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : doc ? 8 : 6, fontSize: size, minWidth: 0 }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h':
            return (
              <div key={i} style={{ marginTop: i ? (doc ? 14 : 6) : 0, fontSize: doc ? size + (H_STEP[b.level] ?? 0) : size, fontWeight: doc && b.level <= 2 ? 700 : 600, lineHeight: 1.4 }}>
                {inline(b.text)}
              </div>
            );
          case 'hr':
            return <hr key={i} style={{ width: '100%', margin: '6px 0', border: 0, borderTop: '1px solid var(--line)' }} />;
          case 'quote':
            return (
              <div key={i} style={{ padding: '2px 0 2px 12px', borderLeft: '3px solid var(--line-strong)', color: 'var(--text-2)', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                {inline(b.text)}
              </div>
            );
          case 'table':
            return (
              <div key={i} style={{ overflowX: 'auto', minWidth: 0 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: size - 1, lineHeight: 1.6 }}>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, k) => {
                          const Cell = r === 0 ? 'th' : 'td';
                          return (
                            <Cell key={k} style={{ padding: '6px 10px', border: '1px solid var(--line)', textAlign: 'left', verticalAlign: 'top', fontWeight: r === 0 ? 600 : 400, background: r === 0 ? 'var(--sunken)' : undefined }}>
                              {inline(c)}
                            </Cell>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'p':
            return (
              <p key={i} style={{ margin: 0, lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                {inline(b.text)}
              </p>
            );
          case 'li':
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0,1fr)', paddingLeft: b.indent * 18, lineHeight: 1.7 }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 2 }}>
                  {b.mark}
                </span>
                <span style={{ overflowWrap: 'anywhere' }}>{inline(b.text)}</span>
              </div>
            );
          case 'code':
            return (
              <pre key={i} className="mono" style={{ margin: 0, padding: '10px 12px', borderRadius: 8, background: 'var(--chip)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {b.text}
              </pre>
            );
        }
      })}
    </div>
  );
}

/** 목록에서 보여 줄 첫 줄 */
export function firstLine(src: string | null | undefined): string {
  const b = parseMd(src).blocks.find((x) => x.type === 'p' || x.type === 'li' || x.type === 'h');
  return b && 'text' in b ? b.text.replace(/[`*]/g, '') : '';
}
