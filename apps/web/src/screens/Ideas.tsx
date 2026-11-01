import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IdeaBody, IdeaDto, IdeaKind, IdeaStatus, RunDto, RunListItemDto, TaskDto } from '@hub/shared';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { keys, useApps, useIdeas, useIdeationSettings, useRuns, useTasks } from '../api/queries';
import { AppFilter } from '../components/AppFilter';
import { Segmented } from '../components/forms';
import { useDialogs } from '../components/GlobalDialogs';
import { CodeBox, ErrorBox, Skeleton, useUi } from '../components/ui';
import { dayHour, nextAt, parseCron } from '../lib/cron';
import { when } from '../lib/format';
import { IDEA_ST, TASK_ST, tone } from '../lib/labels';
import { Markdown } from '../lib/md';
import { useTaskPanel } from '../lib/nav';
import { usePrefs } from '../lib/prefs';
import { ApproveConceptDialog } from './dialogs/ApproveConceptDialog';

type Tab = 'all' | IdeaStatus;
const TABS: Array<[Tab, string]> = [
  ['all', '전체'],
  ['pending', '검토 대기'],
  ['revising', '수정 중'],
  ['approved', '승인'],
  ['rejected', '반려'],
];
const ACTIVE = ['queued', 'running', 'input'];

