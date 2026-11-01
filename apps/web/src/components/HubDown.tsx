import { useEffect } from 'react';

/**
 * Hub 서버에 닿지 못할 때 화면 전체에 띄운다. 몇 초마다 다시 확인하고, 다시 연결되면 저절로 사라진다.
 */
export function HubDown({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const t = setInterval(onRetry, 5000);
    return () => clearInterval(t);
  }, [onRetry]);
  return (
    <div role="alert" style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div className="card" style={{ maxWidth: 460, width: '100%', padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dot" style={{ background: 'var(--risk)' }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Hub에 연결할 수 없어요</h1>
        </div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)' }}>
          Hub 서버가 꺼져 있거나 다시 시작하는 중이에요. 터미널에서 아래 명령 중 하나로 다시 띄우세요. 연결되면 이 화면은 저절로 사라져요.
        </p>
        <pre className="mono" style={{ margin: 0, padding: '12px 14px', borderRadius: 8, background: 'var(--chip)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {`pnpm hub:install\nlaunchctl kickstart -k gui/$(id -u)/com.claude-hub.server`}
        </pre>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>로그: ~/Library/Logs/hub/server.log</span>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={onRetry}>
          지금 다시 확인
        </button>
      </div>
    </div>
  );
}
