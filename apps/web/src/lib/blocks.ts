/**
 * 노트 블록 편집기의 자료 모형과 markdown 변환.
 * 노트 본문은 DB에 markdown으로 두고, 편집기는 이 파일로 블록 목록 ↔ markdown을 오간다.
 * 블록 종류는 md.tsx의 렌더러가 다루는 것과 같은 범위로 맞춘다.
 */

/** 블록 종류: 문단, 제목 1~3, 글머리, 번호, 체크박스, 코드, 인용, 구분선, 그림(노트 첨부), 표 */
export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'todo' | 'code' | 'quote' | 'hr' | 'image' | 'table';

export interface Block {
  /** 화면 안에서만 쓰는 임시 키 (저장하지 않는다) */
  id: string;
  type: BlockType;
  /** 글 내용. 코드·인용은 여러 줄, 구분선은 비어 있다. 그림은 파일 이름(대체 글), 표는 markdown 표 줄 그대로 */
  text: string;
  /** 체크박스 블록의 완료 여부 */
  checked?: boolean;
  /** 그림 블록의 주소 (노트 첨부 /api/notes/files/<id>) */
  src?: string;
}

/** 블록 종류 메뉴("/"를 쳤을 때)에 보이는 이름·설명·단축 입력 */
export const BLOCK_MENU: Array<{ type: BlockType; label: string; hint: string; keys: string[] }> = [
  { type: 'p', label: '글', hint: '보통 문단', keys: ['p', 'text', '글', '문단'] },
  { type: 'h1', label: '제목 1', hint: '# ', keys: ['h1', 'heading', '제목'] },
  { type: 'h2', label: '제목 2', hint: '## ', keys: ['h2', 'heading', '제목'] },
  { type: 'h3', label: '제목 3', hint: '### ', keys: ['h3', 'heading', '제목'] },
  { type: 'bullet', label: '글머리 목록', hint: '- ', keys: ['bullet', 'list', 'ul', '목록', '글머리'] },
  { type: 'number', label: '번호 목록', hint: '1. ', keys: ['number', 'ol', '번호', '목록'] },
  { type: 'todo', label: '할 일', hint: '[] ', keys: ['todo', 'check', '할일', '할 일', '체크'] },
  { type: 'code', label: '코드', hint: '``` · 명령어 보관에 좋아요', keys: ['code', '코드', '명령'] },
  { type: 'quote', label: '인용', hint: '> ', keys: ['quote', '인용'] },
  { type: 'table', label: '표', hint: '| 칸 | 칸 |', keys: ['table', '표'] },
  { type: 'hr', label: '구분선', hint: '---', keys: ['hr', 'divider', '구분', '선'] },
  { type: 'image', label: '그림', hint: '파일 고르기 · 붙여넣기', keys: ['image', 'img', 'picture', '그림', '사진', '이미지'] },
];

/** 목록 종류: Enter를 치면 같은 종류의 블록이 이어진다 */
export const LIST_TYPES: ReadonlySet<BlockType> = new Set(['bullet', 'number', 'todo']);

/** 글자 그대로 다루는 블록: 안에서 Enter는 줄바꿈이고, 붙여 넣은 markdown도 바꾸지 않는다 */
export const RAW_TYPES: ReadonlySet<BlockType> = new Set(['code', 'table']);

/** 글이 없는 블록 (구분선, 그림). 붙여넣기 뒤 글은 이 블록에 이어 붙이지 않는다 */
const ATOM_TYPES: ReadonlySet<BlockType> = new Set(['hr', 'image']);

/** "/표"로 만든 새 표. 머리 줄, 구분 줄, 빈 줄 하나 */
export const TABLE_TEMPLATE = '| 항목 | 내용 |\n| --- | --- |\n|  |  |';

let seq = 0;
/** 새 블록. id는 화면 안에서만 쓰는 임시 키 */
export function newBlock(type: BlockType = 'p', text = '', checked?: boolean): Block {
  seq += 1;
  return { id: `b${seq}`, type, text, ...(type === 'todo' ? { checked: !!checked } : {}) };
}

const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TODO = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
/**
 * 그림 줄: ![이름](/api/…). Hub 안의 주소만 그림으로 읽는다(밖의 주소를 노트가 몰래 불러오지 않게).
 * 다른 그림 줄은 글자 그대로 문단에 남는다.
 */
const IMAGE = /^!\[([^\]\n]*)\]\((\/api\/[^\s)]+)\)\s*$/;
/** 표 줄: | 로 시작하고 | 로 끝난다 */
const TABLE_LINE = /^\s*\|.*\|\s*$/;