export function Ideas() {
  const { m, appFilter } = usePrefs();
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const [params, setParams] = useSearchParams();
  const apps = useApps();
  const ideation = useIdeationSettings();
  const [tab, setTab] = useState<Tab>('all');
  const selId = Number(params.get('idea')) || null;
  const [detailOpen, setDetailOpen] = useState(!!selId);
  const all = useIdeas({});
  const sel = useQuery({ queryKey: keys.idea(selId ?? 0), queryFn: () => api.get<IdeaDto>(`/api/ideas/${selId}`), enabled: !!selId });
  // 주소로 연 기획에 맞춰 종류 탭을 고른다.
  const kind: IdeaKind = (params.get('type') as IdeaKind | null) ?? sel.data?.kind ?? 'feature';
  const setKind = (k: IdeaKind) => setParams({ type: k }, { replace: true });
  const select = (id: number) => {
    setParams({ type: kind, idea: String(id) }, { replace: true });
    setDetailOpen(true);
  };

  const okApp = (i: IdeaDto) => (i.kind === 'app' ? appFilter === 'all' || i.appCode === appFilter : appFilter === 'all' || i.appCode === appFilter);
  const inKind = (all.data ?? []).filter((i) => i.kind === kind && okApp(i));
  const listed = inKind
    .filter((i) => tab === 'all' || i.status === tab)
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
  const curId = selId && listed.some((i) => i.id === selId) ? selId : selId && sel.data?.kind === kind ? selId : (listed[0]?.id ?? null);
  const cur = useQuery({ queryKey: keys.idea(curId ?? 0), queryFn: () => api.get<IdeaDto>(`/api/ideas/${curId}`), enabled: !!curId });
  const appName = (code: string | null) => (code ? (apps.data?.find((a) => a.code === code)?.name ?? code) : '');

  // 머리 문구의 다음 자동 생성
  const now = new Date();
  const sched = kind === 'app' ? (ideation.data ? [nextAt(parseCron(ideation.data.cron), now)] : []) : (apps.data ?? []).filter((a) => a.repoPath && (appFilter === 'all' || a.code === appFilter)).map((a) => nextAt(parseCron(a.ideaCron), now));
  const soonest = sched.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
  const sub =
    kind === 'app'
      ? `아직 저장소가 없는 새 앱을 구상해요 · 웹 조사가 함께 들어가요 · ${soonest ? `다음 생성 · ${dayHour(soonest, now)}` : '자동 생성 꺼짐'}`
      : `Claude가 앱별 주기마다 기획을 올려요 · ${soonest ? `다음 자동 생성: ${dayHour(soonest, now)}` : '자동 생성이 꺼져 있어요'}`;

  const showList = !m || !detailOpen || !curId;
  const showDetail = !!curId && (!m || detailOpen);
  return (
    <div data-screen-label="기획 인박스" className="page">
      <div className="page-head">
        <div>
          <span className="page-sub">{sub}</span>
          <h1 className="page-title">기획 인박스</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => navigate(kind === 'app' ? '/new-app' : `/apps/${appFilter !== 'all' ? appFilter : (apps.data?.[0]?.code ?? '')}/settings`)}>
            생성 주기 설정
          </button>
          <button type="button" className="btn btn-primary" onClick={() => dialogs.open(kind === 'app' ? { kind: 'conceptGen' } : { kind: 'gen', app: appFilter === 'all' ? undefined : appFilter })}>
            {kind === 'app' ? '새 앱 기획 생성' : '기획 지금 생성'}
          </button>
        </div>
      </div>
      <AppFilter />
      <div role="tablist" aria-label="기획 종류" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' }}>
        {(
          [
            ['feature', '기능 기획'],
            ['app', '새 앱'],
          ] as Array<[IdeaKind, string]>
        ).map(([k, label]) => {
          const on = kind === k;
          const count = (all.data ?? []).filter((i) => i.kind === k && i.status === 'pending' && okApp(i)).length;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => (setKind(k), setTab('all'), setDetailOpen(false))}
              style={{ minHeight: 44, padding: '0 14px', marginBottom: -1, border: 0, borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`, background: 'none', color: on ? 'var(--text)' : 'var(--text-3)', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              {label}
              {count > 0 && <span style={{ fontSize: 12, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: 'var(--check-bg)', color: 'var(--check)' }}>{count}</span>}
            </button>
          );
        })}
      </div>
      {all.error && <ErrorBox error={all.error} onRetry={() => void all.refetch()} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        {showList && (
          <section aria-label="기획 목록" style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div role="group" aria-label="상태" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {TABS.map(([k, label]) => {
                const on = tab === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTab(k)}
                    style={{ flex: 'none', minHeight: 36, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--ink)' : 'var(--line-strong)'}`, background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--on-ink)' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                  >
                    {label}
                    <span className="mono" style={{ fontWeight: 500, opacity: 0.8 }}>
                      {k === 'all' ? inKind.length : inKind.filter((i) => i.status === k).length}
                    </span>
                  </button>
                );
              })}
            </div>
            {all.isLoading && <Skeleton rows={4} height={72} />}
            {listed.map((i) => {
              const on = i.id === curId;
              const st = tone(IDEA_ST, i.status);
              return (
                <button
                  key={i.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => select(i.id)}
                  className="list-item"
                  style={{ textAlign: 'left', width: '100%', padding: '14px 16px', borderRadius: 10, border: `1px solid ${on && !m ? 'var(--accent)' : 'var(--line)'}`, background: on && !m ? 'var(--accent-sel)' : 'var(--surface)', color: 'var(--text)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <CodeBox code={i.kind === 'app' ? (i.appCode ?? '새 앱') : (i.appCode ?? '–')} small />
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {i.kind === 'app' ? `새 앱 기획 #${i.id}` : `기획 #${i.id}`} · v{i.currentVersion}
                    </span>
                    <span className="pill" style={{ marginLeft: 'auto', background: st.bg, color: st.fg }}>
                      {st.label}
                    </span>
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{i.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{when(i.createdAt)} 생성</span>
                </button>
              );
            })}
            {!all.isLoading && !listed.length && (
              <div style={{ padding: '24px 16px', border: '1px dashed var(--line-strong)', borderRadius: 10, fontSize: 13, color: 'var(--text-3)', textAlign: 'center' }}>이 조건의 기획이 없어요</div>
            )}
          </section>
        )}
        {showDetail && cur.data && (
          <IdeaDetail key={cur.data.id} idea={cur.data} onBack={m ? () => setDetailOpen(false) : undefined} appName={appName} onSelect={select} />
        )}
        {showDetail && !cur.data && cur.isLoading && (
          <div className="card" style={{ flex: '3 1 520px' }}>
            <Skeleton rows={6} height={28} />
          </div>
        )}
        {!curId && !all.isLoading && (
          <div style={{ flex: '3 1 520px', padding: '40px 24px', border: '1px dashed var(--line-strong)', borderRadius: 12, textAlign: 'center', fontSize: 14, color: 'var(--text-3)' }}>기획이 생기면 여기에서 읽고 승인해요</div>
        )}
      </div>
    </div>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>{children}</h3>;
}

