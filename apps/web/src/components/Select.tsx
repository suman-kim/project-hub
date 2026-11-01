import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { TONE, type Tone } from '../lib/labels';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** 앞에 붙는 고정폭 글 (예: #HB-25) */
  prefix?: string;
  /** 오른쪽 보조 글 */
  hint?: string;
  /** 오른쪽 상태 알약 */
  badge?: { text: string; tone: Tone };
  /** 점 색 (상태를 색으로만 보일 때) */
  dot?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | null | undefined;
  onChange(v: T): void;
  options: Array<SelectOption<T>>;
  /** 화면 읽기용 이름 (필수) */
  label: string;
  /** 고른 값이 없을 때 버튼에 보이는 글. 고르면 다시 비우는 "추가용" 목록에도 쓴다 */
  placeholder?: string;
  size?: 'sm' | 'md';
  mono?: boolean;
  disabled?: boolean;
  /** 항목이 이보다 많으면 위에 검색칸을 둔다 */
  searchAfter?: number;
  /** 펼친 목록의 최소 폭 */
  menuWidth?: number;
  style?: CSSProperties;
}

const MENU_MAX_H = 340;

/**
 * 화면 공통 선택 목록. 브라우저 기본 select의 목록은 꾸밀 수 없어서 직접 그린다.
 * 목록은 body에 띄워 서랍·대화창 안에서도 잘리지 않고, 키보드(↑↓ Enter Esc, Home/End)로 고를 수 있다.
 */
export function Select<T extends string>({ value, onChange, options, label, placeholder = '고르기', size = 'md', mono, disabled, searchAfter = 8, menuWidth = 220, style }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find((o) => o.value === value) ?? null;
  const searchable = options.length > searchAfter;
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? options.filter((o) => [o.label, o.prefix, o.hint, o.badge?.text].some((x) => x?.toLowerCase().includes(needle))) : options),
    [options, needle],
  );

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 220 && above > below;
    const width = Math.min(Math.max(r.width, menuWidth), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({ left, top: up ? r.top - 6 : r.bottom + 6, width, up, maxH: Math.min(MENU_MAX_H, (up ? above : below) - 6) });
  };

  const openMenu = () => {
    if (disabled) return;
    place();
    setQ('');
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  const choose = (o: SelectOption<T> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  // 바깥을 누르거나 창 크기가 바뀌면 닫고, 스크롤하면 버튼을 따라간다.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const resize = () => close(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', place, true);
    };
  });

  useLayoutEffect(() => {
    if (!open) return;
    if (searchable) menu.current?.querySelector('input')?.focus();
    else menu.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  useEffect(() => setActive(shown.findIndex((o) => !o.disabled)), [needle]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (d: 1 | -1) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + d + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };
  const onMenuKey = (e: KeyboardEvent) => {
    // 서랍·대화창의 Esc 처리로 번지지 않게 여기서 끝낸다.
    e.stopPropagation();
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
    else if (e.key === 'Home') (e.preventDefault(), setActive(shown.findIndex((o) => !o.disabled)));
    else if (e.key === 'End') (e.preventDefault(), setActive(shown.length - 1));
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.preventDefault(), choose(shown[active]));
    else if (e.key === 'Escape') (e.preventDefault(), close());
    else if (e.key === 'Tab') close(false);
  };
  const onButtonKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  };

  const h = size === 'sm' ? 36 : 44;
  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onButtonKey}
        className="select-btn"
        data-open={open || undefined}
        style={{ minHeight: h, fontSize: size === 'sm' ? 13 : 14, ...style }}
      >
        <span className="select-btn-text" style={{ color: selected ? 'inherit' : 'var(--text-3)', fontFamily: mono ? 'var(--mono)' : undefined }}>
          {selected?.dot && <span aria-hidden="true" className="dot dot-6" style={{ background: selected.dot }} />}
          {selected?.prefix && <span className="select-prefix">{selected.prefix}</span>}
          <span className="ellipsis">{selected?.label ?? placeholder}</span>
        </span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            tabIndex={-1}
            onKeyDown={onMenuKey}
            className="select-menu"
            style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          >
            {searchable && (
              <div className="select-search">
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" aria-label={`${label} 검색`} aria-controls={id} aria-activedescendant={shown[active] ? `${id}-${active}` : undefined} />
              </div>
            )}
            <div ref={list} id={id} role="listbox" aria-label={label} className="select-list" style={{ maxHeight: Math.max(120, pos.maxH - (searchable ? 48 : 0)) }}>
              {shown.map((o, i) => {
                const sel = o.value === value;
                return (
                  <div
                    key={String(o.value)}
                    id={`${id}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={o.disabled || undefined}
                    className="select-option"
                    data-active={i === active || undefined}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                  >
                    {o.dot && <span aria-hidden="true" className="dot dot-6" style={{ background: o.dot }} />}
                    {o.prefix && <span className="select-prefix">{o.prefix}</span>}
                    <span className="select-label" style={{ fontWeight: sel ? 600 : 500, fontFamily: mono ? 'var(--mono)' : undefined }}>
                      {o.label}
                    </span>
                    {o.hint && <span className="select-hint">{o.hint}</span>}
                    {o.badge && (
                      <span className="select-badge" style={{ background: TONE[o.badge.tone].bg, color: TONE[o.badge.tone].fg }}>
                        {o.badge.text}
                      </span>
                    )}
                    <span aria-hidden="true" className="select-check">
                      {sel ? '✓' : ''}
                    </span>
                  </div>
                );
              })}
              {!shown.length && <div className="select-empty">{needle ? '맞는 항목이 없어요' : '고를 항목이 없어요'}</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
