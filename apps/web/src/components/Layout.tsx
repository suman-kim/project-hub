import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AppStatusDto, UsageDto } from '@hub/shared';
import { api } from '../api/client';
import { useInbox } from '../api/inbox';
import { keys, useAllSessions, useApps, useAppStatus, useUsage } from '../api/queries';
import { useWsState, type WsState } from '../api/ws';
import { stamp, percent } from '../lib/format';
import { DOT_COLOR, DOT_LABEL, LIFE } from '../lib/labels';
import { readPref, usePrefs, writePref, type Theme } from '../lib/prefs';
import { IconChat, IconPlus, IconSpark, IconBoard, IconCosts, IconIdeas, IconMine, IconPlug, IconRules, IconRuns, IconSearch, IconToday, IconMenu } from './icons';
import { useDialogs } from './GlobalDialogs';
import { HubDown } from './HubDown';
import { usePalette } from './Palette';

type MenuKey = 'today' | 'sessions' | 'board' | 'ideas' | 'runs' | 'mine' | 'costs' | 'rules' | 'environment' | 'apps';

const MENU: Array<{ key: MenuKey; label: string; short?: string; to: string; Icon: (p: { size?: number }) => JSX.Element }> = [
  { key: 'today', label: '대시보드', to: '/', Icon: IconToday },
  { key: 'sessions', label: '세션', to: '/sessions', Icon: IconChat },
  { key: 'apps', label: '프로젝트 기획 생성', to: '/new-app', Icon: IconSpark },
  { key: 'ideas', label: '기획 인박스', short: '기획', to: '/ideas', Icon: IconIdeas },
  { key: 'board', label: '태스크 보드', short: '보드', to: '/board', Icon: IconBoard },
  { key: 'runs', label: '실행 기록', short: '실행', to: '/runs', Icon: IconRuns },
  { key: 'mine', label: '내 업무', to: '/mine', Icon: IconMine },
  { key: 'costs', label: '비용', to: '/costs', Icon: IconCosts },
  { key: 'rules', label: '규칙', to: '/rules', Icon: IconRules },
  { key: 'environment', label: '스킬·커넥터', to: '/environment', Icon: IconPlug },
];

/** 모바일 하단 탭에 두는 메뉴. 세션이 주 화면이고 실행 기록(지난 기록 조회)은 더보기 시트에 */
const MOBILE_TABS: MenuKey[] = ['today', 'sessions', 'ideas', 'board'];

const TITLES: Record<MenuKey | 'app' | 'run' | 'session', string> = {
  today: '대시보드',
  sessions: '세션',
  board: '태스크 보드',
  ideas: '기획 인박스',
  runs: '실행 기록',
  run: '실행 상세',
  mine: '내 업무',
  costs: '비용',
  rules: '규칙',
  environment: '스킬·커넥터',
  apps: '프로젝트 기획 생성',
  app: '앱 페이지',
  session: '새 앱 세션',
};

/** 주소 → 지금 화면. 앱 목록은 사이드바에 있고, /new-app은 프로젝트 기획 생성, /apps/LK는 앱 페이지다 */
export function screenOf(pathname: string): keyof typeof TITLES {
  if (pathname === '/') return 'today';
  const [first, second] = pathname.split('/').filter(Boolean);
  if (first === 'new-app') return 'apps';
  if (first === 'apps') return second ? 'app' : 'apps';
  if (first === 'runs') return second ? 'run' : 'runs';
  if (first === 'sessions') return second ? 'session' : 'sessions';
  return (first as MenuKey) in TITLES ? (first as MenuKey) : 'today';
}

interface NavBadge {
  n: number;
  bg: string;
  fg: string;
}

function useNavBadges(): Partial<Record<MenuKey, NavBadge>> {
  const inbox = useInbox();
  const sessions = useAllSessions();
  return {
    today: { n: inbox.todoCount, bg: 'var(--attn-bg)', fg: 'var(--attn)' },
    sessions: { n: (sessions.data ?? []).filter((s) => s.open).length, bg: 'var(--prog-bg)', fg: 'var(--prog)' },
    ideas: { n: inbox.ideas.length, bg: 'var(--check-bg)', fg: 'var(--check)' },
    runs: { n: inbox.runningAll, bg: 'var(--prog-bg)', fg: 'var(--prog)' },
    mine: { n: inbox.mineBadge, bg: 'var(--attn-bg)', fg: 'var(--attn)' },
  };
}

