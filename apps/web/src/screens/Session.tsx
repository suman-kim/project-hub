import { useNavigate, useParams } from 'react-router-dom';
import { useAppByCode, useAppSessions, useRuns } from '../api/queries';
import { sessionReason, sessionState } from '../components/blocks';
import { ErrorBox, Skeleton, useCopy } from '../components/ui';
import { SESSION_ST, tone } from '../lib/labels';
import { tildify } from '../lib/paths';

/**
 * Hub 밖에서 도는 새 앱 세션(claude --bg). 서버는 세션의 대화나 터미널을 흘려 주지 않아서,
 * 상태, 허락을 기다리는 명령, 원격 조종 링크, claude attach 명령만 보여 준다.
 */
export function Session() {
  const { code = '', sid = '' } = useParams();
  const navigate = useNavigate();
  const copy = useCopy();
  const app = useAppByCode(code);
  const sessions = useAppSessions(app.data?.id);
  const boot = useRuns({ kind: 'bootstrap', app: app.data?.code, limit: 1 });
  const s = sessions.data?.find((x) => x.id === sid || x.sessionId === sid);
  const bootRun = boot.data?.[0];

  if (app.isLoading || sessions.isLoading) return <Skeleton rows={4} height={44} />;
  if (sessions.error) return <ErrorBox error={sessions.error} onRetry={() => void sessions.refetch()} />;

  const st = s ? tone(SESSION_ST, sessionState(s)) : tone(SESSION_ST, 'ended');
  const attach = s?.attachCommand ?? `claude attach ${sid}`;
  const perm = s && sessionState(s) === 'permission' && s.pending;
  return (
    <div data-screen-label="새 앱 세션" className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
          <button type="button" onClick={() => navigate(-1)} style={{ minHeight: 32, padding: 0, border: 0, background: 'none', fontSize: 13, color: 'var(--text-3)', cursor: 'pointer' }}>
            ← 뒤로
          </button>
          <span aria-hidden="true">/</span>
          <span>새 앱 세션</span>
          <span aria-hidden="true">/</span>
          <span className="mono">{sid}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', minWidth: 0 }}>
            <h1 className="page-title">{s?.name ?? sid}</h1>
            <span className="pill" style={{ fontSize: 13, padding: '4px 12px', background: st.bg, color: st.fg }}>
              {s ? st.label : '지금은 돌고 있지 않아요'}
            </span>
          </div>
          <div className="page-actions">
            <button type="button" className="btn" onClick={() => navigate(`/apps/${code}`)}>
              앱 페이지
            </button>
            {bootRun && (
              <button type="button" className="btn" onClick={() => navigate(`/runs/${bootRun.id}`)}>
                시작 run {bootRun.id}
              </button>
            )}
            {s?.remoteLink && (
              <a className="btn btn-primary" href={s.remoteLink} target="_blank" rel="noreferrer">
                원격 조종 열기 ↗
              </a>
            )}
          </div>
        </div>
        {s && sessionState(s) !== 'running' && <div style={{ fontSize: 14, color: 'var(--attn)', fontWeight: 500 }}>{sessionReason(s)}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 13, color: 'var(--text-2)' }}>
          <span>
            앱 {app.data?.code} {app.data?.name}
          </span>
          {s && (
            <span>
              폴더 <span className="mono">{tildify(s.cwd)}</span>
            </span>
          )}
          <span>
            세션 <span className="mono">{s?.sessionId ?? sid}</span>
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
          터미널에서 열기
          <code className="mono" style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text)', fontSize: 13 }}>
            {attach}
          </code>
          <button type="button" className="btn btn-xs" onClick={() => void copy(attach, '복사했어요 · 터미널에 붙여 넣으세요')}>
            복사
          </button>
        </div>
      </div>
      {perm && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '14px 16px', borderRadius: 10, background: 'var(--attn-card)', border: '1px solid var(--attn-line)' }}>
          <span style={{ flex: '1 1 240px', fontSize: 14, lineHeight: 1.5 }}>
            <strong style={{ fontWeight: 600, color: 'var(--attn)' }}>허락을 기다려요</strong> ·{' '}
            <span className="mono" style={{ fontSize: 13 }}>
              {perm.tool} · {perm.cmd}
            </span>
          </span>
          <button type="button" className="btn btn-attn-solid" style={{ border: 0 }} onClick={() => void copy(attach, '복사했어요 · 터미널에서 열어 답하세요')}>
            터미널에서 답하기
          </button>
        </div>
      )}
      <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>세션 대화는 Hub 밖에서 봐요</h2>
        <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          이 세션은 Hub가 띄운 원격 조종 세션이라 대화와 터미널을 Hub로 흘려 받지 않아요. claude.ai나 Claude 앱의 원격 조종 링크에서, 또는 터미널에서 <span className="mono">{attach}</span>로 이어서 보고 답하세요. Hub는 상태와 허락을 기다리는 명령만 30초마다 읽어 와요.
        </span>
      </section>
    </div>
  );
}