function Block({ title, children, style }: { title: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <H3>{title}</H3>
      {children}
    </div>
  );
}

const P = ({ children, size = 15 }: { children: ReactNode; size?: number }) => <p style={{ margin: 0, fontSize: size, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{children}</p>;

function IdeaDetail({ idea, onBack, appName, onSelect }: { idea: IdeaDto; onBack?: () => void; appName(code: string | null): string; onSelect(id: number): void }) {
  const { m } = usePrefs();
  const navigate = useNavigate();
  const panel = useTaskPanel();
  const versions = idea.versions ?? [];
  const [ver, setVer] = useState(idea.currentVersion);
  useEffect(() => setVer(idea.currentVersion), [idea.currentVersion]);
  const v = versions.find((x) => x.version === ver) ?? versions[versions.length - 1];
  const prev = versions.find((x) => x.version === (v?.version ?? 0) - 1);
  const isCur = v?.version === idea.currentVersion;
  const body: IdeaBody | undefined = v?.body;
  const tasks = useTasks({ app: idea.appCode ?? undefined }, !!idea.appCode && idea.status === 'approved');
  const linked = (tasks.data ?? []).filter((t) => t.ideaId === idea.id);
  const runs = useRuns({ kind: idea.kind === 'app' && idea.status === 'approved' ? 'bootstrap' : 'idea_gen', limit: 100 });
  const revRun = (runs.data ?? []).find((r) => r.kind === 'idea_gen' && r.result.idea?.ideaId === idea.id && ACTIVE.includes(r.status));
  const st = tone(IDEA_ST, idea.status);
  const c = body?.concept;

  const prevSpec = new Set((prev?.body.specItems ?? []).map((s) => s.trim()));
  const changedItem = (s: string) => isCur && !!prev && !prevSpec.has(s.trim());

  const head =
    idea.kind === 'app'
      ? `새 앱 기획 #${idea.id} · v${v?.version ?? idea.currentVersion} · ${when(idea.createdAt)} 생성`
      : `v${v?.version ?? idea.currentVersion} · ${when(idea.createdAt)} 생성`;

  return (
    <article aria-labelledby="idea-title" className="card" style={{ flex: '3 1 520px', minWidth: 0, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: idea.kind === 'app' ? 28 : 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {onBack && (
          <button type="button" className="link" style={{ alignSelf: 'flex-start', minHeight: 40, fontSize: 14 }} onClick={onBack}>
            ← 목록
          </button>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
          <CodeBox code={idea.kind === 'app' ? (idea.appCode ?? '새 앱') : (idea.appCode ?? '–')} small />
          <span>{head}</span>
          <span className="pill" style={{ marginLeft: 'auto', padding: '4px 10px', background: st.bg, color: st.fg }}>
            {st.label}
          </span>
        </div>
        <h2 id="idea-title" className="page-title" style={{ lineHeight: 1.3 }}>
          {idea.title}
        </h2>
        {c && (
          <>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: 'var(--text-2)' }}>{c.oneLiner}</p>
            <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
              대상 사용자 · <span style={{ color: 'var(--text)' }}>{c.targetUsers}</span>
            </span>
          </>
        )}
        {versions.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Segmented label="버전" options={versions.map((x) => [String(x.version), x.version === idea.currentVersion ? `v${x.version} 현재` : `v${x.version}`])} value={String(v?.version)} onChange={(x) => setVer(Number(x))} />
            {!isCur && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>앞 버전을 보는 중이에요</span>}
          </div>
        )}
        {(body?.changeSummary || v?.revisionNote) && isCur && prev && (
          <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 8, background: 'var(--bg)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            <span>
              {body?.changeSummary && (
                <>
                  <strong style={{ fontWeight: 600 }}>이전 버전에서 바뀐 점</strong> · {body.changeSummary}
                </>
              )}
              {v?.revisionNote && (
                <>
                  {body?.changeSummary && <br />}
                  <span style={{ color: 'var(--text-3)' }}>수정 요청: “{v.revisionNote}”</span>
                </>
              )}
            </span>
          </div>
        )}
        {c?.requestNote && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>이번 요청 · “{c.requestNote}”</span>}
        {c?.sourceIdeaId && (
          <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => onSelect(c.sourceIdeaId!)}>
            다른 후보에서 깊게 쓴 기획이에요 · 원래 기획 보기
          </button>
        )}
      </div>

      {!body ? (
        <span style={{ color: 'var(--text-3)' }}>기획 본문을 읽지 못했어요</span>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px' }}>
            <Block title="문제" style={{ flex: '1 1 240px' }}>
              <P>{body.problem}</P>
            </Block>
            <Block title={c ? '해결 방식' : '제안'} style={{ flex: '1 1 240px' }}>
              <P>{body.proposal}</P>
            </Block>
          </div>
          {c ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px' }}>
              <Block title="MVP 핵심 기능" style={{ flex: '1 1 240px', gap: 8 }}>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, lineHeight: 1.6 }}>
                  {c.mvpFeatures.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </Block>
              {!!body.scenarios?.length && (
                <Block title="사용 시나리오" style={{ flex: '1 1 240px', gap: 8 }}>
                  <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, lineHeight: 1.6 }}>
                    {body.scenarios.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </Block>
              )}
            </div>
          ) : (
            !!body.scenarios?.length && (
              <Block title="사용자 시나리오">
                {body.scenarios.length === 1 ? (
                  <P>{body.scenarios[0]}</P>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, lineHeight: 1.6 }}>
                    {body.scenarios.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                )}
              </Block>
            )
          )}
          {body.specItems?.length ? (
            <Block title={c ? 'MVP 명세' : '기능 명세'} style={{ gap: 8 }}>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, lineHeight: 1.6 }}>
                {body.specItems.map((s, i) => (
                  <li key={i} style={{ padding: '2px 6px', marginLeft: -6, borderRadius: 6, background: changedItem(s) ? 'var(--accent-bg)' : 'transparent' }}>
                    {s}
                    {changedItem(s) && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--accent-ink)' }}>바뀜</span>}
                  </li>
                ))}
              </ol>
            </Block>
          ) : (
            body.spec && (
              <Block title={c ? 'MVP 명세' : '기능 명세'} style={{ gap: 8 }}>
                <Markdown src={body.spec} size={15} />
              </Block>
            )
          )}
          {!c && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              <Block title="영향 범위" style={{ flex: '1 1 240px', gap: 8 }}>
                {body.impactFiles?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {body.impactFiles.map((f) => (
                      <span key={f} className="mono" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
                        {f}
                      </span>
                    ))}
                  </div>
                ) : (
                  <P size={14}>{body.impact || '–'}</P>
                )}
                {body.impactFiles?.length && body.impact ? <P size={14}>{body.impact}</P> : null}
              </Block>
              <Block title="예상 비용" style={{ flex: '1 1 180px', gap: 8 }}>
                <span style={{ fontSize: 15 }}>{idea.estimate ? idea.estimate.label : '–'}</span>
                {idea.estimate?.basis === 'default' && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>지난 실행이 모자라 기본값으로 셈했어요</span>}
              </Block>
            </div>
          )}
          {c && <ConceptResearch c={c} />}
          <TaskList idea={idea} body={body} linked={linked} onOpen={(id) => panel.open(id)} />
          {c && c.alternatives.length > 0 && <Alternatives idea={idea} runs={runs.data ?? []} onSelect={onSelect} />}
        </>
      )}

      <IdeaActions idea={idea} body={body} linked={linked} revRun={revRun} bootRun={(runs.data ?? []).find((r) => r.kind === 'bootstrap' && r.result.bootstrap?.ideaId === idea.id)} onRun={(id) => navigate(`/runs/${id}`)} />
    </article>
  );
}