interface SideApp {
  code: string;
  name: string;
  lifecycle: AppStatusDto['lifecycle'];
  dot: AppStatusDto['signals']['dot'];
}

function useSideApps(): { live: SideApp[]; archived: SideApp[] } {
  const apps = useApps();
  const status = useAppStatus();
  const list: SideApp[] = (apps.data ?? []).map((a) => {
    const st = status.data?.find((s) => s.code === a.code);
    return { code: a.code, name: a.name, lifecycle: st?.lifecycle ?? a.lifecycle, dot: st?.signals.dot ?? 'ok' };
  });
  return { live: list.filter((a) => a.lifecycle !== 'archived'), archived: list.filter((a) => a.lifecycle === 'archived') };
}

/** 초기화 시각이 지난 창은 0으로 본다 (새 값은 다음 실행 때 받는다) */
const live = (w: UsageDto['fiveHour']) => (w?.resetsAt && new Date(w.resetsAt).getTime() < Date.now() ? 0 : w?.utilization);

function usageView(u: UsageDto | undefined, ws: WsState) {
  const p7 = percent(live(u?.sevenDay ?? null));
  const p5 = percent(live(u?.fiveHour ?? null));
  const limit = percent(u?.limit ?? 0.8);
  const wsOk = ws !== 'down';
  return {
    has: !!u?.at,
    p7,
    p5,
    limit,
    fg: p7 >= limit ? 'var(--attn)' : 'var(--text)',
    bar: p7 >= limit ? 'var(--attn-dot)' : 'var(--accent)',
    at: u?.at ? stamp(u.at) : '',
    wsFg: wsOk ? 'var(--text-3)' : 'var(--risk)',
    wsDot: wsOk ? 'var(--done-dot)' : 'var(--risk)',
    wsLabel: wsOk ? '실시간 연결됨' : '연결 끊김 · 다시 연결하는 중',
  };
}

const THEMES: Array<[Theme, string]> = [
  ['system', '시스템'],
  ['light', '라이트'],
  ['dark', '다크'],
];

function ThemeSwitch({ wide }: { wide?: boolean }) {
  const { theme, setTheme } = usePrefs();
  return (
    <div role="group" aria-label="화면 테마" style={{ display: 'flex', padding: 3, gap: 2, borderRadius: wide ? 9 : 8, background: 'var(--chip)', flex: wide ? 1 : undefined }}>
      {THEMES.map(([k, label]) => {
        const on = theme === k;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(k)}
            style={{
              flex: wide ? 1 : undefined,
              minHeight: wide ? 40 : 28,
              padding: '0 8px',
              border: 0,
              borderRadius: wide ? 7 : 6,
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--text)' : 'var(--text-3)',
              boxShadow: on ? '0 1px 2px var(--shadow)' : 'none',
              fontSize: wide ? 13 : 12,
              fontWeight: wide ? 600 : 500,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    qc.clear();
    qc.setQueryData(keys.me, { loggedIn: false, passwordSet: true });
  };
}

function AppButton({ a, current, archived, onClick, big, mini }: { a: SideApp; current: boolean; archived?: boolean; onClick: () => void; big?: boolean; mini?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      aria-label={mini ? `${a.name} (${a.code})` : undefined}
      title={mini ? `${a.name} · ${LIFE[a.lifecycle][0]}` : undefined}
      className={`side-app${big ? ' side-app-big' : ''}`}
      style={{ color: archived ? 'var(--text-2)' : 'var(--text)', ...(mini ? { justifyContent: 'center', padding: '6px 0', position: 'relative' } : {}) }}
    >
      <span
        style={{
          minWidth: big ? 28 : 26,
          height: big ? 28 : 26,
          padding: '0 4px',
          flexShrink: 0,
          borderRadius: 6,
          border: `1px ${archived ? 'dashed' : 'solid'} ${current ? 'var(--accent)' : 'var(--line-strong)'}`,
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--mono)',
          fontSize: 10,
          fontWeight: 500,
          color: archived ? 'var(--text-3)' : 'var(--text-2)',
        }}
      >
        {a.code}
      </span>
      {!mini && (
        <span className="ellipsis" style={{ fontSize: big ? 15 : 14, fontWeight: current ? 600 : 400 }}>
          {a.name}
        </span>
      )}
      {!archived && a.dot !== 'ok' && (
        <span role="img" aria-label={DOT_LABEL[a.dot]} title={DOT_LABEL[a.dot]} className="dot" style={{ background: DOT_COLOR[a.dot], ...(mini ? { position: 'absolute', top: 2, right: 8 } : {}) }} />
      )}
      {!archived && !mini && <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{LIFE[a.lifecycle][0]}</span>}
    </button>
  );
}

function UsageCard({ compact }: { compact?: boolean }) {
  const usage = useUsage();
  const ws = useWsState();
  const navigate = useNavigate();
  const U = usageView(usage.data, ws);
  const bar = (
    <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--chip)' }}>
      <div style={{ width: `${Math.min(100, U.p7)}%`, height: 6, borderRadius: 3, background: U.bar }} />
      <div title={`${U.limit}% 기준선`} style={{ position: 'absolute', left: `${U.limit}%`, top: -3, width: 2, height: 12, borderRadius: 1, background: 'var(--text-3)' }} />
    </div>
  );
  const note = U.has ? `${U.limit}%를 넘으면 자동 생성이 멈춰요 · ${U.at}에 받은 값` : `아직 받은 값이 없어요 · Hub가 실행할 때 받아요`;
  if (compact) {
    return (
      <div style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-3)' }}>
          <span>7일 사용량</span>
          <span className="mono" style={{ color: U.fg }}>
            {U.p7}% · 5시간 {U.p5}%
          </span>
        </div>
        {bar}
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {note} · {U.wsLabel}
        </span>
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/costs')}
      onKeyDown={(e) => e.key === 'Enter' && navigate('/costs')}
      title="비용·사용량 보기"
      className="usage-card"
      style={{ padding: '14px 12px', border: '1px solid var(--line)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)' }}>
        <span>7일 사용량</span>
        <span className="mono" style={{ color: U.fg }}>
          {U.p7}%
        </span>
      </div>
      {bar}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)' }}>
        <span>5시간 창</span>
        <span className="mono" style={{ color: 'var(--text)' }}>
          {U.p5}%
        </span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{note}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontSize: 12, color: U.wsFg }}>
        <span className="dot dot-6" style={{ background: U.wsDot }} />
        {U.wsLabel}
      </div>
    </div>
  );
}

