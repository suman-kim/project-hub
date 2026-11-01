import { Select } from '../components/Select';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ActivityDto, AppDto, AppOverviewDto, DeployEnv, DeploymentDto, DeployStatus } from '@hub/shared';
import { DEPLOY_ENVS, DEPLOY_STATUSES } from '@hub/shared';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { keys, useActivities, useDeployments, useRepos } from '../api/queries';
import { useTaskContext } from '../api/taskContext';
import { ACTOR_FG, useActivityNav } from '../components/blocks';
import { Field, Grid } from '../components/forms';
import { Dialog, ErrorBox, Skeleton, useUi } from '../components/ui';
import { ago, dayLabel, hm, md, stamp } from '../lib/format';
import { ACTOR, DEPLOY_SOURCE, DEPLOY_ST, ENV, tone } from '../lib/labels';
import { usePrefs } from '../lib/prefs';

// ---- 단계·배포 ----

export function StageTab({ app, ov }: { app: AppDto; ov: AppOverviewDto | undefined }) {
  const { m } = usePrefs();
  const ui = useUi();
  const qc = useQueryClient();
  const ctx = useTaskContext();
  const stageActs = useActivities({ app: app.code, kind: 'app.stage', limit: 100 });
  const deploys = useDeployments(app.id);
  const repos = useRepos(app.id);
  const [env, setEnv] = useState<'all' | DeployEnv>('all');
  const [repo, setRepo] = useState<'all' | number>('all');
  const [recording, setRecording] = useState(false);
  const sync = useAction(async () => {
    await api.post('/api/deployments/sync');
    void qc.invalidateQueries({ queryKey: ['deployments'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    ui.toast('GitHub에서 배포 기록을 가져왔어요');
  });
  const setStatus = useAction(async (d: DeploymentDto, status: DeployStatus) => {
    await api.patch(`/api/deployments/${d.id}`, { status });
    void qc.invalidateQueries({ queryKey: ['deployments'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    ui.toast(`${DEPLOY_ST[d.status][0]} → ${DEPLOY_ST[status][0]}`);
  });

  const appTasks = ctx.list.filter((t) => t.appCode === app.code);
  const si = app.stage ? app.stages.findIndex((s) => s.key === app.stage) : -1;
  const enteredAt = (key: string) => (stageActs.data ?? []).find((a) => (a.data as { to?: string }).to === key)?.at ?? null;

  // 저장소 × 환경 표: 저장소·환경마다 가장 최근 배포
  const latest = ov?.latestDeployments ?? [];
  const envs = DEPLOY_ENVS.filter((e) => latest.some((d) => d.env === e));
  const repoNames = [...new Set(latest.map((d) => d.repoName ?? d.environment))];
  const list = (deploys.data ?? []).filter((d) => (env === 'all' || d.env === env) && (repo === 'all' || d.repoId === repo));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
      <section className="card" style={{ padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 10px' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>단계</h2>
          <span className="card-sub">현재 단계 {si >= 0 ? `${app.stages[si].name} (${si + 1}/${app.stages.length})` : '없음'} · 단계 이동은 위 단계 막대에서, 단계 편집은 설정 탭에서 해요</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${app.stages.length}, minmax(${m ? 120 : 0}px, 1fr))`, gap: 8, overflowX: 'auto' }}>
          {app.stages.map((s, i) => {
            const inStage = appTasks.filter((t) => t.stage === s.key);
            const left = inStage.filter((t) => !['done', 'cancelled'].includes(t.status)).length;
            const cur = i === si;
            const at = enteredAt(s.key);
            return (
              <div key={s.key} style={{ minWidth: 0, padding: '12px 14px', borderRadius: 10, border: `1px solid ${cur ? 'var(--accent)' : 'var(--line)'}`, background: cur ? 'var(--accent-sel)' : i < si ? 'var(--bg)' : 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'block', height: 4, borderRadius: 2, background: i <= si ? 'var(--accent)' : 'var(--line-strong)' }} />
                <span className="ellipsis" style={{ fontSize: 14, fontWeight: cur ? 700 : 600, color: cur ? 'var(--accent-ink)' : 'var(--text)' }}>
                  {s.name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  task {inStage.length ? `${left}/${inStage.length}` : '없음'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{at ? `${md(at)} 들어옴` : cur ? '들어온 날 모름' : ''}</span>
              </div>
            );
          })}
        </div>
        <span className="field-hint">task 수는 남은 것 / 전체예요 · 그 단계로 표시된 task와 내 할 일을 함께 세요</span>
      </section>

      <section className="card" style={{ minWidth: 0 }}>
        <div className="card-head">
          <h2>최근 배포 상태</h2>
          <span className="card-sub">저장소 × 환경마다 가장 최근 것</span>
          <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>평소에는 5분마다 가져와요</span>
            <button type="button" className="btn btn-sm" disabled={sync.busy} onClick={() => void sync.run()}>
              {sync.busy ? '가져오는 중' : '지금 가져오기'}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setRecording(true)}>
              배포 기록 남기기
            </button>
          </span>
        </div>
        {latest.length ? (
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--line-soft)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>저장소</th>
                  {envs.map((e) => (
                    <th key={e} style={th}>
                      {ENV[e]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {repoNames.map((rn) => (
                  <tr key={rn}>
                    <td className="mono" style={{ ...td, fontWeight: 500 }}>
                      {rn}
                    </td>
                    {envs.map((e) => {
                      const d = latest.find((x) => (x.repoName ?? x.environment) === rn && x.env === e);
                      if (!d) return <td key={e} style={{ ...td, color: 'var(--text-3)' }}>–</td>;
                      const st = tone(DEPLOY_ST, d.status);
                      const at = d.finishedAt ?? d.startedAt;
                      return (
                        <td key={e} style={{ ...td, background: d.status === 'failure' ? 'var(--risk-bg)' : undefined }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="pill" style={{ background: st.bg, color: st.fg }}>
                                {st.label}
                              </span>
                              <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                                {d.version ?? d.sha?.slice(0, 7) ?? ''}
                              </span>
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                              {at ? `${stamp(at)} · ${ago(at)}` : ''}
                              {d.url && (
                                <>
                                  {' · '}
                                  <a className="link" style={{ fontSize: 12 }} href={d.url} target="_blank" rel="noreferrer">
                                    주소 ↗
                                  </a>
                                </>
                              )}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-empty">아직 배포 기록이 없어요 · GitHub 배포·Actions 기록은 저장소에 GitHub이 있으면 저절로 가져와요</div>
        )}
      </section>

      <section className="card" style={{ minWidth: 0 }}>
        <div className="card-head">
          <h2>배포 목록</h2>
          <span className="card-sub">최근 것부터</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Select<'all' | DeployEnv> label="환경" size="sm" value={env} onChange={setEnv} menuWidth={160} options={[{ value: 'all', label: '모든 환경' }, ...DEPLOY_ENVS.map((e) => ({ value: e, label: ENV[e] }))]} />
            {(repos.data?.length ?? 0) > 1 && (
              <Select
                label="저장소"
                size="sm"
                value={String(repo)}
                onChange={(v) => setRepo(v === 'all' ? 'all' : Number(v))}
                menuWidth={180}
                options={[{ value: 'all', label: '모든 저장소' }, ...repos.data!.map((r) => ({ value: String(r.id), label: r.name }))]}
              />
            )}
          </span>
        </div>
        {deploys.isLoading && <Skeleton rows={4} height={40} />}
        {deploys.error && <ErrorBox error={deploys.error} />}
        {list.map((d) => {
          const st = tone(DEPLOY_ST, d.status);
          const at = d.finishedAt ?? d.startedAt;
          const editable = d.source === 'manual' || d.source === 'claude';
          return (
            <div key={d.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', minHeight: 52, padding: '10px 20px', borderTop: '1px solid var(--line-soft)', background: d.status === 'failure' ? 'var(--risk-bg)' : undefined }}>
              <span className="mono" style={{ width: 92, flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>
                {at ? stamp(at) : '–'}
              </span>
              <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className="mono ellipsis" style={{ fontSize: 13, fontWeight: 500 }}>
                    {d.repoName ?? '앱 전체'}
                  </span>
                  <span style={{ flex: 'none', fontSize: 12, padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>{ENV[d.env]}</span>
                  <span className="mono" style={{ flex: 'none', fontSize: 12, color: 'var(--text-2)' }}>
                    {d.version ?? d.sha?.slice(0, 7) ?? ''}
                  </span>
                </span>
                {d.notes && (
                  <span className="ellipsis" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {d.notes}
                  </span>
                )}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                <span>{DEPLOY_SOURCE[d.source]}</span>
                {editable ? (
                  <Select<DeployStatus>
                    label="배포 상태"
                    size="sm"
                    value={d.status}
                    disabled={setStatus.busy}
                    onChange={(x) => void setStatus.run(d, x)}
                    menuWidth={150}
                    options={DEPLOY_STATUSES.map((x) => ({ value: x, label: DEPLOY_ST[x][0], dot: tone(DEPLOY_ST, x).dot }))}
                    style={{ minHeight: 32, padding: '0 8px 0 10px', fontSize: 12, fontWeight: 600, color: st.fg, background: st.bg, borderColor: 'transparent' }}
                  />
                ) : (
                  <span className="pill" style={{ background: st.bg, color: st.fg }}>
                    {st.label}
                  </span>
                )}
                {d.url && (
                  <a className="link" style={{ fontSize: 12 }} href={d.url} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                )}
              </span>
            </div>
          );
        })}
        {deploys.data && !list.length && <div className="card-empty">이 조건의 배포가 없어요</div>}
      </section>
      {recording && <RecordDeployDialog app={app} onClose={() => setRecording(false)} />}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 20px', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', borderBottom: '1px solid var(--line-soft)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '12px 20px', borderBottom: '1px solid var(--line-soft)', verticalAlign: 'top' };

/** GitHub에 남지 않는 배포(스토어 심사 제출 등)를 직접 남긴다. 남긴 뒤 목록에서 상태를 바꿀 수 있다 */
function RecordDeployDialog({ app, onClose }: { app: AppDto; onClose(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const repos = useRepos(app.id);
  const [f, setF] = useState<{ env: DeployEnv; status: DeployStatus; version: string; notes: string; url: string; repoId: number | null }>({ env: 'store', status: 'in_progress', version: '', notes: '', url: '', repoId: null });
  const urlErr = f.url.trim() && !/^https?:\/\/\S+$/.test(f.url.trim()) ? 'http:// 또는 https://로 시작하는 주소를 넣으세요' : null;
  const save = useAction(async () => {
    await api.post(`/api/apps/${app.id}/deployments`, {
      env: f.env,
      status: f.status,
      version: f.version.trim() || null,
      notes: f.notes.trim() || null,
      url: f.url.trim() || null,
      repoId: f.repoId,
    });
    void qc.invalidateQueries({ queryKey: ['deployments'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: keys.appStatus });
    onClose();
    ui.toast('배포 기록을 남겼어요');
  });
  return (
    <Dialog label="배포 기록 남기기" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2>배포 기록 남기기</h2>
        <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>GitHub에 남지 않는 배포를 적어요 · 예: 스토어 심사 제출. 남긴 뒤 목록에서 상태를 바꿀 수 있어요(심사 중 → 성공)</span>
      </div>
      <Grid min={180}>
        <Field label="환경">
          <Select<DeployEnv> label="환경" value={f.env} onChange={(env) => setF({ ...f, env })} options={DEPLOY_ENVS.map((e) => ({ value: e, label: ENV[e] }))} />
        </Field>
        <Field label="상태">
          <Select<DeployStatus> label="상태" value={f.status} onChange={(status) => setF({ ...f, status })} options={DEPLOY_STATUSES.filter((s) => s !== 'inactive').map((s) => ({ value: s, label: DEPLOY_ST[s][0], dot: tone(DEPLOY_ST, s).dot }))} />
        </Field>
      </Grid>
      <Grid min={180}>
        <Field label="버전">
          <input className="input mono" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="1.0.3 (14)" />
        </Field>
        {(repos.data?.length ?? 0) > 0 && (
          <Field label="저장소">
            <Select label="저장소" mono value={String(f.repoId ?? '')} onChange={(v) => setF({ ...f, repoId: v ? Number(v) : null })} options={[{ value: '', label: '앱 전체' }, ...repos.data!.map((r) => ({ value: String(r.id), label: r.name }))]} />
          </Field>
        )}
      </Grid>
      <Field label="메모">
        <input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="App Store 심사 제출" />
      </Field>
      <Field label="주소" error={urlErr}>
        <input className="input mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" aria-invalid={!!urlErr} />
      </Field>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" disabled={!!urlErr || save.busy} onClick={() => void save.run()}>
          남기기
        </button>
      </div>
    </Dialog>
  );
}

// ---- 히스토리 ----

const KINDS: Array<[string, string]> = [
  ['all', '전체'],
  ['task', 'task'],
  ['run', '실행'],
  ['idea', '기획'],
  ['app', '단계·앱'],
  ['deploy', '배포'],
  ['note', '메모'],
  ['repo', '저장소'],
];
const PAGE = 50;

export function HistoryTab({ app }: { app: AppDto }) {
  const ui = useUi();
  const qc = useQueryClient();
  const [kind, setKind] = useState('all');
  const [more, setMore] = useState<ActivityDto[]>([]);
  const [ended, setEnded] = useState(false);
  const [note, setNote] = useState('');
  const first = useActivities({ app: app.code, kind: kind === 'all' ? undefined : kind, limit: PAGE });
  const nav = useActivityNav(app.code);
  const rows = [...(first.data ?? []), ...more];
  const done = ended || (first.data?.length ?? 0) < PAGE;

  const loadMore = useAction(async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const page = await api.get<ActivityDto[]>(`/api/activities?app=${app.code}&limit=${PAGE}&before=${last.id}${kind === 'all' ? '' : `&kind=${kind}`}`);
    setMore([...more, ...page]);
    if (page.length < PAGE) setEnded(true);
  });
  const addNote = useAction(async () => {
    const v = note.trim();
    if (!v) return;
    await api.post(`/api/apps/${app.id}/activities`, { summary: v });
    setNote('');
    setMore([]);
    setEnded(false);
    void qc.invalidateQueries({ queryKey: ['activities'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    ui.toast('메모를 남겼어요');
  });

  const groups = useMemo(() => {
    const out: Array<[string, ActivityDto[]]> = [];
    for (const a of rows) {
      const label = dayLabel(a.at);
      const g = out[out.length - 1];
      if (g && g[0] === label) g[1].push(a);
      else out.push([label, [a]]);
    }
    return out;
  }, [rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          aria-label="메모 남기기"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void addNote.run();
          }}
          placeholder="메모 남기기 · 예: 스토어 서류 준비 시작"
        />
        <button type="button" className="btn" disabled={!note.trim() || addNote.busy} onClick={() => void addNote.run()}>
          남기기
        </button>
      </div>
      <div role="group" aria-label="종류" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={kind === k}
            style={{ minHeight: 36, padding: '0 12px', fontSize: 12 }}
            onClick={() => {
              setKind(k);
              setMore([]);
              setEnded(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {first.isLoading && <Skeleton rows={6} height={36} />}
      {first.error && <ErrorBox error={first.error} onRetry={() => void first.refetch()} />}
      {groups.map(([label, items]) => (
        <section key={label} className="card">
          <div className="card-head" style={{ padding: '12px 20px' }}>
            <h2 style={{ fontSize: 14 }}>{label}</h2>
            <span className="mono card-sub">{items.length}</span>
          </div>
          {items.map((a) => {
            const go = nav(a);
            return (
              <button
                key={a.id}
                type="button"
                onClick={go}
                disabled={!go}
                className="activity-row"
                style={{ width: '100%', display: 'grid', gridTemplateColumns: '48px 56px minmax(0,1fr)', gap: '4px 12px', alignItems: 'baseline', minHeight: 44, padding: '10px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'none', color: 'var(--text)', textAlign: 'left', cursor: go ? 'pointer' : 'default' }}
              >
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {hm(a.at)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: ACTOR_FG[a.actor] }}>{ACTOR[a.actor]}</span>
                <span style={{ fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{a.summary}</span>
              </button>
            );
          })}
        </section>
      ))}
      {!first.isLoading && !rows.length && <div className="card card-empty" style={{ borderTop: '1px solid var(--line)' }}>이 조건의 기록이 없어요</div>}
      {rows.length > 0 && !done && (
        <button type="button" className="btn" style={{ alignSelf: 'center' }} disabled={loadMore.busy} onClick={() => void loadMore.run()}>
          {loadMore.busy ? '불러오는 중' : '더 보기'}
        </button>
      )}
    </div>
  );
}
