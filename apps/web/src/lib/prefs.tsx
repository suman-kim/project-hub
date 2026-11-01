import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** 화면 너비가 이보다 좁으면 사이드바 대신 위 머리와 아래 메뉴를 쓴다 (디자인 시안과 같다) */
const MOBILE_MAX = 860;

export type Theme = 'system' | 'light' | 'dark';

/** localStorage는 사생활 보호 창 등에서 막힐 수 있다. 실패하면 기본값으로 둔다 */
export function readPref<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && (!allowed || allowed.includes(v)) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 저장하지 못해도 화면은 그대로 동작한다.
  }
}

interface Prefs {
  /** 좁은 화면 */
  m: boolean;
  theme: Theme;
  setTheme(t: Theme): void;
  /** 오늘·보드·기획·실행 화면 위쪽의 앱 필터. 'all' 또는 앱 코드 */
  appFilter: string;
  setAppFilter(code: string): void;
}

const PrefsContext = createContext<Prefs | null>(null);

export function usePrefs(): Prefs {
  const p = useContext(PrefsContext);
  if (!p) throw new Error('PrefsProvider 밖에서 usePrefs를 불렀다');
  return p;
}

export function applyTheme(t: Theme): void {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [m, setM] = useState(() => window.innerWidth < MOBILE_MAX);
  const [theme, setThemeState] = useState<Theme>(() => readPref<Theme>('hub.theme', 'system', ['system', 'light', 'dark']));
  const [appFilter, setAppFilterState] = useState<string>(() => readPref<string>('hub.appFilter', 'all'));

  useEffect(() => {
    const onResize = () => setM(window.innerWidth < MOBILE_MAX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  const value: Prefs = {
    m,
    theme,
    setTheme: (t) => {
      writePref('hub.theme', t);
      setThemeState(t);
    },
    appFilter,
    setAppFilter: (code) => {
      writePref('hub.appFilter', code);
      setAppFilterState(code);
    },
  };
  return (
    <PrefsContext.Provider value={value}>
      <div className={m ? 'is-m' : 'is-d'} style={{ height: '100%' }}>
        {children}
      </div>
    </PrefsContext.Provider>
  );
}
