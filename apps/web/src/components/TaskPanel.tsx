import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { IdeaDto, RunDto, SpecDto, TaskBriefDto, TaskDto, TaskNote, TaskStatus } from '@hub/shared';
import { api } from '../api/client';
import { useAction, useStartRun, useUpdateTask } from '../api/mutations';
import { keys, useApps, useClaudeSessions } from '../api/queries';
import { transitionTargets, useTaskContext } from '../api/taskContext';
import { ago, dueLabel, dur, money, since, clock, hm, stamp, when } from '../lib/format';
import { tildify } from '../lib/paths';
import { ASSIGNEE, IDEA_ST, PRIORITY, RUN_ST, SEVERITY, TASK_ST, TASK_TYPE, tone, TONE } from '../lib/labels';
import { Markdown, parseMd } from '../lib/md';
import { useSessionPanel, useTaskPanel } from '../lib/nav';
import { usePrefs } from '../lib/prefs';
import { IconClose } from './icons';
import { Select } from './Select';
import { CodeBox, useCopy, useUi } from './ui';
import { SESSION_STATE, TaskSessions } from '../screens/AppSessions';
import { EditTaskDialog } from '../screens/dialogs/EditTaskDialog';

/** 어느 화면 위에서든 ?task=ID로 여는 오른쪽 패널 */
export function TaskPanelHost() {
  const { taskId, close } = useTaskPanel();
  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role=alertdialog],[role=dialog]')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!taskId) return null;
  return <TaskPanel key={taskId} id={taskId} onClose={close} />;
}