/** 표 줄 → 칸 글 목록 */
const cellsOf = (ln: string) =>
  ln
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** 표의 구분 줄: | --- | :---: | 처럼 칸마다 - 만 있다 */
const isDelimiter = (ln: string) => TABLE_LINE.test(ln) && cellsOf(ln).every((c) => /^:?-+:?$/.test(c));

/**
 * 그림 블록
 * @param src 그림 주소 (노트 첨부 url)
 * @param alt 대체 글 (파일 이름)
 */
export function imageBlock(src: string, alt: string): Block {
  return { ...newBlock('image', alt), src };
}

/**
 * markdown → 블록 목록. 비어 있으면 빈 문단 하나를 준다.
 * @param src 노트 본문 markdown
 */
export function parseBlocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(newBlock('p', para.join('\n')));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let m: RegExpMatchArray | null;
    if (/^\s*```/.test(ln)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      out.push(newBlock('code', body.join('\n')));
    } else if ((m = ln.match(IMAGE))) {
      flush();
      out.push(imageBlock(m[2], m[1]));
    } else if (TABLE_LINE.test(ln) && i + 1 < lines.length && isDelimiter(lines[i + 1])) {
      // GitHub 표: 머리 줄 바로 다음이 구분 줄일 때만 표로 읽고, | 줄이 이어지는 데까지 한 표
      flush();
      const rows = [ln];
      while (i + 1 < lines.length && TABLE_LINE.test(lines[i + 1])) rows.push(lines[++i]);
      out.push(newBlock('table', rows.join('\n')));
    } else if ((m = ln.match(HEADING))) {
      flush();
      out.push(newBlock(`h${Math.min(3, m[1].length)}` as BlockType, m[2]));
    } else if (HR.test(ln)) {
      flush();
      out.push(newBlock('hr'));
    } else if ((m = ln.match(QUOTE))) {
      flush();
      const prev = out[out.length - 1];
      if (prev?.type === 'quote' && !prev.text.endsWith('\n\n')) prev.text += `\n${m[1]}`;
      else out.push(newBlock('quote', m[1]));
    } else if ((m = ln.match(TODO))) {
      flush();
      out.push(newBlock('todo', m[2], /x/i.test(m[1])));
    } else if ((m = ln.match(BULLET))) {
      flush();
      out.push(newBlock('bullet', m[1]));
    } else if ((m = ln.match(NUMBER))) {
      flush();
      out.push(newBlock('number', m[1]));
    } else if (!ln.trim()) flush();
    // serializeBlocks가 문단 줄 앞에 붙인 \ 는 떼고 읽는다
    else para.push(ln.startsWith('\\') ? ln.slice(1) : ln);
  }
  flush();
  return out.length ? out : [newBlock('p')];
}

/**
 * 블록 목록 → markdown. 목록 항목끼리는 한 줄씩 붙이고, 그 밖의 블록 사이에는 빈 줄을 둔다.
 * 번호 목록은 이어진 순서대로 1, 2, 3…을 붙인다.
 */
export function serializeBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  let num = 0;
  blocks.forEach((b, i) => {
    num = b.type === 'number' ? num + 1 : 0;
    const prev = blocks[i - 1];
    const tight = prev && LIST_TYPES.has(prev.type) && LIST_TYPES.has(b.type);
    if (i) parts.push(tight ? '\n' : '\n\n');
    parts.push(lineOf(b, num));
  });
  // 끝이 비어 있는 문단만 있으면 빈 글로 저장한다
  const md = parts.join('');
  return md.trim() ? md : '';
}

/**
 * @param b 블록
 * @param num 번호 목록에서 이 블록의 번호
 */
function lineOf(b: Block, num: number): string {
  switch (b.type) {
    case 'h1':
      return `# ${b.text}`;
    case 'h2':
      return `## ${b.text}`;
    case 'h3':
      return `### ${b.text}`;
    case 'bullet':
      return `- ${b.text}`;
    case 'number':
      return `${num}. ${b.text}`;
    case 'todo':
      return `- [${b.checked ? 'x' : ' '}] ${b.text}`;
    case 'code':
      return `\`\`\`\n${b.text}\n\`\`\``;
    case 'quote':
      return b.text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'hr':
      return '---';
    case 'image':
      return `![${b.text.replace(/[\]\n]/g, ' ')}](${b.src ?? ''})`;
    case 'table':
      return b.text;
    default:
      // 문단 안의 줄이 "- "나 "# "로 시작하면 다시 읽을 때 목록·제목·표로 바뀐다. 그런 줄은 앞에 \ 를 붙인다
      return b.text
        .split('\n')
        .map((l) => (/^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|```)/.test(l) || /^\\/.test(l) || HR.test(l) || IMAGE.test(l) || TABLE_LINE.test(l) ? `\\${l}` : l))
        .join('\n');
  }
}

/**
 * 문단 맨 앞에 친 단축 입력을 블록 종류로 바꾼다. 맞는 것이 없으면 null.
 * @param text 문단 글 (방금 입력한 상태)
 */
export function shortcutOf(text: string): { type: BlockType; rest: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(#{1,3}) (.*)$/s))) return { type: `h${m[1].length}` as BlockType, rest: m[2] };
  if ((m = text.match(/^\[ ?\] (.*)$/s))) return { type: 'todo', rest: m[1] };
  if ((m = text.match(/^[-*] (.*)$/s))) return { type: 'bullet', rest: m[1] };
  if ((m = text.match(/^1[.)] (.*)$/s))) return { type: 'number', rest: m[1] };
  if ((m = text.match(/^> (.*)$/s))) return { type: 'quote', rest: m[1] };
  if (/^```\s*$/.test(text)) return { type: 'code', rest: '' };
  if (/^---\s*$/.test(text)) return { type: 'hr', rest: '' };
  return null;
}

/**
 * 표 블록 글 → 칸 목록. 구분 줄은 빼고, 첫 줄이 머리 줄이다.
 * @param text 표 블록의 markdown 표 줄
 */
export function tableRows(text: string): string[][] {
  return text
    .split('\n')
    .filter((l) => l.trim() && !isDelimiter(l))
    .map(cellsOf);
}

/** 목록 행에 보여 줄 첫 줄: 제목이 없을 때 본문에서 뽑는다 (그림·표 블록은 건너뛴다) */
export function previewOf(body: string): string {
  const b = parseBlocks(body).find((x) => x.type !== 'image' && x.type !== 'table' && x.text.trim());
  return b ? b.text.split('\n')[0].replace(/[`*~]/g, '').trim() : '';
}

/** 붙여넣기 결과: 바뀐 블록 목록과 커서를 둘 곳 */
export interface PasteResult {
  blocks: Block[];
  /** 커서를 둘 블록 id와 글자 위치 (붙여 넣은 글의 끝) */
  focus: { id: string; pos: number };
}

/**
 * markdown 글 붙여넣기 → 블록. 제목·목록·코드·인용·표 등이 섞인 글을 블록으로 나눠 그 자리에 넣는다.
 * - 커서 앞 글은 그 블록에 남고, 붙여 넣은 첫 블록이 문단이면 그 블록 글에 이어 붙는다(블록 종류는 그대로).
 * - 커서 뒤 글은 붙여 넣은 마지막 블록 끝에 붙는다. 마지막이 코드·표·구분선·그림이면 새 문단으로 둔다.
 * - 코드·표 블록 안, 한 줄 보통 글, 빈 글이면 null: 브라우저가 글자 그대로 붙이게 둔다.
 * @param blocks 지금 블록 목록
 * @param i 붙여 넣는 블록 순번
 * @param start 고른 글자 시작 (커서 위치)
 * @param end 고른 글자 끝 (고른 글자는 붙여 넣은 글로 바뀐다)
 * @param text 붙여 넣은 글 (클립보드 text/plain)
 */
export function pasteMarkdown(blocks: Block[], i: number, start: number, end: number, text: string): PasteResult | null {
  const b = blocks[i];
  if (!b || RAW_TYPES.has(b.type) || ATOM_TYPES.has(b.type) || !text.trim()) return null;
  const pasted = parseBlocks(text.replace(/\r\n?/g, '\n'));
  if (pasted.length === 1 && pasted[0].type === 'p') return null;

  const left = b.text.slice(0, start);
  const right = b.text.slice(end);
  const out: Block[] = [];
  let rest = pasted;
  if (pasted[0].type === 'p') {
    // 첫 문단은 지금 블록에 이어 쓴다 (목록 항목 안이면 그 항목 글이 된다)
    out.push({ ...b, text: left + pasted[0].text });
    rest = pasted.slice(1);
  } else if (left.trim()) out.push({ ...b, text: left });
  out.push(...rest);

  let last = out[out.length - 1];
  let pos = last.text.length;
  if (right) {
    if (RAW_TYPES.has(last.type) || ATOM_TYPES.has(last.type)) {
      last = newBlock('p', right);
      out.push(last);
      pos = 0;
    } else out[out.length - 1] = { ...last, text: last.text + right };
  }
  return { blocks: [...blocks.slice(0, i), ...out, ...blocks.slice(i + 1)], focus: { id: last.id, pos } };
}