function Logo({ size = 34 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: size > 32 ? 9 : 8,
        background: 'var(--ink)',
        color: 'var(--on-ink)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--mono)',
        fontSize: size > 32 ? 13 : 12,
        fontWeight: 500,
      }}
    >
      &gt;_
    </div>
  );
}

export function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Logo />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Hub</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>프로젝트 관리</span>
      </div>
    </div>
  );
}

/** 펼친 사이드바 너비. 앱 이름과 진행 상태, 메뉴 이름이 잘리지 않을 만큼 */
const SIDEBAR_WIDTH = 272;

function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const screen = screenOf(pathname);
  const badges = useNavBadges();
  const { live, archived } = useSideApps();
  const [archOpen, setArchOpen] = useState(false);
  const logout = useLogout();
  const palette = usePalette();
  const dialogs = useDialogs();
  const currentApp = screen === 'app' ? pathname.split('/')[2]?.toUpperCase() : null;
  // 최소화하면 아이콘과 앱 코드만 남긴다. 이 브라우저에서 기억한다.
  const [mini, setMiniState] = useState(() => readPref<'open' | 'mini'>('hub.sidebar', 'open', ['open', 'mini']) === 'mini');
  const setMini = (v: boolean) => {
    writePref('hub.sidebar', v ? 'mini' : 'open');
    setMiniState(v);
  };
  const toggle = (
    <button type="button" onClick={() => setMini(!mini)} aria-label={mini ? '메뉴 펼치기' : '메뉴 최소화'} title={mini ? '메뉴 펼치기' : '메뉴 최소화'} className="icon-btn" style={{ flex: 'none', width: 28, height: 28, borderRadius: 7, color: 'var(--text-3)', fontSize: 14 }}>
      {mini ? '»' : '«'}
    </button>
  );

  return (
    <nav
      aria-label="주 메뉴"
      style={{ width: mini ? 68 : SIDEBAR_WIDTH, flex: 'none', background: 'var(--surface)', borderRight: '1px solid var(--line)', padding: mini ? '20px 10px' : '24px 14px', display: 'flex', flexDirection: 'column', gap: mini ? 18 : 24, overflowY: 'auto', overflowX: 'hidden', transition: 'width .15s' }}
    >
      {mini ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, overflow: 'hidden' }}>
            <Brand />
          </div>
          {toggle}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 0 10px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Brand />
          </div>
          {toggle}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          onClick={palette.open}
          className="palette-btn"
          aria-label={mini ? '이동·검색 (⌘K)' : undefined}
          title={mini ? '이동·검색 (⌘K)' : undefined}
          style={mini ? { justifyContent: 'center', padding: 0 } : undefined}
        >
          <IconSearch />
          {!mini && <span>이동·검색</span>}
          {!mini && (
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 6px', borderRadius: 5, background: 'var(--chip)', color: 'var(--text-2)' }}>
              ⌘K
            </span>
          )}
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {MENU.map(({ key, label, to, Icon }) => {
            const on = screen === key || (key === 'runs' && screen === 'run');
            const b = badges[key];
            return (
              <Link
                key={key}
                to={to}
                aria-current={on ? 'page' : undefined}
                aria-label={mini ? label : undefined}
                title={mini ? label : undefined}
                className="nav-item"
                style={mini ? { justifyContent: 'center', padding: 0, position: 'relative' } : undefined}
              >
                <Icon />
                {!mini && <span>{label}</span>}
                {b && b.n > 0 &&
                  (mini ? (
                    <span style={{ position: 'absolute', top: 2, right: 4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: b.fg, color: 'var(--surface)', fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center' }}>{b.n}</span>
                  ) : (
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 999 }}>{b.n}</span>
                  ))}
              </Link>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: mini ? 'center' : undefined, padding: mini ? '0 0 6px' : '0 4px 6px 12px' }}>
          {!mini && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>앱</span>}
          <button type="button" onClick={() => dialogs.open({ kind: 'appReg' })} aria-label="만들어 둔 프로젝트 등록" title="만들어 둔 프로젝트 등록" className="icon-btn" style={{ marginLeft: mini ? 0 : 'auto', width: 28, height: 28, borderRadius: 7, color: 'var(--text-3)' }}>
            <IconPlus size={16} />
          </button>
        </div>
        {live.map((a) => (
          <AppButton key={a.code} a={a} mini={mini} current={currentApp === a.code} onClick={() => navigate(`/apps/${a.code}`)} />
        ))}
        {archived.length > 0 && !mini && (
          <>
            <button
              type="button"
              onClick={() => setArchOpen((v) => !v)}
              aria-expanded={archOpen}
              className="side-app"
              style={{ gap: 8, minHeight: 36, marginTop: 6, color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}
            >
              <span aria-hidden="true" style={{ width: 10 }}>
                {archOpen ? '▾' : '▸'}
              </span>
              보관 {archived.length}
            </button>
            {archOpen && archived.map((a) => <AppButton key={a.code} a={a} archived current={currentApp === a.code} onClick={() => navigate(`/apps/${a.code}`)} />)}
          </>
        )}
      </div>
      <div style={{ marginTop: 'auto', display: mini ? 'none' : 'flex', flexDirection: 'column', gap: 10 }}>
        <UsageCard />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
          <ThemeSwitch />
          <button type="button" onClick={logout} className="link" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
            로그아웃
          </button>
        </div>
      </div>
    </nav>
  );
}

function MobileTop() {
  const { pathname } = useLocation();
  const palette = usePalette();
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 56,
        padding: '8px 12px 8px 16px',
        paddingTop: 'max(8px, env(safe-area-inset-top))',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <Logo size={30} />
      <span className="ellipsis" style={{ fontSize: 16, fontWeight: 700 }}>
        {TITLES[screenOf(pathname)]}
      </span>
      <button type="button" onClick={palette.open} aria-label="이동·검색" className="icon-btn" style={{ marginLeft: 'auto' }}>
        <IconSearch size={20} />
      </button>
    </div>
  );
}

