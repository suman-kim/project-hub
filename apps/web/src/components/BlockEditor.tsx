import { useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { BLOCK_MENU, imageBlock, LIST_TYPES, newBlock, shortcutOf, type Block, type BlockType } from '../lib/blocks';
import { inline } from '../lib/md';
import { IconCopy } from './icons';
import { useCopy } from './ui';

/**
 * 노션처럼 블록 단위로 글을 쓰는 편집기. 외부 라이브러리 없이 textarea 여러 개로 만든다.
 * - Enter: 새 블록 (목록은 같은 종류로 이어짐, 빈 목록 항목에서 Enter는 목록 끝내기)
 * - Backspace (맨 앞): 종류를 문단으로 → 앞 블록과 합치기
 * - ↑↓: 블록 사이 이동 · Cmd+Shift+↑↓: 블록 옮기기
 * - "/": 블록 종류 메뉴 · "# ", "- ", "1. ", "[] ", "> ", "```", "---": 단축 입력
 * - 코드 블록: Enter는 줄바꿈, Cmd+Enter로 나가기, 복사 버튼
 * - 그림: 붙여넣기·끌어 놓기·"/그림"으로 올리면 그 자리에 그림 블록이 생긴다 (onUpload가 있을 때만)
 * 고치지 않는 블록은 굵게·코드·링크를 렌더링해 보여 주고, 누르면 그 자리에서 고친다.
 */
export function BlockEditor({ blocks, onChange, autoFocus, onUpload }: EditorProps) {
  const root = useRef<HTMLDivElement>(null);
  /** 올리기가 끝났을 때 그 사이 바뀐 블록에 그림을 넣도록 늘 최신 값을 둔다 */
  const latest = useRef({ blocks, onChange });
  latest.current = { blocks, onChange };
  const fileInput = useRef<HTMLInputElement>(null);
  /** "/그림"으로 파일을 고를 때 그림을 넣을 블록 */
  const pickAt = useRef<string | null>(null);
  /** 올리는 중인 파일 수 */
  const [uploading, setUploading] = useState(0);
  /** 파일을 끌어 편집기 위에 올려 둔 동안 */
  const [dropping, setDropping] = useState(false);
  /** 지금 고치는 중인 블록 (그 블록만 textarea로 그린다) */
  const [active, setActive] = useState<string | null>(autoFocus ? blocks[0]?.id ?? null : null);
  /** 다음 그리기 뒤에 커서를 둘 곳 */
  const [want, setWant] = useState<{ id: string; pos: number } | null>(autoFocus && blocks[0] ? { id: blocks[0].id, pos: 0 } : null);
  const [menu, setMenu] = useState<{ id: string; q: string; sel: number } | null>(null);

  const focusBlock = (id: string, pos: number) => {
    setActive(id);
    setWant({ id, pos });
  };

  useLayoutEffect(() => {
    if (!want) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-block-id="${want.id}"]`);
    if (el) {
      el.focus();
      if (el instanceof HTMLTextAreaElement) {
        const p = Math.min(want.pos, el.value.length);
        el.setSelectionRange(p, p);
      }
    }
    setWant(null);
  }, [want, blocks]);

  const replace = (i: number, b: Block) => onChange(blocks.map((x, k) => (k === i ? b : x)));
  const insertAfter = (i: number, b: Block) => {
    onChange([...blocks.slice(0, i + 1), b, ...blocks.slice(i + 1)]);
    focusBlock(b.id, 0);
  };
  const remove = (i: number, focusPrev = true) => {
    const next = blocks.filter((_, k) => k !== i);
    if (!next.length) next.push(newBlock('p'));
    onChange(next);
    const to = next[focusPrev ? Math.max(0, i - 1) : Math.min(i, next.length - 1)];
    focusBlock(to.id, to.text.length);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-block-id="${blocks[i].id}"]`);
    setWant({ id: blocks[i].id, pos: el?.selectionStart ?? 0 });
  };
  /** 블록 종류를 바꾼다. 구분선은 글이 없으니 뒤에 문단을 하나 둔다 */
  const setType = (i: number, type: BlockType, text = '') => {
    const b = blocks[i];
    if (type === 'hr') {
      const p = newBlock('p');
      onChange([...blocks.slice(0, i), { ...b, type, text: '' }, p, ...blocks.slice(i + 1)]);
      focusBlock(p.id, 0);
      return;
    }
    replace(i, { id: b.id, type, text, ...(type === 'todo' ? { checked: false } : {}) });
    focusBlock(b.id, text.length);
  };

  /**
   * 파일을 차례로 올리고, 그림은 기준 블록 뒤에 그림 블록으로 넣는다. 그림이 아닌 파일은 첨부에만 붙는다(알림은 onUpload가 한다).
   * 기준 블록이 빈 문단이면 그 자리를 그림으로 바꾼다. 그림 뒤에는 이어 쓸 빈 문단을 둔다.
   * @param files 올릴 파일
   * @param anchorId 기준 블록 id
   */
  const addFiles = async (files: File[], anchorId: string) => {
    if (!onUpload || !files.length) return;
    const imgs: Block[] = [];
    setUploading((n) => n + files.length);
    for (const f of files) {
      const r = await onUpload(f);
      setUploading((n) => n - 1);
      if (r?.image) imgs.push(imageBlock(r.url, r.name));
    }
    if (!imgs.length) return;
    const { blocks: cur, onChange: change } = latest.current;
    const found = cur.findIndex((b) => b.id === anchorId);
    const i = found < 0 ? cur.length - 1 : found;
    const anchor = cur[i];
    const replaceAnchor = anchor?.type === 'p' && !anchor.text;
    const after = cur.slice(i + 1);
    const tail = after[0]?.type === 'p' && !after[0].text ? null : newBlock('p');
    change([...cur.slice(0, replaceAnchor ? i : i + 1), ...imgs, ...(tail ? [tail] : []), ...after]);
    const next = tail ?? after[0];
    focusBlock(next.id, 0);
  };

  const menuItems = menu ? BLOCK_MENU.filter((m) => (m.type !== 'image' || !!onUpload) && (!menu.q || m.label.includes(menu.q) || m.keys.some((k) => k.startsWith(menu.q.toLowerCase())))) : [];
  const pickMenu = (i: number, type: BlockType) => {
    setMenu(null);
    if (type === 'image') {
      // "/그림"은 글을 지우고 파일 고르기 창을 연다. 고른 그림이 이 자리에 들어간다
      replace(i, { ...blocks[i], type: 'p', text: '' });
      pickAt.current = blocks[i].id;
      fileInput.current?.click();
      return;
    }
    setType(i, type);
  };

  /**
   * 붙여넣기: 파일만 있으면(스크린샷, 복사한 그림) 올린다. 글이 함께 있으면(표 복사 등) 글로 붙인다.
   * @param b 붙여 넣은 블록
   */
  const onPaste = (b: Block, e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (!onUpload || !files.length || e.clipboardData.types.includes('text/plain')) return;
    e.preventDefault();
    void addFiles(files, b.id);
  };
  const hasFiles = (e: DragEvent) => !!onUpload && e.dataTransfer.types.includes('Files');

  const onKey = (i: number, b: Block, e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value } = el;
    const mod = e.metaKey || e.ctrlKey;

    if (menu && menu.id === b.id) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = menuItems.length;
        if (n) setMenu({ ...menu, sel: (menu.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (menuItems[menu.sel]) pickMenu(i, menuItems[menu.sel].type);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }

    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(i, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'Enter') {
      if (b.type === 'code') {
        if (!mod) return; // 코드 안에서는 줄바꿈
        e.preventDefault();
        insertAfter(i, newBlock('p'));
        return;
      }
      if (e.shiftKey) return; // 블록 안 줄바꿈
      e.preventDefault();
      if (LIST_TYPES.has(b.type) && !value.trim()) {
        setType(i, 'p');
        return;
      }
      const left = value.slice(0, s);
      const right = value.slice(en);
      const type: BlockType = LIST_TYPES.has(b.type) ? b.type : 'p';
      const nb = newBlock(type, right);
      onChange([...blocks.slice(0, i), { ...b, text: left }, nb, ...blocks.slice(i + 1)]);
      focusBlock(nb.id, 0);
      return;
    }
    if (e.key === 'Backspace' && s === 0 && en === 0) {
      if (b.type !== 'p') {
        e.preventDefault();
        setType(i, 'p', value);
        return;
      }
      if (i > 0) {
        e.preventDefault();
        const prev = blocks[i - 1];
        if (prev.type === 'hr') {
          onChange(blocks.filter((_, k) => k !== i - 1));
          setWant({ id: b.id, pos: 0 });
          return;
        }
        // 앞이 그림이면 합치지 않고 그림을 고른다(한 번 더 누르면 지운다). 빈 문단이면 문단은 지운다
        if (prev.type === 'image') {
          if (!value) onChange(blocks.filter((_, k) => k !== i));
          focusBlock(prev.id, 0);
          return;
        }
        const merged = { ...prev, text: prev.text + value };
        onChange([...blocks.slice(0, i - 1), merged, ...blocks.slice(i + 1)]);
        focusBlock(prev.id, prev.text.length);
      }
      return;
    }
    if (e.key === 'ArrowUp' && !value.slice(0, s).includes('\n') && i > 0) {
      e.preventDefault();
      focusBlock(blocks[i - 1].id, blocks[i - 1].text.length);
      return;
    }
    if (e.key === 'ArrowDown' && !value.slice(en).includes('\n') && i < blocks.length - 1) {
      e.preventDefault();
      focusBlock(blocks[i + 1].id, 0);
      return;
    }
    if (e.key === 'Tab' && b.type === 'code') {
      e.preventDefault();
      const next = `${value.slice(0, s)}  ${value.slice(en)}`;
      replace(i, { ...b, text: next });
      setWant({ id: b.id, pos: s + 2 });
      return;
    }
    if (e.key === 'Escape') el.blur();
  };

  const onInput = (i: number, b: Block, el: HTMLTextAreaElement) => {
    const text = el.value;
    // 문단 맨 앞의 단축 입력 → 블록 종류
    if (b.type === 'p') {
      const sc = shortcutOf(text);
      if (sc && el.selectionStart === text.length - sc.rest.length) {
        setMenu(null);
        setType(i, sc.type, sc.rest);
        return;
      }
    }
    if (b.type !== 'code') {
      const m = text.match(/^\/([^\s/]*)$/);
      if (m) setMenu({ id: b.id, q: m[1], sel: 0 });
      else if (menu?.id === b.id) setMenu(null);
    }
    replace(i, { ...b, text });
  };

  // 번호 목록: 이어진 번호 블록에 1, 2, 3…
  const nums: number[] = [];
  let n = 0;
  for (const b of blocks) nums.push((n = b.type === 'number' ? n + 1 : 0));

  return (
    <div
      ref={root}
      className="blocks"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        // 놓은 자리의 블록 뒤에 넣는다. 블록 사이 빈 곳이면 끝에
        const at = (e.target as HTMLElement).closest('[data-block-id]')?.getAttribute('data-block-id') ?? blocks[blocks.length - 1].id;
        void addFiles([...e.dataTransfer.files], at);
      }}
      style={{ display: 'flex', flexDirection: 'column', minWidth: 0, borderRadius: 8, outline: dropping ? '2px dashed var(--accent)' : undefined, outlineOffset: 6, background: dropping ? 'var(--accent-sel)' : undefined }}
    >
      {blocks.map((b, i) => (
        <BlockRow
          key={b.id}
          b={b}
          num={nums[i]}
          editing={active === b.id}
          onlyOne={blocks.length === 1}
          onFocus={() => setActive(b.id)}
          onBlur={() => {
            setActive((cur) => (cur === b.id ? null : cur));
            if (menu?.id === b.id) setMenu(null);
          }}
          onClickText={(pos) => focusBlock(b.id, pos)}
          onInput={(el) => onInput(i, b, el)}
          onKey={(e) => onKey(i, b, e)}
          onToggle={() => replace(i, { ...b, checked: !b.checked })}
          onPaste={(e) => onPaste(b, e)}
          onHrKey={(e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
              e.preventDefault();
              remove(i, e.key === 'Backspace');
            } else if (e.key === 'Enter') {
              e.preventDefault();
              insertAfter(i, newBlock('p'));
            } else if (e.key === 'ArrowUp' && i > 0) {
              e.preventDefault();
              focusBlock(blocks[i - 1].id, blocks[i - 1].text.length);
            } else if (e.key === 'ArrowDown' && i < blocks.length - 1) {
              e.preventDefault();
              focusBlock(blocks[i + 1].id, 0);
            }
          }}
          menu={menu?.id === b.id ? { items: menuItems, sel: menu.sel, pick: (t) => pickMenu(i, t), hover: (k) => setMenu({ ...menu, sel: k }) } : null}
        />
      ))}
      {(uploading > 0 || dropping) && (
        <span role="status" style={{ padding: '4px 0', fontSize: 12, color: 'var(--accent-ink)' }}>
          {uploading > 0 ? `파일 ${uploading}개 올리는 중…` : '놓으면 그림은 본문에, 다른 파일은 첨부에 넣어요'}
        </span>
      )}
      {onUpload && (
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = '';
            const at = pickAt.current ?? blocks[blocks.length - 1].id;
            pickAt.current = null;
            void addFiles(picked, at);
          }}
        />
      )}
      {/* 맨 아래 빈 곳을 누르면 끝에 문단을 하나 더한다 */}
      <div
        aria-hidden
        style={{ minHeight: 28, cursor: 'text' }}
        onMouseDown={(e) => {
          e.preventDefault();
          const last = blocks[blocks.length - 1];
          if (last.type === 'p' && !last.text) focusBlock(last.id, 0);
          else insertAfter(blocks.length - 1, newBlock('p'));
        }}
      />
    </div>
  );
}