function TaskPanel({ id, onClose }: { id: string; onClose(): void }) {
  const { m } = usePrefs();
  const ui = useUi();
  const navigate = useNavigate();
  const panel = useTaskPanel();
  const ctx = useTaskContext();
  const apps = useApps();
  const task = useQuery({ queryKey: keys.task(id), queryFn: () => api.get<TaskDto>(`/api/tasks/${id}`) });
  const runs = useQuery({ queryKey: ['taskRuns', id], queryFn: () => api.get<RunDto[]>(`/api/tasks/${id}/runs`) });
  const specs = useQuery({ queryKey: ['specs', 'task', id], queryFn: () => api.get<SpecDto[]>(`/api/specs?task=${id}`) });
  const t = task.data;
  const idea = useQuery({ queryKey: keys.idea(t?.ideaId ?? 0), queryFn: () => api.get<IdeaDto>(`/api/ideas/${t!.ideaId}`), enabled: !!t?.ideaId });
  const update = useUpdateTask();
  const startRun = useStartRun();
  const [raw, setRaw] = useState(false);
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  const [note, setNote] = useState('');
  /** task 수정 창을 열었는지 */
  const [editing, setEditing] = useState(false);

  const setStatus = useAction(async (to: TaskStatus) => {
    if (!t) return;
    if (to === 'cancelled' && !(await ui.confirm({ title: `#${t.id}를 취소할까요?`, body: '취소한 task는 다시 열 수 없어요.', label: '취소로 바꾸기' }))) return;
    await update(t.id, { status: to });
    ui.toast(`${TASK_ST[t.status][0]} → ${TASK_ST[to][0]}`);
  });
  const run = useAction(async () => {
    if (!t) return;
    const r = await startRun(t.id);
    navigate(`/runs/${r.id}`);
  });
  const addNote = useAction(async () => {
    if (!t || !note.trim()) return;
    await update(t.id, { status: t.status, note: note.trim() });
    setNote('');
  });
  const copy = useCopy();
  const copyBrief = useAction(async () => {
    if (!t) return;
    const b = await api.get<TaskBriefDto>(`/api/tasks/${t.id}/brief`);
    await copy(b.text, 'task 정보를 복사했어요 · 세션이나 웹 앱 대화창에 붙여 넣으세요');
  });
  const setRepo = useAction(async (repoId: number | null) => {
    if (!t) return;
    await update(t.id, { repoId });
    ui.toast(repoId ? '저장소를 정했어요' : '저장소를 비웠어요');
  });

  // r 키로 실행 (입력 칸에 있을 때는 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key !== 'r' || e.metaKey || e.ctrlKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editing) return;
      if (t && t.assignee === 'claude' && !ctx.runBlock(t) && !run.busy) {
        e.preventDefault();
        void run.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const app = apps.data?.find((a) => a.code === t?.appCode);
  const active = t ? ctx.activeRun(t.id) : null;
  const block = t ? ctx.runBlock(t) : null;
  const blockers = t ? ctx.blockers(t) : [];
  const after = t ? ctx.list.filter((x) => x.dependsOn.includes(t.id)) : [];
  const repos = t ? ctx.reposOf(t.appCode) : [];
  const warn = parseMd(t?.description).warn;
  const notes = ((t?.metadata.notes as TaskNote[] | undefined) ?? []).slice();
  const bug = t?.metadata.bug as { severity: keyof typeof SEVERITY; steps?: string; expected?: string; actual?: string; env?: string; version?: string } | undefined;
  const st = t ? tone(TASK_ST, t.status) : null;

  const depRow = (d: TaskDto) => {
    const s = tone(TASK_ST, d.status);
    return (
      <button key={d.id} type="button" onClick={() => panel.open(d.id)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0, padding: 0, border: 0, background: 'none', fontSize: 13, color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
        <span className="mono" style={{ flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>
          #{d.id}
        </span>
        <span className="ellipsis">{d.title}</span>
        <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, color: d.status === 'done' ? 'var(--text-3)' : s.fg }}>{s.label}</span>
      </button>
    );
  };

  return (
    <>
      {m && <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 34, background: 'var(--scrim)' }} />}
      <aside
        aria-label="task 상세"
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 35, width: m ? '100vw' : 'min(720px, 62vw)', maxWidth: '100vw', overflowY: 'auto', background: 'var(--surface)', borderLeft: '1px solid var(--line)', boxShadow: '-16px 0 40px var(--shadow)' }}
      >
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', borderBottom: '1px solid var(--line-soft)', padding: '16px 20px', paddingTop: 'max(16px, env(safe-area-inset-top))', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t && <CodeBox code={t.appCode} small />}
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              #{id}
            </span>
            {st && (
              <span className="pill" style={{ background: st.bg, color: st.fg }}>
                {st.label}
              </span>
            )}
            {blockers.length > 0 && (
              <span className="pill" title="완료되지 않은 선행 task가 있어요" style={{ background: 'var(--attn-bg)', color: 'var(--attn)' }}>
                막힘
              </span>
            )}
            {t && <IdeaBadge ideaId={t.ideaId} />}
            <button type="button" onClick={onClose} aria-label="닫기 (Esc)" className="icon-btn" style={{ marginLeft: 'auto' }}>
              <IconClose size={18} />
            </button>
          </div>
          {task.error && <span style={{ color: 'var(--risk)', fontSize: 14 }}>task를 불러오지 못했어요 · {String((task.error as Error).message)}</span>}
          {t && (
            <>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.35 }}>{t.title}</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {t.assignee === 'claude' && (
                  <button type="button" className="btn btn-primary" disabled={!!block || run.busy} title={block ?? '실행 (r)'} onClick={() => void run.run()}>
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 4l12 8-12 8z" />
                    </svg>
                    실행
                  </button>
                )}
                {active && (
                  <button type="button" className="btn" onClick={() => navigate(`/runs/${active.id}`)}>
                    {active.status === 'input' ? '질문에 답하기' : '실시간 로그'}
                  </button>
                )}
                {t.prUrl && (
                  <a className="btn" href={t.prUrl} target="_blank" rel="noreferrer">
                    PR {prNo(t.prUrl)} ↗
                  </a>
                )}
                <button type="button" className="btn" title="제목, 설명, 종류, 담당, 크기, 우선순위, 기한, 단계, 태그, 선행 task를 수정해요" onClick={() => setEditing(true)}>
                  수정
                </button>
                <button type="button" className="btn" disabled={copyBrief.busy} title="설명, 진행 메모, 연결 문서까지 한 덩어리 글로 복사해요 · 어느 세션이나 웹 앱에 붙여 넣으면 바로 일할 수 있어요" onClick={() => void copyBrief.run()}>
                  task 정보 복사
                </button>
              </div>
              {/* 패널(z-index 35) 안에 그리면 패널을 가리지 못해서 body 바로 아래에 띄운다 */}
              {editing && createPortal(<EditTaskDialog task={t} onClose={() => setEditing(false)} />, document.body)}
              {app && <TaskSessions task={t} appId={app.id} />}
              {block && t.assignee === 'claude' && ['todo', 'doing', 'input'].includes(t.status) && !active && <span style={{ fontSize: 12, color: 'var(--attn)', marginTop: -4 }}>{block}</span>}
              {t.assignee === 'claude' && ['todo', 'doing', 'input'].includes(t.status) && !active && <SessionRun task={t} appId={app?.id} />}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <span style={{ marginRight: 2, fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>상태 바꾸기</span>
                {transitionTargets(t).map(({ to, ok }) => (
                  <button
                    key={to}
                    type="button"
                    disabled={!ok || setStatus.busy}
                    onClick={() => void setStatus.run(to)}
                    title={ok ? `${TASK_ST[t.status][0]} → ${TASK_ST[to][0]}` : `${TASK_ST[t.status][0]}에서는 갈 수 없어요`}
                    className="row-btn"
                    style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 500, cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.4 }}
                  >
                    {TASK_ST[to][0]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {t && (
          <div style={{ padding: '20px 20px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', gap: '10px 12px', fontSize: 13, alignItems: 'baseline' }}>
              <dt style={{ color: 'var(--text-3)' }}>앱</dt>
              <dd style={{ margin: 0 }}>{app?.name ?? t.appCode}</dd>
              <dt style={{ color: 'var(--text-3)' }}>만든 시각</dt>
              <dd style={{ margin: 0 }}>
                {when(t.createdAt)} <span style={{ color: 'var(--text-3)' }}>· {ago(t.createdAt)}</span>
                {t.updatedAt !== t.createdAt && <span style={{ color: 'var(--text-3)' }}> · 마지막 변경 {when(t.updatedAt)}</span>}
              </dd>
              <dt style={{ color: 'var(--text-3)' }}>종류</dt>
              <dd style={{ margin: 0 }}>
                {TASK_TYPE[t.type]} · 담당 {ASSIGNEE[t.assignee]}
                {t.priority ? ` · 우선순위 ${PRIORITY[t.priority]}` : ''}
              </dd>
              {(t.dueDate || t.assignee === 'me') && (
                <>
                  <dt style={{ color: 'var(--text-3)' }}>기한</dt>
                  <dd style={{ margin: 0 }}>{dueLabel(t.dueDate)}</dd>
                </>
              )}
              {app && (
                <>
                  <dt style={{ color: 'var(--text-3)' }}>단계</dt>
                  <dd style={{ margin: 0 }}>{t.stage ? (app.stages.find((s) => s.key === t.stage)?.name ?? t.stage) : '없음'}</dd>
                </>
              )}
              {repos.length > 1 && (
                <>
                  <dt style={{ color: 'var(--text-3)' }}>저장소</dt>
                  <dd style={{ margin: 0 }}>
                    <Select
                      label="저장소"
                      mono
                      size="sm"
                      value={String(t.repoId ?? '')}
                      disabled={setRepo.busy}
                      onChange={(v) => void setRepo.run(v ? Number(v) : null)}
                      placeholder="저장소를 고르세요"
                      options={repos.map((r) => ({ value: String(r.id), label: r.name }))}
                      style={{ fontSize: 12, borderColor: t.repoId ? undefined : 'var(--attn-soft)' }}
                    />
                  </dd>
                </>
              )}
              <dt style={{ color: 'var(--text-3)' }}>크기</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {t.size ?? '–'}
              </dd>
              <dt style={{ color: 'var(--text-3)' }}>브랜치</dt>
              <dd className="mono" style={{ margin: 0, fontSize: 12, overflowWrap: 'anywhere' }}>
                {t.branch ?? '–'}
              </dd>
              <dt style={{ color: 'var(--text-3)' }}>태그</dt>
              <dd style={{ margin: 0, color: 'var(--text-2)' }}>{t.tag ?? '없음'}</dd>
              <dt style={{ color: 'var(--text-3)' }}>선행</dt>
              <dd style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                {t.dependsOn.map((d) => ctx.byId.get(d)).filter((d): d is TaskDto => !!d).map(depRow)}
                {!t.dependsOn.length && <span style={{ color: 'var(--text-3)' }}>없음</span>}
              </dd>
              <dt style={{ color: 'var(--text-3)' }}>후행</dt>
              <dd style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                {after.map(depRow)}
                {!after.length && <span style={{ color: 'var(--text-3)' }}>없음</span>}
              </dd>
              <dt style={{ color: 'var(--text-3)' }}>출처 기획</dt>
              <dd style={{ margin: 0 }}>
                {t.ideaId ? (
                  <button type="button" className="link" onClick={() => navigate(`/ideas?idea=${t.ideaId}`)}>
                    {idea.data ? `${idea.data.appCode ?? '새 앱 기획'} #${idea.data.id} ${idea.data.title} · ${IDEA_ST[idea.data.status][0]}` : `기획 #${t.ideaId}`}
                  </button>
                ) : (
                  <span style={{ color: 'var(--text-3)' }}>없음</span>
                )}
              </dd>
            </dl>

            {t.type === 'bug' && bug && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>버그 정보</h3>
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', gap: '8px 12px', fontSize: 13, alignItems: 'baseline' }}>
                  <dt style={{ color: 'var(--text-3)' }}>심각도</dt>
                  <dd style={{ margin: 0 }}>
                    <span className="pill" style={{ background: tone(SEVERITY, bug.severity).bg, color: tone(SEVERITY, bug.severity).fg }}>
                      {SEVERITY[bug.severity]?.[0] ?? bug.severity}
                    </span>
                  </dd>
                  {(
                    [
                      ['재현 단계', bug.steps],
                      ['기대 결과', bug.expected],
                      ['실제 결과', bug.actual],
                      ['환경', bug.env],
                      ['버전', bug.version],
                    ] as const
                  )
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <Pair key={k} k={k} v={v!} />
                    ))}
                </dl>
              </section>
            )}

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>설명</h3>
                {warn.length > 0 && (
                  <span title="Task Master에서 가져온 설명은 형식이 고르지 않을 수 있어요" style={{ fontSize: 12, color: 'var(--attn)' }}>
                    형식 확인 필요 · {warn.join(', ')}
                  </span>
                )}
                {t.description && (
                  <button type="button" className="link" style={{ marginLeft: 'auto', minHeight: 32, fontSize: 12 }} onClick={() => setRaw((v) => !v)}>
                    {raw ? '렌더링 보기' : '원문 보기'}
                  </button>
                )}
              </div>
              {!t.description ? (
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>설명이 없어요</span>
              ) : raw ? (
                <pre className="mono" style={{ margin: 0, padding: 12, borderRadius: 8, background: 'var(--chip)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {t.description}
                </pre>
              ) : (
                <Markdown src={t.description} />
              )}
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>문서</h3>
              {specs.data?.length ? (
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                  {specs.data.map((dc) => {
                    const o = openDoc === dc.id;
                    return (
                      <div key={dc.id} style={{ borderTop: '1px solid var(--line-soft)', marginTop: -1 }}>
                        <button type="button" onClick={() => setOpenDoc(o ? null : dc.id)} className="row-btn" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '8px 14px', border: 0, background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
                          <span style={{ width: 12, fontSize: 11, color: 'var(--text-3)' }}>{o ? '▾' : '▸'}</span>
                          <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>{dc.kind === 'spec' ? '명세' : '인수인계'}</span>
                          <span className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
                            {dc.title}
                          </span>
                          <span className="mono" style={{ marginLeft: 'auto', flex: 'none', fontSize: 11, color: 'var(--text-3)' }}>
                            {dc.ideaId && !dc.taskId ? `기획 #${dc.ideaId} · ` : ''}
                            {stamp(dc.updatedAt)}
                          </span>
                        </button>
                        {o && (
                          <div style={{ padding: '4px 16px 16px 34px' }}>
                            <Markdown src={dc.body} size={13} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{specs.isLoading ? '불러오는 중' : '명세나 인수인계 문서가 없어요'}</span>
              )}
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>
                run <span className="mono" style={{ fontWeight: 500 }}>{runs.data?.length ?? ''}</span>
              </h3>
              {runs.data?.length ? (
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                  {runs.data.map((r) => {
                    const rp = tone(RUN_ST, r.status);
                    const start = r.startedAt ?? r.createdAt;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => navigate(`/runs/${r.id}`)}
                        className="row-btn"
                        style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', minHeight: 48, padding: '8px 14px', border: 0, borderTop: '1px solid var(--line-soft)', marginTop: -1, background: 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
                      >
                        <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
                          run {r.id}
                        </span>
                        <span className="pill" style={{ background: rp.bg, color: rp.fg }}>
                          {rp.label}
                        </span>
                        <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
                          {stamp(start)} · {r.endedAt ? dur((new Date(r.endedAt).getTime() - new Date(start).getTime()) / 1000) : clock(since(start))} · {money(r.costUsd)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{runs.isLoading ? '불러오는 중' : '아직 실행한 적이 없어요'}</span>
              )}
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>타임라인</h3>
              {notes.map((n, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '78px 56px minmax(0,1fr)', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {stamp(n.ts) || hm(n.ts)}
                  </span>
                  <span style={{ fontSize: 12, color: TONE[TASK_ST[n.status]?.[1] ?? 'muted'].fg }}>{TASK_ST[n.status]?.[0] ?? n.status}</span>
                  <div style={{ minWidth: 0 }}>
                    <Markdown src={n.note} size={13} compact />
                  </div>
                </div>
              ))}
              {!notes.length && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>아직 기록이 없어요</span>}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1, padding: '0 12px' }}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void addNote.run();
                  }}
                  placeholder="메모 남기기 · 상태는 그대로 둬요"
                  aria-label="메모"
                />
                <button type="button" className="btn" disabled={!note.trim() || addNote.busy} onClick={() => void addNote.run()}>
                  남기기
                </button>
              </div>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: 'var(--text-3)' }}>{k}</dt>
      <dd style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{v}</dd>
    </>
  );
}

/** 기획 인박스에서 기획을 승인해 만든 task(ideaId가 있는 task) 표시. 누르면 그 기획을 연다 */
export function IdeaBadge({ ideaId }: { ideaId: number | null }) {
  const navigate = useNavigate();
  if (!ideaId) return null;
  return (
    <button
      type="button"
      title={`기획 인박스에서 기획 #${ideaId}를 승인해 만든 task예요 · 누르면 기획을 열어요`}
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/ideas?idea=${ideaId}`);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ flex: 'none', padding: '1px 8px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'none', color: 'var(--text-2)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}
    >
      기획 #{ideaId}
    </button>
  );
}

/** https://github.com/o/r/pull/412 → #412 */
export function prNo(url: string | null | undefined): string {
  const m = url?.match(/\/pull\/(\d+)/);
  return m ? `#${m[1]}` : '';
}

/** 열린 세션에서 하기: "이 세션에서 진행하기"를 누르면 세션 화면에서 그 세션 대화를 열고 입력창에 task 정보 글을 채워 둔다 */
function SessionRun({ task, appId }: { task: TaskDto; appId: number | undefined }) {
  const sessions = useClaudeSessions(appId);
  const sessionPanel = useSessionPanel();
  // Hub가 돌리는 구현·기획 run 세션에는 맡기지 않는다.
  const list = (sessions.data ?? []).filter((s) => s.open && !(s.origin === 'hub' && s.run && s.run.kind !== 'session'));
  const assign = useAction(async (sessionId: number) => {
    const b = await api.get<TaskBriefDto>(`/api/tasks/${task.id}/brief`);
    sessionPanel.openWithDraft(sessionId, b.text);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', fontSize: 12 }}>
      <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>열린 세션에서 하기</span>
      {list.length ? (
        list.map((s) => {
          const st = tone(SESSION_STATE, s.state);
          const mine = s.task?.id === task.id;
          return (
            <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', color: 'var(--text-3)' }}>
              <button type="button" onClick={() => sessionPanel.open(s.id)} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 6px', minWidth: 0, padding: 0, border: 0, background: 'none', color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontWeight: 600, color: st.fg }}>{st.label}</span>
                <span className="mono">{tildify(s.cwd)}</span>
                <span>· {ago(s.lastAt ?? s.startedAt)}</span>
                {s.task && !mine && <span>· 지금 #{s.task.id}</span>}
              </button>
              {mine ? (
                <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--prog)' }}>이 task 진행 중</span>
              ) : (
                <button type="button" className="btn btn-xs" style={{ marginLeft: 'auto' }} disabled={assign.busy} onClick={() => void assign.run(s.id)}>
                  이 세션에서 진행하기
                </button>
              )}
            </div>
          );
        })
      ) : (
        <span style={{ color: 'var(--text-3)' }}>이 앱 폴더에서 열린 세션이 없어요 · 터미널에서 claude를 열고 위의 "task 정보 복사"로 붙여 넣으세요</span>
      )}
    </div>
  );
}