function ConceptResearch({ c }: { c: NonNullable<IdeaBody['concept']> }) {
  const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return (
    <>
      <section aria-labelledby="research-h" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 18, borderRadius: 10, background: 'var(--bg)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <h3 id="research-h" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            조사
          </h3>
          <span className="pill" style={{ background: 'var(--prog-bg)', color: 'var(--prog)' }}>
            웹 조사로 채운 칸
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>비슷한 서비스</h4>
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
            {c.competitors.map((s, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', padding: '12px 14px', borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
                <div style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
                  {s.url && (
                    <a className="link" href={s.url} target="_blank" rel="noreferrer">
                      {host(s.url)} ↗
                    </a>
                  )}
                </div>
                <span style={{ flex: '1 1 220px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)' }}>
                  <span style={{ color: 'var(--text-3)' }}>이 앱과 다른 점 · </span>
                  {s.difference}
                </span>
              </div>
            ))}
            {!c.competitors.length && <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-3)' }}>비슷한 서비스를 찾지 못했어요</div>}
          </div>
        </div>
        <Block title={<span style={{ fontSize: 13 }}>시장</span>}>
          <P size={14}>{c.market}</P>
        </Block>
        {c.sources.length > 0 && (
          <Block title="참고한 자료">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {c.sources.map((u) => (
                <a key={u} className="link" href={u} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>
                  {u}
                </a>
              ))}
            </div>
          </Block>
        )}
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px 24px' }}>
        <Block title="수익 모델">
          <P size={14}>{c.monetization}</P>
        </Block>
        <Block title="기술 스택">
          <P size={14}>{c.techStack}</P>
        </Block>
        <Block title="리스크">
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: 1.6 }}>
            {c.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Block>
        <Block title="수요 검증 방법">
          <P size={14}>{c.validation}</P>
        </Block>
      </div>
    </>
  );
}