/** 올린 파일: 그림이면 본문에 그림 블록으로 넣는다 */
export interface UploadedFile {
  /** 파일 주소 (그림 블록의 src) */
  url: string;
  /** 파일 이름 (그림의 대체 글) */
  name: string;
  /** 그림인지 */
  image: boolean;
}

interface EditorProps {
  blocks: Block[];
  onChange(next: Block[]): void;
  /** 처음 열 때 첫 블록에 커서를 둔다 */
  autoFocus?: boolean;
  /**
   * 파일 하나 올리기. 실패하면 알림을 띄우고 null을 준다. 없으면 붙여넣기·끌어 놓기·"/그림"을 끈다
   * @param file 올릴 파일
   */
  onUpload?: (file: File) => Promise<UploadedFile | null>;
}

/** 블록 종류별 글자 모양 */
const TYPE_STYLE: Record<BlockType, CSSProperties> = {
  p: { fontSize: 15, lineHeight: 1.7 },
  h1: { fontSize: 26, fontWeight: 700, lineHeight: 1.3, marginTop: 14 },
  h2: { fontSize: 21, fontWeight: 700, lineHeight: 1.35, marginTop: 10 },
  h3: { fontSize: 17, fontWeight: 600, lineHeight: 1.4, marginTop: 6 },
  bullet: { fontSize: 15, lineHeight: 1.7 },
  number: { fontSize: 15, lineHeight: 1.7 },
  todo: { fontSize: 15, lineHeight: 1.7 },
  code: { fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.6 },
  quote: { fontSize: 15, lineHeight: 1.7, color: 'var(--text-2)' },
  hr: {},
  image: {},
};