function MobileTabs({ onMore }: { onMore: () => void }) {
  const { pathname } = useLocation();
  const screen = screenOf(pathname);
  const badges = useNavBadges();
  const tabs = MENU.filter((t) => MOBILE_TABS.includes(t.key));
  const moreOn = !tabs.some((t) => t.key === screen || (t.key === 'runs' && screen === 'run'));
  return (
    <nav aria-label="하단 메뉴" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, display: 'flex', background: 'var(--surface)', borderTop: '1px solid var(--line)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {tabs.map(({ key, label, short, to, Icon }) => {
        const on = screen === key || (key === 'runs' && screen === 'run');
        const b = badges[key];
        return (
          <Link
            key={key}
            to={to}
            aria-current={on ? 'page' : undefined}
            style={{ flex: 1, position: 'relative', minHeight: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: on ? 'var(--accent-ink)' : 'var(--text-3)', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}
          >
            <Icon size={22} />
            <span>{short ?? label}</span>
            {b && b.n > 0 && (
              <span style={{ position: 'absolute', top: 6, left: 'calc(50% + 6px)', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: b.fg, color: 'var(--surface)', fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center' }}>{b.n}</span>
            )}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        style={{ flex: 1, minHeight: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, border: 0, background: 'none', color: moreOn ? 'var(--accent-ink)' : 'var(--text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
      >
        <IconMenu />
        <span>더보기</span>
      </button>
    </nav>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const screen = screenOf(pathname);
  const { live, archived } = useSideApps();
  const logout = useLogout();
  const dialogs = useDialogs();
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const currentApp = screen === 'app' ? pathname.split('/')[2]?.toUpperCase() : null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'var(--scrim)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto', background: 'var(--surface)', borderRadius: '16px 16px 0 0', padding: '12px 16px 24px', paddingBottom: 'max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div aria-hidden="true" style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, background: 'var(--line-strong)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 0 6px 4px' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>앱</span>
            <button type="button" onClick={() => (onClose(), dialogs.open({ kind: 'appReg' }))} aria-label="만들어 둔 프로젝트 등록" className="icon-btn" style={{ marginLeft: 'auto', width: 36, height: 36, color: 'var(--text-3)' }}>
              <IconPlus size={18} />
            </button>
          </div>
          {[...live, ...archived].map((a) => (
            <AppButton key={a.code} a={a} big archived={a.lifecycle === 'archived'} current={currentApp === a.code} onClick={() => go(`/apps/${a.code}`)} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ padding: '0 4px 6px', fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>메뉴</span>
          {MENU.filter((t) => !MOBILE_TABS.includes(t.key)).map((n) => {
            const on = screen === n.key;
            return (
              <button
                key={n.key}
                type="button"
                onClick={() => go(n.to)}
                style={{ display: 'flex', alignItems: 'center', minHeight: 48, padding: '0 8px', borderRadius: 8, border: 0, background: on ? 'var(--accent-bg)' : 'transparent', color: on ? 'var(--accent-ink)' : 'var(--text-2)', fontSize: 15, fontWeight: on ? 600 : 500, cursor: 'pointer', textAlign: 'left' }}
              >
                {n.label}
              </button>
            );
          })}
          <button type="button" onClick={logout} style={{ display: 'flex', alignItems: 'center', minHeight: 48, padding: '0 8px', borderRadius: 8, border: 0, background: 'none', color: 'var(--text-2)', fontSize: 15, fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}>
            로그아웃
          </button>
        </div>
        <UsageCard compact />
        <ThemeSwitch wide />
      </div>
    </div>
  );
}

/** 실시간 연결이 끊기면 /health로 Hub가 살아 있는지 확인한다. 꺼져 있으면 화면 전체 안내를 띄운다 */
function useHubAlive(ws: WsState): { down: boolean; check(): void } {
  const [down, setDown] = useState(false);
  const check = () =>
    void fetch('/health', { cache: 'no-store' }).then(
      (r) => setDown(!r.ok),
      () => setDown(true),
    );
  useEffect(() => {
    if (ws !== 'down') {
      setDown(false);
      return;
    }
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [ws]);
  return { down, check };
}

export function Layout({ children }: { children: ReactNode }) {
  const { m } = usePrefs();
  const ws = useWsState();
  const alive = useHubAlive(ws);
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  return (
    <div style={{ display: 'flex', height: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, lineHeight: 1.4 }}>
      {!m && <Sidebar />}
      <main id="main" style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {m && <MobileTop />}
        {ws === 'down' && (
          <div className="banner banner-risk" role="status">
            <span className="dot dot-6" style={{ background: 'var(--risk)' }} />
            실시간 연결이 끊겼어요 · 다시 연결하는 중
          </div>
        )}
        <div key={screenOf(pathname)} style={{ flex: 1, padding: m ? '16px 16px 104px' : '32px 40px 48px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {children}
        </div>
      </main>
      {m && <MobileTabs onMore={() => setMore(true)} />}
      {m && more && <MoreSheet onClose={() => setMore(false)} />}
      {alive.down && <HubDown onRetry={alive.check} />}
    </div>
  );
}
