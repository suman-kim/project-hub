import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText } from '../api/client';
import { keys, type Me } from '../api/queries';
import { Brand } from '../components/Layout';

/** 비밀번호를 정하기 전에는 Hub 토큰(~/.claude/hub-token)으로 들어온다 */
export function Login({ me }: { me: Me | undefined }) {
  const qc = useQueryClient();
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const tokenMode = me ? !me.passwordSet : false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    try {
      await api.post('/api/auth/login', { password: pw, remember });
      qc.setQueryData<Me>(keys.me, { loggedIn: true, passwordSet: me?.passwordSet ?? true });
      void qc.invalidateQueries();
    } catch (x) {
      setErr(errorText(x));
      if (x instanceof ApiError && x.status === 429) {
        setLocked(true);
        setTimeout(() => setLocked(false), 60_000);
      }
    } finally {
      setBusy(false);
    }
  };

  const disabled = locked || busy;
  return (
    <div data-screen-label="로그인" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Brand />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>로그인</h1>
          <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
            {tokenMode ? '아직 비밀번호를 정하지 않아서 Hub 토큰으로 들어와요' : '이 기기에서 처음 들어오면 비밀번호가 필요해요'}
          </span>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>{tokenMode ? 'Hub 토큰' : '비밀번호'}</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setErr('');
            }}
            disabled={locked}
            aria-invalid={!!err}
            className="input"
            style={{ minHeight: 48, fontSize: 16 }}
          />
          {tokenMode && (
            <span className="field-hint">
              토큰은 <span className="mono">~/.claude/hub-token</span>에 있어요. <span className="mono">pnpm hub:password</span>로 비밀번호를 정할 수 있어요.
            </span>
          )}
          {err && (
            <span role="alert" style={{ fontSize: 13, color: 'var(--risk)' }}>
              {err}
            </span>
          )}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14, color: 'var(--text-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 20, height: 20, margin: 0, accentColor: 'var(--accent)' }} />이 기기에서 30일 동안 로그인 유지
        </label>
        <button type="submit" disabled={disabled || !pw} className="btn btn-primary" style={{ minHeight: 48, fontSize: 15 }}>
          {busy ? '확인하는 중' : '로그인'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>5번 틀리면 10분 동안 로그인할 수 없어요</span>
      </form>
    </div>
  );
}