interface RowProps {
  b: Block;
  /** 번호 목록의 번호 (아니면 0) */
  num: number;
  editing: boolean;
  /** 노트에 블록이 하나뿐이면 안내 글을 보여 준다 */
  onlyOne: boolean;
  onFocus(): void;
  onBlur(): void;
  /** 렌더링된 글을 누르면 그 위치에서 고친다 */
  onClickText(pos: number): void;
  onInput(el: HTMLTextAreaElement): void;
  onKey(e: KeyboardEvent<HTMLTextAreaElement>): void;
  onToggle(): void;
  /** 글을 붙여 넣을 때 (파일이면 올린다) */
  onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void;
  /** 글이 없는 블록(구분선, 그림)의 키: 지우기, Enter로 아래에 문단, ↑↓ 이동 */
  onHrKey(e: KeyboardEvent<HTMLDivElement>): void;
  menu: { items: typeof BLOCK_MENU; sel: number; pick(t: BlockType): void; hover(k: number): void } | null;
}

function BlockRow({ b, num, editing, onlyOne, onFocus, onBlur, onClickText, onInput, onKey, onToggle, onPaste, onHrKey, menu }: RowProps) {
  const copy = useCopy();
  const ta = useRef<HTMLTextAreaElement>(null);
  /** 그림을 불러오지 못했다 (첨부에서 지웠거나 없는 파일) */
  const [broken, setBroken] = useState(false);
  // textarea는 글 길이에 맞춰 높이를 늘린다
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  });

  if (b.type === 'hr')
    return (
      <div data-block-id={b.id} role="separator" tabIndex={0} aria-label="구분선" onKeyDown={onHrKey} onFocus={onFocus} onBlur={onBlur} className="block-atom" style={{ padding: '10px 0', borderRadius: 4, cursor: 'default' }}>
        <hr style={{ margin: 0, border: 0, borderTop: '1px solid var(--line-strong)' }} />
      </div>
    );

  if (b.type === 'image')
    return (
      <div data-block-id={b.id} tabIndex={0} role="group" aria-label={`그림 ${b.text}`} onKeyDown={onHrKey} onFocus={onFocus} onBlur={onBlur} className="block-atom" style={{ padding: '6px 0', borderRadius: 8, cursor: 'default' }}>
        {broken || !b.src ? (
          <div style={{ padding: '14px 16px', borderRadius: 8, border: '1px dashed var(--line-strong)', fontSize: 13, color: 'var(--text-3)' }}>그림을 불러오지 못했어요 · 첨부에서 지웠을 수 있어요 ({b.text || '이름 없음'}) · 눌러서 Backspace로 이 블록을 지워요</div>
        ) : (
          <img src={b.src} alt={b.text} loading="lazy" draggable={false} onError={() => setBroken(true)} style={{ display: 'block', maxWidth: '100%', maxHeight: 520, borderRadius: 8, border: '1px solid var(--line-soft)' }} />
        )}
      </div>
    );

  const isCode = b.type === 'code';
  const style = TYPE_STYLE[b.type];
  const placeholder = isCode ? '명령어나 코드를 붙여 넣으세요' : b.type === 'p' ? (onlyOne || editing ? '글을 쓰거나 /를 눌러 블록 종류를 고르세요' : '') : b.type.startsWith('h') ? '제목' : b.type === 'quote' ? '인용' : '';

  /** 렌더링된 글을 누른 자리 → 글자 위치. 굵게·코드 표시가 섞여 있으면 끝으로 */
  const clickPos = (e: MouseEvent<HTMLDivElement>) => {
    if (/[`*[]/.test(b.text)) return b.text.length;
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    let node: Node | null = null;
    let off = 0;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (p) ({ offsetNode: node, offset: off } = p);
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r) ({ startContainer: node, startOffset: off } = r);
    }
    if (!node || !e.currentTarget.contains(node)) return b.text.length;
    const pre = document.createRange();
    pre.selectNodeContents(e.currentTarget);
    pre.setEnd(node, off);
    return Math.min(b.text.length, pre.toString().length);
  };

  const content = editing ? (
    <textarea
      ref={ta}
      data-block-id={b.id}
      value={b.text}
      rows={1}
      spellCheck={false}
      placeholder={placeholder}
      onChange={(e) => onInput(e.currentTarget)}
      onKeyDown={onKey}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={BLOCK_MENU.find((m) => m.type === b.type)?.label}
      className="block-input"
      style={{ ...style, display: 'block', width: '100%', margin: 0, padding: 0, border: 0, outline: 'none', background: 'transparent', color: 'inherit', resize: 'none', overflow: 'hidden', fontFamily: isCode ? 'var(--mono)' : 'inherit' }}
    />
  ) : (
    <div
      data-block-id={b.id}
      tabIndex={0}
      onFocus={() => onClickText(b.text.length)}
      onMouseDown={(e) => {
        e.preventDefault();
        onClickText(clickPos(e));
      }}
      className="block-text"
      style={{ ...style, minHeight: `${(style.fontSize as number) * (style.lineHeight as number)}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', cursor: 'text', outline: 'none', color: b.type === 'todo' && b.checked ? 'var(--text-3)' : style.color, textDecoration: b.type === 'todo' && b.checked ? 'line-through' : undefined }}
    >
      {b.text ? (isCode ? b.text : b.text.split('\n').map((l, k) => <span key={k}>{k ? <br /> : null}{inline(l)}</span>)) : <span style={{ color: 'var(--text-3)' }}>{placeholder}</span>}
    </div>
  );

  if (isCode)
    return (
      <div className="block-row" style={{ position: 'relative', margin: '6px 0', padding: '12px 14px', borderRadius: 8, background: 'var(--chip)', color: 'var(--text)' }}>
        {content}
        <button type="button" className="btn btn-sm" title="코드 복사" aria-label="코드 복사" onMouseDown={(e) => e.preventDefault()} onClick={() => void copy(b.text, '코드를 복사했어요')} style={{ position: 'absolute', top: 6, right: 6, minHeight: 28, padding: '0 8px', gap: 4, fontSize: 12 }}>
          <IconCopy size={13} /> 복사
        </button>
        {editing && <span style={{ position: 'absolute', right: 10, bottom: 4, fontSize: 11, color: 'var(--text-3)' }}>Cmd+Enter로 나가기</span>}
      </div>
    );

  const gutter =
    b.type === 'bullet' ? (
      <span style={{ color: 'var(--text-2)' }}>•</span>
    ) : b.type === 'number' ? (
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
        {num}.
      </span>
    ) : b.type === 'todo' ? (
      <input type="checkbox" checked={!!b.checked} onChange={onToggle} onMouseDown={(e) => e.preventDefault()} aria-label="완료" style={{ width: 16, height: 16, margin: 0, accentColor: 'var(--accent)', cursor: 'pointer' }} />
    ) : null;

  return (
    <div className="block-row" style={{ position: 'relative', display: 'grid', gridTemplateColumns: gutter ? '24px minmax(0,1fr)' : 'minmax(0,1fr)', alignItems: 'start', padding: b.type === 'quote' ? '2px 0 2px 12px' : '2px 0', borderLeft: b.type === 'quote' ? '3px solid var(--line-strong)' : undefined, marginTop: style.marginTop }}>
      {gutter && <span style={{ display: 'flex', alignItems: 'center', height: `${(style.fontSize as number) * (style.lineHeight as number)}px` }}>{gutter}</span>}
      {content}
      {menu && (
        <div role="listbox" aria-label="블록 종류" className="card" style={{ position: 'absolute', zIndex: 20, top: '100%', left: gutter ? 24 : 0, width: 260, maxHeight: 300, overflowY: 'auto', padding: 6, boxShadow: '0 8px 24px var(--shadow)' }}>
          {menu.items.length ? (
            menu.items.map((m, k) => (
              <button
                key={m.type}
                type="button"
                role="option"
                aria-selected={k === menu.sel}
                className="menu-item"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => menu.hover(k)}
                onClick={() => menu.pick(m.type)}
                style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 10px', border: 0, borderRadius: 6, background: k === menu.sel ? 'var(--accent-sel)' : 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{m.label}</span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
                  {m.hint}
                </span>
              </button>
            ))
          ) : (
            <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-3)' }}>맞는 블록이 없어요</div>
          )}
        </div>
      )}
    </div>
  );
}
