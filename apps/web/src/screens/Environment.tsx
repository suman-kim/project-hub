import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EnvironmentDto, KoProgressDto, McpCheckDto, McpServerDto, McpStatus, PluginDto, SkillDto } from '@hub/shared';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { useApps } from '../api/queries';
import { Segmented } from '../components/forms';
import { ErrorBox, Skeleton } from '../components/ui';
import { ago, stamp } from '../lib/format';
import { tildify } from '../lib/paths';
import { readPref, writePref } from '../lib/prefs';

type Tab = 'connectors' | 'plugins' | 'skills';
const TABS = ['connectors', 'plugins', 'skills'] as const;
/** 설명을 한국어 요약으로 볼지 원문으로 볼지 */
type Lang = 'ko' | 'en';
const LANGS = ['ko', 'en'] as const;

const MCP_ST: Record<McpStatus, { label: string; fg: string; bg: string }> = {
  connected: { label: '연결됨', fg: 'var(--done)', bg: 'var(--done-bg)' },
  needs_auth: { label: '인증 필요', fg: 'var(--attn)', bg: 'var(--attn-bg)' },
  failed: { label: '실패', fg: 'var(--risk)', bg: 'var(--risk-bg)' },
  not_configured: { label: '설정 안 됨', fg: 'var(--text-3)', bg: 'var(--chip)' },
  unknown: { label: '알 수 없음', fg: 'var(--text-3)', bg: 'var(--chip)' },
};
const MCP_ORDER: McpStatus[] = ['connected', 'needs_auth', 'failed', 'not_configured', 'unknown'];

const SKILL_SOURCE: Record<SkillDto['source'], string> = { local: '직접 설치', claude_ai: 'claude.ai 계정', plugin: '플러그인', project: '프로젝트' };

const match = (q: string, ...texts: Array<string | null | undefined>) => !q || texts.some((t) => t?.toLowerCase().includes(q));

