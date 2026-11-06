import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { errorText } from '../api/client';
import { useApps } from '../api/queries';
import { tone, type Tone, TONE } from '../lib/labels';

/** 상태 배지. map은 lib/labels의 TASK_ST 같은 표 */
export function StatusPill({ map, value, dot }: { map: Record<string, [string, Tone]>; value: string; dot?: boolean }) {
  const t = tone(map, value);
  return (
    <span className="pill" style={{ background: t.bg, color: t.fg }}>
      {dot && <span className="dot dot-6" style={{ background: t.dot }} />}
      {t.label}
    </span>
  );
}

export function Pill({ tone: t = 'muted', children, style }: { tone?: Tone; children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="pill" style={{ background: TONE[t].bg, color: TONE[t].fg, ...style }}>
      {children}
    </span>
  );
}

/**
 * 프로젝트 배지. 등록된 앱 코드면 프로젝트명을 보여 주고(코드는 마우스를 올리면 보인다),
 * 앱이 아닌 값('새 앱', '–' 등)은 그대로 작은 상자로 보여 준다.
 */
export function CodeBox({ code, small, style }: { code: string; small?: boolean; style?: CSSProperties }) {
  const apps = useApps();
  const name = apps.data?.find((a) => a.code === code)?.name;
  if (!name)
    return (
      <span className={`code-box${small ? ' code-box-sm' : ''}`} style={style}>
        {code}
      </span>
    );
  return (
    <span
      title={code}
      className="ellipsis"
      style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', maxWidth: small ? 160 : 200, height: small ? 24 : 28, padding: small ? '0 8px' : '0 10px', borderRadius: 6, border: '1px solid var(--line-strong)', background: 'var(--surface)', fontSize: small ? 12 : 13, fontWeight: 600, color: 'var(--text-2)', whiteSpace: 'nowrap', ...style }}
    >
      {name}
    </span>
  );
}

export function Dot({ color, title, size = 8 }: { color: string; title?: string; size?: number }) {
  return <span className="dot" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} title={title} style={{ background: color, width: size, height: size }} />;
}

export function CardHead({ dot, title, sub, children }: { dot?: string; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card-head">
      {dot && <span aria-hidden="true" className="dot" style={{ background: dot }} />}
      <h2>{title}</h2>
      {sub && <span className="card-sub">{sub}</span>}
      {children}
    </div>
  );
}

/** 0.3초 안에 끝나는 로딩은 아무것도 띄우지 않는다 */
export function Skeleton({ rows = 3, height = 36 }: { rows?: number; height?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 20px' }} aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${92 - i * 9}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 12, background: 'var(--risk-bg)', border: '1px solid var(--risk-line)', color: 'var(--risk)', fontSize: 14 }}>
      <span style={{ flex: '1 1 240px' }}>{errorText(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          다시 불러오기
        </button>
      )}
    </div>
  );
}

// ---- 토스트와 확인 창 ----

interface ToastState {
  id: number;
  msg: string;
  error?: boolean;
  undo?: () => void;
}

interface ConfirmOptions {
  title: string;
  body?: string;
  /** 확인 버튼 이름 */
  label: string;
  /** 되돌리기 어려운 동작이면 빨간 버튼 */
  danger?: boolean;
  cancelLabel?: string;
}

interface UiApi {
  toast(msg: string, opts?: { error?: boolean; undo?: () => void }): void;
  /** 실패를 토스트로 보여 준다 */
  fail(e: unknown): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('UiProvider 밖에서 useUi를 불렀다');
  return ui;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toastState, setToast] = useState<ToastState | null>(null);
  const [confirmState, setConfirm] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!toastState) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toastState.id ? null : cur)), toastState.undo ? 6000 : toastState.error ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toastState]);

  const toast = useCallback<UiApi['toast']>((msg, opts) => setToast({ id: ++seq.current, msg, ...opts }), []);
  const fail = useCallback<UiApi['fail']>((e) => setToast({ id: ++seq.current, msg: errorText(e), error: true }), []);
  const confirm = useCallback<UiApi['confirm']>((opts) => new Promise<boolean>((resolve) => setConfirm({ ...opts, resolve })), []);
  const [api] = useState<UiApi>(() => ({ toast, fail, confirm }));

  const close = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirm(null);
  };

  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 같은 Esc로 아래 창이나 task 패널까지 닫히지 않게 표시해 둔다
      e.preventDefault();
      close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <UiContext.Provider value={api}>
      {children}
      {confirmState && (
        <div className="scrim" style={{ zIndex: 55 }} onClick={() => close(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="dialog" style={{ maxWidth: 420, gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title" style={{ fontSize: 17 }}>
              {confirmState.title}
            </h2>
            {confirmState.body && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{confirmState.body}</p>}
            <div className="dialog-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn" onClick={() => close(false)}>
                {confirmState.cancelLabel ?? '그대로 두기'}
              </button>
              <button type="button" className={confirmState.danger === false ? 'btn btn-primary' : 'btn btn-danger'} autoFocus onClick={() => close(true)}>
                {confirmState.label}
              </button>
            </div>
          </div>
        </div>
      )}
      {toastState && (
        <div role="status" className={`toast${toastState.error ? ' toast-error' : ''}`}>
          <span>{toastState.msg}</span>
          {toastState.undo && (
            <button
              type="button"
              onClick={() => {
                toastState.undo?.();
                setToast(null);
              }}
              style={{ minHeight: 32, padding: 0, border: 0, background: 'none', color: 'inherit', fontSize: 14, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' }}
            >
              되돌리기
            </button>
          )}
        </div>
      )}
    </UiContext.Provider>
  );
}

/** 바깥을 누르거나 Esc로 닫히는 가운데 창 */
export function Dialog({ onClose, children, width = 520, label }: { onClose: () => void; children: ReactNode; width?: number; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 위에 확인 창이 떠 있으면 그 창이 Esc를 받는다
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role=alertdialog]')) return;
      // 같은 Esc로 뒤의 task 패널까지 닫히지 않게 표시해 둔다
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className="dialog" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** 클립보드에 복사하고 알려 준다 */
export function useCopy() {
  const ui = useUi();
  return (text: string, label = '복사했어요') =>
    navigator.clipboard.writeText(text).then(
      () => ui.toast(label),
      () => ui.toast('복사하지 못했어요', { error: true }),
    );
}