function TaskList({ idea, body, linked, onOpen }: { idea: IdeaDto; body: IdeaBody; linked: TaskDto[]; onOpen(id: string): void }) {
  const expected = body.expectedTasks ?? [];
  if (!linked.length && !expected.length) return null;
  const rowStyle = (k: number) => ({ width: '100%', display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: '6px 12px', minHeight: 48, padding: '10px 14px', border: 0, borderTop: k ? '1px solid var(--line-soft)' : 0, background: 'none', color: 'var(--text)', textAlign: 'left' as const });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <H3>{linked.length ? '만들어진 task' : `예상 task (${expected.length}개) · 승인하면 이대로 ${idea.kind === 'app' ? '새 앱의 ' : ''}할 일에 들어가요`}</H3>
      <div style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
        {linked.length
          ? linked
              .sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]))
              .map((t, k) => {
                const tp = tone(TASK_ST, t.status);
                return (
                  <button key={t.id} type="button" className="row-btn" onClick={() => onOpen(t.id)} style={{ ...rowStyle(k), cursor: 'pointer' }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 20 }}>
                      #{t.id}
                    </span>
                    <span style={{ flex: '1 1 160px', fontSize: 14 }}>{t.title}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: tp.bg, color: tp.fg }}>{tp.label}</span>
                  </button>
                );
              })
          : expected.map((t, k) => (
              <div key={k} style={rowStyle(k)}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 20 }}>
                  {k + 1}
                </span>
                <span style={{ flex: '1 1 160px', fontSize: 14 }}>{t.title}</span>
                {!!t.dependsOnIndex?.length && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>← {t.dependsOnIndex.map((d) => d + 1).join(', ')}번 다음</span>}
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>
                  {t.size ?? 'M'}
                </span>
              </div>
            ))}
      </div>
    </div>
  );
}

