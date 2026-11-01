import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApps, useTasks } from '../api/queries';
import { TASK_ST } from '../lib/labels';
import { useTaskPanel } from '../lib/nav';

export interface PaletteItem {
  key: string;
  label: string;
  sub: string;
  run(): void;
}

interface PaletteApi {
  open(): void;
  /** 화면 밖 동작(task 추가, 기획 생성 등)을 팔레트에 올린다. 돌려준 함수로 내린다 */
  register(items: PaletteItem[]): () => void;
}

const PaletteContext = createContext<PaletteApi | null>(null);

export function usePalette(): PaletteApi {
  const p = useContext(PaletteContext);
  if (!p) throw new Error('PaletteProvider 밖에서 usePalette를 불렀다');
  return p;
}

const SCREENS: Array<[string, string]> = [
  ['/', '대시보드'],
  ['/board', '태스크 보드'],
  ['/ideas', '기획 인박스'],
  ['/runs', '실행 기록'],
  ['/mine', '내 업무'],
  ['/costs', '비용'],
  ['/rules', '규칙'],
  ['/environment', '스킬·플러그인·커넥터'],
  ['/new-app', '프로젝트 기획 생성'],
];

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [extra, setExtra] = useState<PaletteItem[][]>([]);
  const api = useMemo<PaletteApi>(
    () => ({
      open: () => setOpen(true),
      register: (items) => {
        setExtra((cur) => [...cur, items]);
        return () => setExtra((cur) => cur.filter((x) => x !== items));
      },
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <PaletteContext.Provider value={api}>
      {children}
      {isOpen && <PaletteDialog extra={extra.flat()} onClose={() => setOpen(false)} />}
    </PaletteContext.Provider>
  );
}

function PaletteDialog({ extra, onClose }: { extra: PaletteItem[]; onClose: () => void }) {
  const navigate = useNavigate();
  const apps = useApps();
  const tasks = useTasks();
  const panel = useTaskPanel();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const all: PaletteItem[] = [
    ...SCREENS.map(([to, label]) => ({ key: `m${to}`, label, sub: '화면', run: () => navigate(to) })),
    ...(apps.data ?? []).map((a) => ({ key: `app${a.code}`, label: `${a.code} ${a.name}`, sub: '앱 페이지', run: () => navigate(`/apps/${a.code}`) })),
    ...extra,
    ...(tasks.data ?? []).map((t) => ({ key: t.id, label: `#${t.id} ${t.title}`, sub: TASK_ST[t.status][0], run: () => panel.open(t.id) })),
  ];
  const needle = q.trim().toLowerCase();
  const list = all.filter((x) => !needle || x.label.toLowerCase().includes(needle)).slice(0, 8);
  const pi = Math.max(0, Math.min(index, list.length - 1));
  const pick = (x: PaletteItem) => {
    onClose();
    x.run();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--scrim)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 12px 12px' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="이동·검색"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 24px 60px var(--shadow)', overflow: 'hidden' }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex(Math.min(pi + 1, list.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex(Math.max(pi - 1, 0));
            } else if (e.key === 'Enter' && list[pi] && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pick(list[pi]);
            }
          }}
          placeholder="화면, task, 동작으로 이동"
          aria-label="이동·검색"
          style={{ width: '100%', minHeight: 52, padding: '0 18px', border: 0, borderBottom: '1px solid var(--line-soft)', background: 'transparent', color: 'var(--text)', fontSize: 15, outline: 'none' }}
        />
        <div role="listbox" style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '50vh', overflowY: 'auto' }}>
          {list.map((x, i) => (
            <button
              key={x.key}
              type="button"
              role="option"
              aria-selected={i === pi}
              onClick={() => pick(x)}
              onMouseEnter={() => setIndex(i)}
              style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', border: 0, borderRadius: 8, background: i === pi ? 'var(--accent-bg)' : 'transparent', color: 'var(--text)', fontSize: 14, textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="ellipsis">{x.label}</span>
              <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>{x.sub}</span>
            </button>
          ))}
          {list.length === 0 && <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-3)' }}>맞는 항목이 없어요</div>}
        </div>
      </div>
    </div>
  );
}