/** 이 맥북의 Claude Code 환경: claude.ai 커넥터·MCP 서버 연결 상태, 플러그인, 스킬·슬래시 명령 */
export function Environment() {
  const qc = useQueryClient();
  const env = useQuery({ queryKey: ['environment'], queryFn: () => api.get<EnvironmentDto>('/api/environment') });
  const mcp = useQuery({
    queryKey: ['environment', 'mcp'],
    queryFn: () => api.get<McpCheckDto>('/api/environment/mcp'),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  });
  const [tab, setTabState] = useState<Tab>(() => readPref<Tab>('hub.envTab', 'connectors', TABS));
  const setTab = (t: Tab) => {
    writePref('hub.envTab', t);
    setTabState(t);
  };
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const [lang, setLangState] = useState<Lang>(() => readPref<Lang>('hub.envLang', 'ko', LANGS));
  const setLang = (l: Lang) => {
    writePref('hub.envLang', l);
    setLangState(l);
  };
  // 한국어 요약은 서버가 뒤에서 만든다. 만드는 동안 진행을 보고, 끝나면 목록을 다시 읽는다.
  const ko = useQuery({
    queryKey: ['environment', 'ko'],
    queryFn: () => api.get<KoProgressDto>('/api/environment/ko'),
    enabled: !!env.data?.ko.running,
    refetchInterval: (qq) => (qq.state.data?.running === false ? false : 3000),
  });
  const progress = ko.data ?? env.data?.ko;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (progress?.running) wasRunning.current = true;
    else if (wasRunning.current && progress) {
      wasRunning.current = false;
      void qc.invalidateQueries({ queryKey: ['environment'] });
    }
  }, [progress, qc]);

  const recheck = useAction(async () => {
    qc.setQueryData(['environment', 'mcp'], await api.post<McpCheckDto>('/api/environment/mcp/check'));
  });
  const servers = mcp.data?.servers ?? [];
  const connected = servers.filter((s) => s.status === 'connected').length;

  return (
    <div data-screen-label="스킬·커넥터" className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <span className="page-sub">
            이 맥북의 Claude Code 기준 · <span className="mono">~/.claude</span>
            {env.data && ` · ${ago(env.data.scannedAt)} 읽음`}
          </span>
          <h1 className="page-title">스킬·플러그인·커넥터</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" disabled={env.isFetching} onClick={() => void env.refetch()}>
            다시 읽기
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <Segmented
          label="보기"
          value={tab}
          onChange={setTab}
          options={[
            ['connectors', `커넥터·MCP ${mcp.data?.checkedAt ? `${connected}/${servers.length}` : ''}`.trim()],
            ['plugins', `플러그인 ${env.data?.plugins.length ?? ''}`.trim()],
            ['skills', `스킬·명령 ${env.data?.skills.length ?? ''}`.trim()],
          ]}
        />
        <input className="input" style={{ flex: '1 1 220px', maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·설명 검색" aria-label="검색" />
        <Segmented
          label="설명 언어"
          value={lang}
          onChange={setLang}
          options={[
            ['ko', '한국어 요약'],
            ['en', '원문'],
          ]}
        />
      </div>
      {progress?.running && (
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
          한국어 요약을 만드는 중이에요 · {progress.done}/{progress.total} · Claude(haiku)로 한 번 만들어 두고 다시 써요
        </span>
      )}
      {progress?.error && <span style={{ fontSize: 13, color: 'var(--risk)' }}>한국어 요약을 만들지 못했어요 · {progress.error}</span>}

      {tab === 'connectors' && <Connectors data={mcp.data} error={mcp.error} loading={mcp.isLoading} needle={needle} lang={lang} recheck={() => void recheck.run()} busy={recheck.busy} />}
      {tab !== 'connectors' && env.isLoading && <Skeleton rows={6} height={44} />}
      {tab !== 'connectors' && env.error && <ErrorBox error={env.error} onRetry={() => void env.refetch()} />}
      {tab === 'plugins' && env.data && <Plugins plugins={env.data.plugins} skills={env.data.skills} servers={servers} needle={needle} lang={lang} />}
      {tab === 'skills' && env.data && <Skills skills={env.data.skills} needle={needle} lang={lang} />}
    </div>
  );
}

function Section({ title, sub, count, children }: { title: string; sub?: string; count: number; children: ReactNode }) {
  return (
    <section className="card">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px', padding: '14px 20px' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {title} <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>{count}</span>
        </h2>
        {sub && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: McpStatus }) {
  const st = MCP_ST[status];
  return (
    <span className="pill" style={{ flex: 'none', minWidth: 64, justifyContent: 'center', background: st.bg, color: st.fg }}>
      {st.label}
    </span>
  );
}

function ServerRow({ s, lang }: { s: McpServerDto; lang: Lang }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(120px, 200px) minmax(0, 1fr)', gap: '4px 12px', alignItems: 'baseline', padding: '10px 20px', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
      <StatusPill status={s.status} />
      <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{s.name}</span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {lang === 'ko' && s.ko && <span style={{ color: 'var(--text-2)', lineHeight: 1.5 }}>{s.ko}</span>}
        <span className="mono ellipsis" title={s.target} style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {s.target || '주소 없음'}
        </span>
        {s.detail && <span style={{ fontSize: 12, color: 'var(--risk)' }}>{s.detail}</span>}
      </span>
    </div>
  );
}

function Connectors({ data, error, loading, needle, lang, recheck, busy }: { data: McpCheckDto | undefined; error: unknown; loading: boolean; needle: string; lang: Lang; recheck(): void; busy: boolean }) {
  const [status, setStatus] = useState<McpStatus | 'all'>('all');
  if (loading) return <Skeleton rows={6} height={44} />;
  if (error) return <ErrorBox error={error} />;
  const all = data?.servers ?? [];
  const shown = all.filter((s) => (status === 'all' || s.status === status) && match(needle, s.name, s.plugin, s.target, s.ko));
  const byPlugin = new Map<string, McpServerDto[]>();
  for (const s of shown.filter((x) => x.source === 'plugin')) byPlugin.set(s.plugin!, [...(byPlugin.get(s.plugin!) ?? []), s]);
  const sortSt = (a: McpServerDto, b: McpServerDto) => MCP_ORDER.indexOf(a.status) - MCP_ORDER.indexOf(b.status) || a.name.localeCompare(b.name);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <div role="group" aria-label="연결 상태" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(['all', ...MCP_ORDER.filter((k) => all.some((s) => s.status === k))] as Array<McpStatus | 'all'>).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>
              {k === 'all' ? '전체' : MCP_ST[k].label}
              <span className="chip-count">{k === 'all' ? all.length : all.filter((s) => s.status === k).length}</span>
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
          {data?.running ? '연결 상태를 확인하는 중이에요 · 30초쯤 걸려요' : data?.checkedAt ? `마지막 확인 ${stamp(data.checkedAt)} · ${ago(data.checkedAt)}` : ''}
        </span>
        <button type="button" className="btn btn-sm" disabled={busy || data?.running} onClick={recheck}>
          연결 다시 확인
        </button>
      </div>
      {data?.error && <span style={{ fontSize: 13, color: 'var(--risk)' }}>확인하지 못했어요 · {data.error}</span>}
      {!data?.checkedAt && data?.running && <Skeleton rows={4} height={44} />}
      {data?.checkedAt && (
        <>
          <Section title="claude.ai 커넥터" sub="claude.ai 계정에 연결한 커넥터 · 모든 세션에서 쓸 수 있어요" count={shown.filter((s) => s.source === 'claude_ai').length}>
            {shown.filter((s) => s.source === 'claude_ai').sort(sortSt).map((s) => <ServerRow key={`c:${s.name}`} s={s} lang={lang} />)}
            {!shown.some((s) => s.source === 'claude_ai') && <div className="card-empty">조건에 맞는 커넥터가 없어요</div>}
          </Section>
          <Section title="직접 추가한 MCP 서버" sub="claude mcp add로 이 맥북에 추가한 서버" count={shown.filter((s) => s.source === 'local').length}>
            {shown.filter((s) => s.source === 'local').sort(sortSt).map((s) => <ServerRow key={`l:${s.name}`} s={s} lang={lang} />)}
            {!shown.some((s) => s.source === 'local') && <div className="card-empty">조건에 맞는 서버가 없어요</div>}
          </Section>
          <Section title="플러그인에 딸린 MCP 서버" sub="플러그인이 함께 가져온 서버 · 인증 필요는 아직 로그인하지 않은 것이에요" count={shown.filter((s) => s.source === 'plugin').length}>
            {[...byPlugin.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([plugin, list]) => (
                <div key={plugin}>
                  <div style={{ padding: '8px 20px', borderTop: '1px solid var(--line-soft)', background: 'var(--bg)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                    {plugin} <span className="mono" style={{ fontWeight: 500, color: 'var(--text-3)' }}>{list.length}</span>
                  </div>
                  {list.sort(sortSt).map((s) => <ServerRow key={`p:${plugin}:${s.name}`} s={s} lang={lang} />)}
                </div>
              ))}
            {!byPlugin.size && <div className="card-empty">조건에 맞는 서버가 없어요</div>}
          </Section>
        </>
      )}
    </>
  );
}

function Plugins({ plugins, skills, servers, needle, lang }: { plugins: PluginDto[]; skills: SkillDto[]; servers: McpServerDto[]; needle: string; lang: Lang }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = plugins.filter((p) => match(needle, p.name, p.description, p.marketplace, p.ko));
  const group = (source: PluginDto['source']) => shown.filter((p) => p.source === source);
  const row = (p: PluginDto) => {
    const key = `${p.source}:${p.name}`;
    const o = open === key;
    const mcp = servers.filter((s) => s.source === 'plugin' && s.plugin === p.name);
    const own = skills.filter((s) => s.source === 'plugin' && s.plugin === p.name);
    return (
      <div key={key} style={{ borderTop: '1px solid var(--line-soft)' }}>
        <button type="button" className="row-btn" onClick={() => setOpen(o ? null : key)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '14px minmax(140px, 220px) minmax(0, 1fr) auto', gap: '4px 12px', alignItems: 'baseline', padding: '12px 20px', border: 0, background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{o ? '▾' : '▸'}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
            {p.version && <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.version}</span>}
            {!p.enabled && (
              <span className="pill" style={{ background: 'var(--chip)', color: 'var(--text-3)' }}>
                꺼짐
              </span>
            )}
          </span>
          <span style={{ minWidth: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{(lang === 'ko' && p.ko) || p.description || '설명 없음'}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            스킬 {p.skills} · 명령 {p.commands} · MCP {mcp.length}
          </span>
        </button>
        {o && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 14px 46px', fontSize: 12, color: 'var(--text-3)' }}>
            <span className="mono" style={{ overflowWrap: 'anywhere' }}>
              {p.marketplace && `${p.marketplace} · `}
              {tildify(p.path)}
            </span>
            {own.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {own.map((s) => (
                  <span key={s.path} title={(lang === 'ko' && s.ko) || s.description} className="mono" style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>
                    {s.kind === 'command' ? '/' : ''}
                    {s.name}
                  </span>
                ))}
              </div>
            )}
            {mcp.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {mcp.map((s) => (
                  <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                    <span style={{ color: MCP_ST[s.status].fg, fontWeight: 600 }}>{MCP_ST[s.status].label}</span>
                    <span style={{ color: 'var(--text-2)' }} title={s.ko ?? undefined}>{s.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      <Section title="claude.ai 계정에서 동기화" sub="claude.ai에서 켠 플러그인이 이 맥북에 내려받아져 있어요" count={group('claude_ai').length}>
        {group('claude_ai').map(row)}
        {!group('claude_ai').length && <div className="card-empty">조건에 맞는 플러그인이 없어요</div>}
      </Section>
      <Section title="이 맥북에 직접 설치" sub="claude plugin install로 설치 · settings.json에서 끈 것은 꺼짐으로 보여요" count={group('local').length}>
        {group('local').map(row)}
        {!group('local').length && <div className="card-empty">조건에 맞는 플러그인이 없어요</div>}
      </Section>
    </>
  );
}

function Skills({ skills, needle, lang }: { skills: SkillDto[]; needle: string; lang: Lang }) {
  const apps = useApps();
  const names = new Map((apps.data ?? []).map((a) => [a.code, a.name]));
  const [source, setSource] = useState<SkillDto['source'] | 'all'>('all');
  const sources = (['local', 'claude_ai', 'plugin', 'project'] as const).filter((k) => skills.some((s) => s.source === k));
  const shown = useMemo(
    () => skills.filter((s) => (source === 'all' || s.source === source) && match(needle, s.name, s.description, s.plugin, s.ko)).sort((a, b) => sources.indexOf(a.source as never) - sources.indexOf(b.source as never) || (a.plugin ?? a.appCode ?? '').localeCompare(b.plugin ?? b.appCode ?? '') || a.name.localeCompare(b.name)),
    [skills, source, needle, sources],
  );
  const owner = (s: SkillDto) => (s.source === 'plugin' ? s.plugin : s.source === 'project' ? (names.get(s.appCode ?? '') ?? s.appCode) : SKILL_SOURCE[s.source]);

  return (
    <>
      <div role="group" aria-label="출처" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(['all', ...sources] as Array<SkillDto['source'] | 'all'>).map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={source === k} onClick={() => setSource(k)}>
            {k === 'all' ? '전체' : SKILL_SOURCE[k]}
            <span className="chip-count">{k === 'all' ? skills.length : skills.filter((s) => s.source === k).length}</span>
          </button>
        ))}
      </div>
      <section className="card">
        {shown.map((s) => (
          <div key={s.path} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 240px) minmax(90px, 140px) minmax(0, 1fr)', gap: '4px 12px', alignItems: 'baseline', padding: '10px 20px', borderTop: '1px solid var(--line-soft)', fontSize: 13 }} title={tildify(s.path)}>
            <span className="mono" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
              {s.kind === 'command' ? '/' : ''}
              {s.source === 'plugin' && s.kind === 'skill' ? `${s.plugin}:` : ''}
              {s.name}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span className="ellipsis" style={{ padding: '1px 8px', borderRadius: 6, border: '1px solid var(--line-strong)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                {owner(s)}
              </span>
              {s.kind === 'command' && <span style={{ flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>명령</span>}
            </span>
            <span style={{ minWidth: 0, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{(lang === 'ko' && s.ko) || s.description || '설명 없음'}</span>
          </div>
        ))}
        {!shown.length && <div className="card-empty">조건에 맞는 스킬이 없어요</div>}
      </section>
    </>
  );
}