function Alternatives({ idea, runs, onSelect }: { idea: IdeaDto; runs: RunListItemDto[]; onSelect(id: number): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const alts = idea.versions?.find((v) => v.version === idea.currentVersion)?.body.concept?.alternatives ?? [];
  const seeded = runs.filter((r) => r.kind === 'idea_gen' && r.result.idea?.seed?.fromIdeaId === idea.id);
  const lock = seeded.find((r) => ACTIVE.includes(r.status));
  const develop = useAction(async (index: number) => {
    const run = await api.post<RunDto>(`/api/ideas/${idea.id}/develop`, { index });
    void qc.invalidateQueries({ queryKey: ['runs'] });
    ui.toast(`깊게 기획하기 시작했어요 · run ${run.id}`);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 10px' }}>
        <H3>다른 후보</H3>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>깊게 기획하면 새 기획으로 따로 생겨요 · 이 기획의 다음 버전이 아니에요</span>
      </div>
      {lock && <span style={{ fontSize: 12, color: 'var(--prog)' }}>지금 run {lock.id}에서 다른 후보를 깊게 쓰고 있어요 · 끝나면 다른 후보도 고를 수 있어요</span>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {alts.map((al, i) => {
          const mine = seeded.filter((r) => r.result.idea?.seed?.title === al.title);
          const running = mine.find((r) => ACTIVE.includes(r.status));
          const done = mine.find((r) => r.status === 'done' && r.result.idea?.resultIdeaId);
          return (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{al.title}</span>
                <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{al.oneLiner}</span>
              </div>
              {running ? (
                <button type="button" onClick={() => navigate(`/runs/${running.id}`)} style={{ marginTop: 'auto', minHeight: 40, borderRadius: 8, border: 0, background: 'var(--prog-bg)', color: 'var(--prog)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  깊게 쓰는 중 · run {running.id}
                </button>
              ) : done ? (
                <button type="button" onClick={() => onSelect(done.result.idea!.resultIdeaId!)} style={{ marginTop: 'auto', minHeight: 40, borderRadius: 8, border: 0, background: 'var(--done-bg)', color: 'var(--done)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  새 앱 기획 #{done.result.idea!.resultIdeaId} →
                </button>
              ) : (
                <button type="button" className="btn btn-sm" style={{ marginTop: 'auto' }} disabled={!!lock || develop.busy} onClick={() => void develop.run(i)}>
                  이걸로 깊게 기획
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IdeaActions({ idea, body, linked, revRun, bootRun, onRun }: { idea: IdeaDto; body?: IdeaBody; linked: TaskDto[]; revRun?: RunListItemDto; bootRun?: RunListItemDto; onRun(id: number): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'revise' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(false);
  const [approving, setApproving] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ideas'] });
    void qc.invalidateQueries({ queryKey: keys.idea(idea.id) });
    void qc.invalidateQueries({ queryKey: ['runs'] });
  };
  const approve = useAction(async () => {
    const r = await api.post<{ tasks: TaskDto[] }>(`/api/ideas/${idea.id}/approve`);
    refresh();
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    ui.toast(`승인했어요 · task ${r.tasks.length}개를 만들었어요`);
  });
  const submit = useAction(async () => {
    const text = note.trim();
    if (!text) return setErr(true);
    if (mode === 'reject') {
      await api.post(`/api/ideas/${idea.id}/reject`, { reason: text });
      ui.toast(`기획 #${idea.id}을 반려했어요`);
    } else {
      const run = await api.post<RunDto>(`/api/ideas/${idea.id}/revise`, { note: text });
      ui.toast(`수정 요청을 보냈어요 · run ${run.id}`);
    }
    setMode(null);
    setNote('');
    refresh();
  });
  const isApp = idea.kind === 'app';
  const concept = body?.concept;

  return (
    <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {idea.status === 'pending' && !mode && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={approve.busy} onClick={() => (isApp ? setApproving(true) : void approve.run())}>
            {isApp ? '승인하고 앱 시작하기' : '승인하고 task 만들기'}
          </button>
          <button type="button" className="btn" onClick={() => (setMode('revise'), setErr(false))}>
            수정 요청
          </button>
          <button type="button" className="btn" style={{ color: 'var(--risk)' }} onClick={() => (setMode('reject'), setErr(false))}>
            반려
          </button>
        </div>
      )}
      {idea.status === 'pending' && mode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="idea-note" style={{ fontSize: 13, fontWeight: 600 }}>
            {mode === 'reject' ? '반려 사유' : '무엇을 바꿀까요?'}
          </label>
          <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            {mode === 'reject' ? '반려 사유는 다음 생성 때 프롬프트에 들어가요. 같은 제안이 다시 오지 않게 구체적으로 적어 주세요.' : '요청을 보내면 Claude가 같은 기획의 다음 버전을 만들어요.'}
          </span>
          <textarea
            id="idea-note"
            rows={3}
            autoFocus
            className="textarea"
            value={note}
            aria-invalid={err}
            onChange={(e) => (setNote(e.target.value), setErr(false))}
            placeholder={mode === 'reject' ? '예: 사용자 대부분이 낮에 써서 급하지 않음' : '예: 3단계 안내는 좋은데, 건너뛰기를 첫 화면에도 둬 줘'}
          />
          {err && <span style={{ fontSize: 13, color: 'var(--risk)' }}>내용을 적어 주세요</span>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className={mode === 'reject' ? 'btn btn-danger' : 'btn btn-primary'} disabled={submit.busy} onClick={() => void submit.run()}>
              {mode === 'reject' ? '반려하기' : '요청 보내기'}
            </button>
            <button type="button" className="btn" onClick={() => setMode(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {idea.status === 'approved' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 8, background: 'var(--done-bg)', color: 'var(--done)', fontSize: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l4 4 10-10" />
            </svg>
            승인 · {isApp ? `${idea.appCode ?? concept?.app.code ?? ''} 앱을 만들었어요` : `task ${linked.length}개를 만들었어요`}
          </span>
          {isApp && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
              {idea.appCode && (
                <button type="button" className="link" onClick={() => navigate(`/apps/${idea.appCode}`)}>
                  {idea.appCode} 앱 페이지 →
                </button>
              )}
              {bootRun && (
                <button type="button" className="link" onClick={() => onRun(bootRun.id)}>
                  시작 run {bootRun.id} →
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {idea.status === 'revising' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', borderRadius: 8, background: 'var(--prog-bg)', color: 'var(--prog)', fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>수정 요청을 보냈어요 · Claude가 다음 버전을 만들고 있어요</span>
          {revRun?.result.idea?.note && <span style={{ color: 'var(--text)' }}>“{revRun.result.idea.note}”</span>}
          {revRun && (
            <button type="button" className="link" style={{ alignSelf: 'flex-start', minHeight: 36, fontWeight: 600 }} onClick={() => onRun(revRun.id)}>
              생성 run {revRun.id} 보기
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>새 버전이 오기 전까지 승인·수정 요청·반려는 잠겨 있어요</span>
        </div>
      )}
      {idea.status === 'rejected' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', borderRadius: 8, background: 'var(--muted-bg)', color: 'var(--text-2)', fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>반려</span>
          <span>사유: {idea.rejectReason ?? '–'} · 다음 생성 때 프롬프트에 들어가요.</span>
        </div>
      )}
      {approving && body && <ApproveConceptDialog idea={idea} body={body} onClose={() => setApproving(false)} />}
    </div>
  );
}
