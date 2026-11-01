import { Select } from '../components/Select';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppDto, AppRepoDto, AppStage, DeployEnv, IdeaDto, TaskDto } from '@hub/shared';
import { DEFAULT_STAGES, DEPLOY_ENVS } from '@hub/shared';
import { api } from '../api/client';
import { useAction, useUpdateApp } from '../api/mutations';
import { keys, useActivities, useAppSessions, useDefaults, useIdeas, useMistakes, useRepos, useRuns, useTasks } from '../api/queries';
import { sessionReason, sessionState } from '../components/blocks';
import { Field, Grid, SaveBar, ScheduleEditor, Section, Segmented, Switch, ToggleChip } from '../components/forms';
import { useUi } from '../components/ui';
import { parseCron, toCron, schedError, type Sched } from '../lib/cron';
import { stamp, when } from '../lib/format';
import { ENV, RUN_ST, SESSION_ST, tone } from '../lib/labels';
import { tildify, untildify } from '../lib/paths';
import { usePrefs } from '../lib/prefs';
import { LINK_KEYS, linkLabel } from './AppPage';

/** 직접 지정할 때 칩으로 고르는 도구. 그 밖의 것(Bash(make *) 같은 것)은 아래 입력란으로 더한다 */
const TOOL_CHIPS = ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'TodoWrite'];

interface Draft {
  name: string;
  defaultBranch: string;
  repoPath: string;
  worktreeRoot: string;
  folderNames: string;
  setupCmd: string;
  checkCmd: string;
  description: string;
  stack: string;
  links: Record<string, string>;
  directionNote: string;
  sched: Sched;
  toolsMode: 'default' | 'custom';
  tools: string[];
  guardEnabled: boolean;
  stages: AppStage[];
}

function draftOf(a: AppDto): Draft {
  return {
    name: a.name,
    defaultBranch: a.defaultBranch,
    repoPath: tildify(a.repoPath),
    worktreeRoot: tildify(a.worktreeRoot),
    folderNames: a.folderNames.join(', '),
    setupCmd: a.setupCmd ?? '',
    checkCmd: a.checkCmd ?? '',
    description: a.description ?? '',
    stack: a.stack ?? '',
    links: { ...a.links },
    directionNote: a.directionNote ?? '',
    sched: parseCron(a.ideaCron),
    toolsMode: a.allowedTools ? 'custom' : 'default',
    tools: a.allowedTools ?? [],
    guardEnabled: a.guardEnabled,
    stages: a.stages.map((s) => ({ ...s })),
  };
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);
const splitList = (s: string) => s.split(/[\s,]+/).filter(Boolean);

/** 바뀐 칸만 PATCH 본문으로 */
function patchOf(d: Draft, a: AppDto, home: string | null): Partial<AppDto> {
  const p: Partial<AppDto> = {};
  const set = <K extends keyof AppDto>(k: K, v: AppDto[K]) => {
    if (JSON.stringify(v) !== JSON.stringify(a[k])) p[k] = v;
  };
  set('name', d.name.trim());
  set('defaultBranch', d.defaultBranch.trim());
  set('repoPath', nullIfEmpty(untildify(d.repoPath.trim(), home)));
  set('worktreeRoot', nullIfEmpty(untildify(d.worktreeRoot.trim(), home)));
  set('folderNames', splitList(d.folderNames));
  set('setupCmd', nullIfEmpty(d.setupCmd));
  set('checkCmd', nullIfEmpty(d.checkCmd));
  set('description', nullIfEmpty(d.description));
  set('stack', nullIfEmpty(d.stack));
  set('links', Object.fromEntries(Object.entries(d.links).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)));
  set('directionNote', nullIfEmpty(d.directionNote));
  set('ideaCron', toCron(d.sched));
  set('allowedTools', d.toolsMode === 'custom' ? d.tools : null);
  set('guardEnabled', d.guardEnabled);
  set('stages', d.stages.map((s) => ({ key: s.key, name: s.name.trim() })));
  return p;
}

function errorsOf(d: Draft, home: string | null): Record<string, string> {
  const e: Record<string, string> = {};
  const abs = (v: string) => !v.trim() || untildify(v.trim(), home).startsWith('/');
  if (!d.name.trim()) e.name = '이름을 넣으세요';
  if (!d.defaultBranch.trim()) e.defaultBranch = '기본 브랜치를 넣으세요';
  if (!abs(d.repoPath)) e.repoPath = '경로는 / 또는 ~/로 시작해요';
  if (!abs(d.worktreeRoot)) e.worktreeRoot = '경로는 / 또는 ~/로 시작해요';
  const se = schedError(d.sched);
  if (se) e.sched = se;
  if (d.toolsMode === 'custom' && !d.tools.length) e.tools = '도구를 하나 이상 고르세요';
  for (const [k, v] of Object.entries(d.links)) {
    if (v.trim() && !/^https?:\/\/\S+$/.test(v.trim())) e[`link.${k}`] = 'http:// 또는 https://로 시작하는 주소를 넣으세요';
  }
  if (d.stages.some((s) => !s.name.trim())) e.stages = '단계 이름을 넣으세요';
  if (!d.stages.length) e.stages = '단계가 하나는 있어야 해요';
  return e;
}

export function AppSettings({ app }: { app: AppDto }) {
  const ui = useUi();
  const update = useUpdateApp();
  const defaults = useDefaults();
  const repos = useRepos(app.id);
  const [draft, setDraft] = useState<Draft>(() => draftOf(app));
  const saved = useMemo(() => draftOf(app), [app]);
  const lastSaved = useRef(saved);
  // 다른 곳(WebSocket, 진행 상태 메뉴)에서 앱이 바뀌면, 고치지 않은 칸만 새 값으로 맞춘다.
  useEffect(() => {
    const before = lastSaved.current;
    lastSaved.current = saved;
    setDraft((cur) => {
      const next = { ...cur } as Record<keyof Draft, unknown>;
      (Object.keys(saved) as Array<keyof Draft>).forEach((k) => {
        if (JSON.stringify(cur[k]) === JSON.stringify(before[k])) next[k] = saved[k];
      });
      return next as unknown as Draft;
    });
  }, [saved]);

  const home = app.repoPath ?? repos.data?.[0]?.path ?? defaults.data?.worktreeRoot ?? null;
  const errors = errorsOf(draft, home);
  const patch = patchOf(draft, app, home);
  const dirtyCount = Object.keys(patch).length;
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = (k: keyof AppDto) => k in patch;

  const save = useAction(async () => {
    if (patch.stages) {
      const removed = app.stages.filter((s) => !draft.stages.some((x) => x.key === s.key));
      if (removed.length) {
        const counts = await Promise.all(removed.map((s) => api.get<TaskDto[]>(`/api/tasks?app=${app.code}&stage=${s.key}`).then((l) => l.length)));
        const total = counts.reduce((x, y) => x + y, 0);
        if (
          total &&
          !(await ui.confirm({
            title: `단계 ${removed.map((s) => s.name).join(', ')}을 뺄까요?`,
            body: `이 단계에 묶인 task ${total}개는 단계 없음이 돼요.`,
            label: '빼고 저장',
          }))
        )
          return;
      }
    }
    await update(app.id, patch);
    ui.toast('앱 설정을 저장했어요');
  });

  const noRepo = !app.repoPath && !repos.data?.length;
  return (
    <div style={{ maxWidth: 880, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {noRepo && (
        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--attn-card)', border: '1px solid var(--attn-line)', fontSize: 13, color: 'var(--attn)', lineHeight: 1.5 }}>
          저장소 경로가 없어서 실행, 기획 생성, Task Master 가져오기를 할 수 없어요. 아래에 경로를 넣고 저장하세요.
        </div>
      )}
      <OriginSection app={app} />

      <Section title="기본" dirty={['name', 'defaultBranch', 'repoPath', 'worktreeRoot', 'folderNames', 'setupCmd', 'checkCmd'].some((k) => dirty(k as keyof AppDto))}>
        <Grid>
          <Field label="이름" error={errors.name}>
            <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!errors.name} />
          </Field>
          <Field label="기본 브랜치" error={errors.defaultBranch}>
            <input className="input mono" value={draft.defaultBranch} onChange={(e) => set({ defaultBranch: e.target.value })} aria-invalid={!!errors.defaultBranch} />
          </Field>
        </Grid>
        <Field label="저장소 경로" error={errors.repoPath} hint="저장소가 여러 개면 앱 폴더를 넣고, 아래 저장소 칸에서 각 저장소를 찾아요">
          <input className="input mono" value={draft.repoPath} onChange={(e) => set({ repoPath: e.target.value })} placeholder="~/project/my-app" aria-invalid={!!errors.repoPath} />
        </Field>
        <Field label="작업 폴더" error={errors.worktreeRoot} hint={`task마다 ${draft.worktreeRoot.trim() || tildify(defaults.data?.worktreeRoot) || '~/.hub/worktrees'}/${app.code}/${app.code}-12 처럼 worktree를 만들어요 · 비우면 Hub 기본 위치`}>
          <input className="input mono" value={draft.worktreeRoot} onChange={(e) => set({ worktreeRoot: e.target.value })} placeholder={tildify(defaults.data?.worktreeRoot) || '~/.hub/worktrees'} aria-invalid={!!errors.worktreeRoot} />
        </Field>
        <Field label="폴더 이름" hint="세션을 시작한 폴더 이름이 이 중 하나면 이 앱으로 봐요 · 쉼표로 여러 개">
          <input className="input mono" value={draft.folderNames} onChange={(e) => set({ folderNames: e.target.value })} placeholder="my-app, my-app-web" />
        </Field>
        <Grid>
          <Field label="setup_cmd" hint="worktree를 만든 직후 한 번 실행해요">
            <input className="input mono" value={draft.setupCmd} onChange={(e) => set({ setupCmd: e.target.value })} placeholder="pnpm install" />
          </Field>
          <Field label="가드" hint="push 전에 실행해요 · 실패하면 PR을 만들지 않아요">
            <input className="input mono" value={draft.checkCmd} onChange={(e) => set({ checkCmd: e.target.value })} placeholder="pnpm test" />
          </Field>
        </Grid>
      </Section>

      <Section title="앱 정보" sub="앱 페이지 머리에 보여요" dirty={dirty('description') || dirty('stack') || dirty('links')}>
        <Field label="소개">
          <input className="input" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="한 줄 소개" />
        </Field>
        <Field label="기술 스택">
          <input className="input" value={draft.stack} onChange={(e) => set({ stack: e.target.value })} placeholder="Flutter + NestJS + PostgreSQL" />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="field-label">링크</span>
          {[...LINK_KEYS, ...Object.keys(draft.links).filter((k) => !LINK_KEYS.includes(k))].map((k) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{linkLabel(k)}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input
                  className="input mono"
                  aria-label={linkLabel(k)}
                  value={draft.links[k] ?? ''}
                  onChange={(e) => set({ links: { ...draft.links, [k]: e.target.value } })}
                  placeholder="https://"
                  aria-invalid={!!errors[`link.${k}`]}
                />
                {errors[`link.${k}`] && <span className="field-error">{errors[`link.${k}`]}</span>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <StagesSection draft={draft} set={set} app={app} error={errors.stages} dirty={dirty('stages')} />

      <Section title="기획" dirty={dirty('directionNote') || dirty('ideaCron')}>
        <Field label="방향성 메모" hint="기획을 생성할 때 프롬프트 맨 앞에 들어가요">
          <textarea className="textarea" rows={3} value={draft.directionNote} onChange={(e) => set({ directionNote: e.target.value })} placeholder="이 앱에서 지금 중요한 것" />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="field-label">자동 생성 주기</span>
          <ScheduleEditor value={draft.sched} onChange={(sched) => set({ sched })} />
          <span className="field-hint">5시간·7일 사용량 중 하나라도 80%를 넘으면 그 회차는 건너뛰어요</span>
        </div>
      </Section>

      <Section title="실행" dirty={dirty('allowedTools') || dirty('guardEnabled')}>
        <span className="field-label">허용 도구</span>
        <Segmented
          label="허용 도구"
          options={[
            ['default', 'Hub 기본값'],
            ['custom', '직접 지정'],
          ]}
          value={draft.toolsMode}
          onChange={(mode) => set({ toolsMode: mode, tools: mode === 'custom' && !draft.tools.length ? [...(defaults.data?.allowedTools ?? [])] : draft.tools })}
        />
        {draft.toolsMode === 'default' ? (
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
            {(defaults.data?.allowedTools ?? []).join(', ')}
          </span>
        ) : (
          <ToolsEditor tools={draft.tools} onChange={(tools) => set({ tools })} />
        )}
        {errors.tools && <span className="field-error">{errors.tools}</span>}
        {draft.toolsMode === 'custom' && !draft.tools.some((t) => t.startsWith('Bash')) && (
          <span style={{ fontSize: 13, color: 'var(--attn)' }}>Bash가 없으면 테스트와 커밋을 못 해서 run이 "커밋 없음"으로 끝나요</span>
        )}
        <span className="field-hint">push와 PR은 Hub가 직접 해요 · Claude에게는 push 권한을 주지 않아요 · 바꾼 도구는 새 실행부터 적용돼요</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="field-label">task 없는 세션 막기</span>
            <span className="field-hint">이 앱 폴더에서 연 세션은 진행 중인 task를 잡기 전까지 파일 수정과 Bash를 못 써요 · 세션이 task를 진행 중으로 바꾸면 풀려요</span>
          </div>
          <Switch label="task 없는 세션 막기" checked={draft.guardEnabled} onChange={(v) => set({ guardEnabled: v })} />
        </div>
      </Section>

      <ReposSection app={app} home={home} />
      <MistakesSection app={app} />
      <TaskMasterSection app={app} />
      <DeleteSection app={app} />

      <SaveBar
        count={dirtyCount}
        error={Object.keys(errors).length ? '빨간 칸을 먼저 고쳐 주세요' : null}
        busy={save.busy}
        onRevert={() => setDraft(saved)}
        onSave={() => void save.run()}
      />
    </div>
  );
}

function ToolsEditor({ tools, onChange }: { tools: string[]; onChange(t: string[]): void }) {
  const [extra, setExtra] = useState('');
  const others = tools.filter((t) => !TOOL_CHIPS.includes(t));
  const add = () => {
    const v = extra.trim();
    if (v && !tools.includes(v)) onChange([...tools, v]);
    setExtra('');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {TOOL_CHIPS.map((t) => {
          const on = tools.includes(t);
          return (
            <ToggleChip key={t} mono on={on} onClick={() => onChange(on ? tools.filter((x) => x !== t) : [...tools, t])}>
              {t}
            </ToggleChip>
          );
        })}
      </div>
      {others.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {others.map((t) => (
            <span key={t} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 4px 4px 10px', borderRadius: 999, background: 'var(--chip)', color: 'var(--text-2)' }}>
              {t}
              <button type="button" aria-label={`${t} 빼기`} onClick={() => onChange(tools.filter((x) => x !== t))} style={{ width: 22, height: 22, border: 0, borderRadius: 999, background: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input mono"
          style={{ flex: 1 }}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Bash(make *) 같은 규칙 · Enter로 더하기"
          aria-label="도구 규칙 더하기"
        />
        <button type="button" className="btn" onClick={add} disabled={!extra.trim()}>
          더하기
        </button>
      </div>
    </div>
  );
}

function StagesSection({ draft, set, app, error, dirty }: { draft: Draft; set(p: Partial<Draft>): void; app: AppDto; error?: string; dirty: boolean }) {
  const stages = draft.stages;
  const move = (i: number, d: -1 | 1) => {
    const next = [...stages];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set({ stages: next });
  };
  const isDefault = JSON.stringify(stages.map((s) => [s.key, s.name])) === JSON.stringify(DEFAULT_STAGES.map((s) => [s.key, s.name]));
  return (
    <Section
      title="단계"
      sub={`앱 페이지 머리의 단계 막대예요 · 현재 단계 ${app.stages.find((s) => s.key === app.stage)?.name ?? '없음'}`}
      dirty={dirty}
      right={
        !isDefault && (
          <button type="button" className="link" onClick={() => set({ stages: DEFAULT_STAGES.map((s) => ({ ...s })) })}>
            기본 6단계로 되돌리기
          </button>
        )
      }
    >
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stages.map((s, i) => (
          <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ width: 22, fontSize: 12, color: 'var(--text-3)', textAlign: 'right' }}>
              {i + 1}
            </span>
            <input
              className="input"
              style={{ flex: 1 }}
              aria-label={`${i + 1}번째 단계 이름`}
              value={s.name}
              maxLength={20}
              onChange={(e) => set({ stages: stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
            />
            <button type="button" className="icon-btn" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)} style={{ opacity: i === 0 ? 0.3 : 1 }}>
              ↑
            </button>
            <button type="button" className="icon-btn" aria-label="아래로" disabled={i === stages.length - 1} onClick={() => move(i, 1)} style={{ opacity: i === stages.length - 1 ? 0.3 : 1 }}>
              ↓
            </button>
            <button type="button" className="icon-btn" aria-label={`${s.name} 빼기`} disabled={stages.length <= 1} onClick={() => set({ stages: stages.filter((_, j) => j !== i) })}>
              ×
            </button>
          </li>
        ))}
      </ol>
      {error && <span className="field-error">{error}</span>}
      <button
        type="button"
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        disabled={stages.length >= 12}
        onClick={() => set({ stages: [...stages, { key: `s-${Date.now().toString(36)}`, name: '' }] })}
      >
        단계 더하기
      </button>
      <span className="field-hint">단계를 빼면 그 단계에 묶인 task는 단계 없음이 돼요 · 저장할 때 한 번 더 확인해요</span>
    </Section>
  );
}

// ---- 새 앱 기획으로 만든 앱 ----

function OriginSection({ app }: { app: AppDto }) {
  const navigate = useNavigate();
  const ui = useUi();
  const boot = useRuns({ kind: 'bootstrap', app: app.code, limit: 1 });
  const run = boot.data?.[0];
  const b = run?.result.bootstrap;
  const idea = useQuery({ queryKey: keys.idea(b?.ideaId ?? 0), queryFn: () => api.get<IdeaDto>(`/api/ideas/${b!.ideaId}`), enabled: !!b?.ideaId });
  const sessions = useAppSessions(b ? app.id : undefined);
  const retry = useAction(async () => {
    const r = await api.post<{ id: number }>(`/api/apps/${app.id}/bootstrap`);
    ui.toast('시작 단계를 다시 돌려요');
    navigate(`/runs/${r.id}`);
  });
  if (!run || !b) return null;
  const sess = sessions.data?.find((s) => s.id === b.rc?.id);
  const st = sess ? tone(SESSION_ST, sessionState(sess)) : null;
  const active = run.status === 'running' || run.status === 'queued';
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 20px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>새 앱 기획으로 만든 앱</h3>
        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>승인할 때 Hub가 폴더, 저장소, 시작 세션을 만들었어요</span>
      </div>
      <dl style={{ margin: 0, padding: '12px 20px 16px', display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '12px 16px', fontSize: 14, alignItems: 'baseline' }}>
        <dt style={{ color: 'var(--text-3)', fontSize: 13 }}>원래 기획</dt>
        <dd style={{ margin: 0 }}>
          <button type="button" className="link" onClick={() => navigate(`/ideas?idea=${b.ideaId}`)}>
            새 앱 기획 #{b.ideaId} {idea.data?.title ?? ''} →
          </button>
        </dd>
        <dt style={{ color: 'var(--text-3)', fontSize: 13 }}>GitHub</dt>
        <dd style={{ margin: 0 }}>
          {b.repoUrl ? (
            <a className="link" href={b.repoUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>
              {b.repoUrl.replace(/^https:\/\//, '')} ↗
            </a>
          ) : (
            <span style={{ color: 'var(--text-3)' }}>아직 없어요</span>
          )}
        </dd>
        <dt style={{ color: 'var(--text-3)', fontSize: 13 }}>시작 run</dt>
        <dd style={{ margin: 0 }}>
          <button type="button" className="link" onClick={() => navigate(`/runs/${run.id}`)}>
            run {run.id} · {RUN_ST[run.status][0]} →
          </button>
        </dd>
        <dt style={{ color: 'var(--text-3)', fontSize: 13 }}>시작 세션</dt>
        <dd style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          {sess && st ? (
            <>
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{sess.name ?? sess.id}</span>
                <span className="pill" style={{ background: st.bg, color: st.fg }}>
                  {st.label}
                </span>
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{sessionReason(sess)}</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                <button type="button" className="link" style={{ minHeight: 32 }} onClick={() => navigate(`/sessions/${app.code}/${sess.id}`)}>
                  Hub에서 세션 보기 →
                </button>
                {sess.remoteLink && (
                  <a className="link" style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center' }} href={sess.remoteLink} target="_blank" rel="noreferrer">
                    원격 조종 열기 ↗
                  </a>
                )}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
              {active ? '시작하는 중이에요' : b.fallbackReason ? `세션을 띄우지 못했어요 · ${b.fallbackReason}` : run.status === 'failed' ? `시작 단계가 멈췄어요 · ${run.result.reason ?? ''}` : b.rc ? `${b.rc.name} · 지금은 돌고 있지 않아요` : '세션이 없어요'}
            </span>
          )}
        </dd>
      </dl>
      <div style={{ borderTop: '1px solid var(--line-soft)', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
        <button type="button" className="btn" disabled={active || retry.busy} onClick={() => void retry.run()}>
          시작 단계 다시 돌리기
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>끝난 단계는 건너뛰고 빠진 단계만 다시 해요</span>
      </div>
    </section>
  );
}

// ---- 저장소 ----

interface RepoDraft {
  name: string;
  github: string;
  defaultBranch: string;
  setupCmd: string;
  checkCmd: string;
  deployRules: Array<{ workflow: string; env: DeployEnv }>;
}

const repoDraftOf = (r: AppRepoDto): RepoDraft => ({
  name: r.name,
  github: r.github ?? '',
  defaultBranch: r.defaultBranch,
  setupCmd: r.setupCmd ?? '',
  checkCmd: r.checkCmd ?? '',
  deployRules: r.deployRules.map((x) => ({ ...x })),
});

function ReposSection({ app, home }: { app: AppDto; home: string | null }) {
  const ui = useUi();
  const qc = useQueryClient();
  const repos = useRepos(app.id);
  const [adding, setAdding] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.repos(app.id) });
    void qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const detect = useAction(async () => {
    const before = repos.data?.length ?? 0;
    const list = await api.post<AppRepoDto[]>(`/api/apps/${app.id}/repos/detect`);
    refresh();
    ui.toast(list.length > before ? `저장소 ${list.length - before}개를 새로 찾았어요` : '새로 찾은 저장소가 없어요');
  });
  const add = useAction(async () => {
    const path = untildify((adding ?? '').trim(), home);
    if (!path.startsWith('/')) throw new Error('경로는 / 또는 ~/로 시작해요');
    await api.post(`/api/apps/${app.id}/repos`, { path });
    setAdding(null);
    refresh();
    ui.toast('저장소를 더했어요');
  });
  return (
    <Section
      title="저장소"
      sub="앱 폴더 아래 backend, frontend처럼 여러 개일 수 있어요 · 저장소에 명령을 비워 두면 앱의 setup_cmd·가드를 써요"
      right={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm" disabled={detect.busy || !app.repoPath} onClick={() => void detect.run()} title={app.repoPath ? '' : '저장소 경로를 먼저 넣으세요'}>
            {detect.busy ? '찾는 중' : '저장소 다시 찾기'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAdding('')}>
            저장소 추가
          </button>
        </div>
      }
    >
      {adding !== null && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input className="input mono" style={{ flex: '1 1 260px' }} autoFocus value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="~/project/my-app/backend" aria-label="저장소 경로" />
          <button type="button" className="btn btn-primary" disabled={!adding.trim() || add.busy} onClick={() => void add.run()}>
            더하기
          </button>
          <button type="button" className="btn" onClick={() => setAdding(null)}>
            닫기
          </button>
        </div>
      )}
      {(repos.data ?? []).map((r) => (
        <RepoEditor key={r.id} repo={r} onChanged={refresh} />
      ))}
      {repos.data && !repos.data.length && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>저장소가 없어요 · 저장소 경로를 넣고 "저장소 다시 찾기"를 누르세요</span>}
    </Section>
  );
}

function RepoEditor({ repo, onChanged }: { repo: AppRepoDto; onChanged(): void }) {
  const ui = useUi();
  const [d, setD] = useState(() => repoDraftOf(repo));
  useEffect(() => setD(repoDraftOf(repo)), [repo]);
  const saved = repoDraftOf(repo);
  const isDirty = JSON.stringify(d) !== JSON.stringify(saved);
  const ghErr = d.github.trim() && !/^[\w.-]+\/[\w.-]+$/.test(d.github.trim()) ? 'owner/repo 모양으로 넣으세요' : null;
  const ruleErr = d.deployRules.some((r) => !r.workflow.trim()) ? '워크플로 이름을 넣으세요' : null;
  const set = (p: Partial<RepoDraft>) => setD((x) => ({ ...x, ...p }));
  const save = useAction(async () => {
    await api.patch(`/api/repos/${repo.id}`, {
      name: d.name.trim(),
      github: d.github.trim() || null,
      defaultBranch: d.defaultBranch.trim(),
      setupCmd: d.setupCmd.trim() || null,
      checkCmd: d.checkCmd.trim() || null,
      deployRules: d.deployRules.map((r) => ({ workflow: r.workflow.trim(), env: r.env })),
    });
    onChanged();
    ui.toast(`${d.name} 저장소를 저장했어요`);
  });
  const remove = useAction(async () => {
    if (!(await ui.confirm({ title: `${repo.name} 저장소를 뺄까요?`, body: '폴더와 git 저장소는 그대로 두고 Hub 목록에서만 빼요. 이 저장소로 정해 둔 task는 저장소 없음이 돼요.', label: '빼기' }))) return;
    await api.del(`/api/repos/${repo.id}`);
    onChanged();
  });
  return (
    <div style={{ border: `1px solid ${isDirty ? 'var(--accent)' : 'var(--line)'}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
        <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
          {repo.name}
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
          {tildify(repo.path)}
        </span>
        <button type="button" className="link" style={{ marginLeft: 'auto', color: 'var(--text-3)' }} onClick={() => void remove.run()}>
          목록에서 빼기
        </button>
      </div>
      <Grid min={200}>
        <Field label="이름">
          <input className="input mono" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="GitHub" error={ghErr}>
          <input className="input mono" value={d.github} onChange={(e) => set({ github: e.target.value })} placeholder="owner/repo" aria-invalid={!!ghErr} />
        </Field>
        <Field label="기본 브랜치">
          <input className="input mono" value={d.defaultBranch} onChange={(e) => set({ defaultBranch: e.target.value })} />
        </Field>
      </Grid>
      <Grid min={200}>
        <Field label="setup_cmd">
          <input className="input mono" value={d.setupCmd} onChange={(e) => set({ setupCmd: e.target.value })} placeholder="비우면 앱의 setup_cmd" />
        </Field>
        <Field label="가드">
          <input className="input mono" value={d.checkCmd} onChange={(e) => set({ checkCmd: e.target.value })} placeholder="비우면 앱의 가드" />
        </Field>
      </Grid>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="field-label">배포 워크플로 규칙</span>
        <span className="field-hint">GitHub Actions 워크플로 이름 → 배포 환경. 처음에는 Hub가 이름으로 짐작해 넣어요 · 예: 서버 배포 → 운영</span>
        {d.deployRules.map((r, i) => (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: '1 1 200px' }}
              aria-label="워크플로 이름"
              value={r.workflow}
              onChange={(e) => set({ deployRules: d.deployRules.map((x, j) => (j === i ? { ...x, workflow: e.target.value } : x)) })}
              placeholder="워크플로 이름"
            />
            <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
              →
            </span>
            <Select<DeployEnv> label="환경" value={r.env} onChange={(env) => set({ deployRules: d.deployRules.map((x, j) => (j === i ? { ...x, env } : x)) })} menuWidth={160} options={DEPLOY_ENVS.map((env) => ({ value: env, label: ENV[env] }))} />
            <button type="button" className="icon-btn" aria-label="규칙 빼기" onClick={() => set({ deployRules: d.deployRules.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        {ruleErr && <span className="field-error">{ruleErr}</span>}
        <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => set({ deployRules: [...d.deployRules, { workflow: '', env: 'production' }] })}>
          + 규칙 더하기
        </button>
      </div>
      {isDirty && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setD(saved)}>
            되돌리기
          </button>
          <button type="button" className="btn btn-primary" disabled={!!ghErr || !!ruleErr || !d.name.trim() || !d.defaultBranch.trim() || save.busy} onClick={() => void save.run()}>
            저장소 저장
          </button>
        </div>
      )}
    </div>
  );
}

// ---- 실수 기록, Task Master ----

function MistakesSection({ app }: { app: AppDto }) {
  const ui = useUi();
  const qc = useQueryClient();
  const list = useMistakes(app.code);
  const toggle = useAction(async (id: number, active: boolean) => {
    await api.patch(`/api/mistakes/${id}`, { active });
    await qc.invalidateQueries({ queryKey: keys.mistakes(app.code) });
    ui.toast(active ? '다음 세션부터 맥락에 넣어요' : '다음 세션부터 맥락에서 빼요');
  });
  const items = list.data ?? [];
  return (
    <Section title="실수 기록" sub="세션에서 지적받은 실수예요(record_mistake). 켜 둔 것 가운데 최근 5개가 새 세션 맥락에 들어가요">
      {items.map((m) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, opacity: m.active ? 1 : 0.6 }}>
            <span style={{ fontSize: 14, lineHeight: 1.5 }}>{m.what}</span>
            <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>→ {m.correctWay}</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{when(m.createdAt)}</span>
          </div>
          <Switch label={`${m.what} 맥락에 넣기`} checked={m.active} disabled={toggle.busy} onChange={(v) => void toggle.run(m.id, v)} />
        </div>
      ))}
      {list.data && !items.length && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>아직 기록된 실수가 없어요</span>}
    </Section>
  );
}

interface ImportResult {
  imported: number;
  updated: number;
  preview: { add: Array<{ tag: string; tmId: string; title: string }>; changed: Array<{ id: string; title: string; fields: string[] }>; same: number };
}

function TaskMasterSection({ app }: { app: AppDto }) {
  const ui = useUi();
  const qc = useQueryClient();
  const { m } = usePrefs();
  const last = useActivities({ app: app.code, kind: 'tasks.imported', limit: 1 });
  const [prev, setPrev] = useState<ImportResult | null>(null);
  const preview = useAction(async () => setPrev(await api.post<ImportResult>('/api/import/taskmaster', { app: app.code, dryRun: true, update: true })));
  const doImport = useAction(async () => {
    const r = await api.post<ImportResult>('/api/import/taskmaster', { app: app.code, update: true });
    setPrev(null);
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: ['activities'] });
    ui.toast(`task ${r.imported}개를 가져오고 ${r.updated}개를 고쳤어요`);
  });
  const off = !app.repoPath;
  const total = prev ? prev.preview.add.length + prev.preview.changed.length + prev.preview.same : 0;
  const lastAct = last.data?.[0];
  return (
    <section className="card" style={{ padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Task Master 가져오기</h3>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
            {tildify(app.repoPath) || '<저장소>'}/.taskmaster/tasks/tasks.json
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>마지막 · {lastAct ? `${stamp(lastAct.at)} · ${lastAct.summary}` : '가져온 적 없어요'}</span>
        </div>
        <button type="button" className="btn" disabled={off || preview.busy} onClick={() => void preview.run()} title={off ? '저장소 경로를 먼저 넣으세요' : ''}>
          {preview.busy ? '읽는 중' : '미리 보기'}
        </button>
      </div>
      {prev && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 8, background: 'var(--bg)', fontSize: 13, lineHeight: 1.55 }}>
          <span style={{ fontWeight: 600 }}>tasks.json에서 task {total}개를 읽었어요</span>
          {prev.preview.add.length > 0 && (
            <span>
              <span style={{ fontWeight: 600, color: 'var(--done)' }}>새로 추가 {prev.preview.add.length}개</span> · {prev.preview.add.slice(0, 4).map((x) => x.title).join(', ')}
              {prev.preview.add.length > 4 ? ` 외 ${prev.preview.add.length - 4}개` : ''}
            </span>
          )}
          <span>
            <span style={{ fontWeight: 600 }}>내용이 바뀐 task {prev.preview.changed.length}개</span> · 제목, 설명, 의존만 덮어쓰고 상태는 Hub 것을 그대로 둬요
          </span>
          <span style={{ color: 'var(--text-3)' }}>같음 {prev.preview.same}개</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {prev.preview.add.length + prev.preview.changed.length > 0 ? (
              <button type="button" className="btn btn-primary" disabled={doImport.busy} onClick={() => void doImport.run()}>
                가져오기
              </button>
            ) : (
              <span style={{ alignSelf: 'center', color: 'var(--text-3)' }}>가져올 변경이 없어요</span>
            )}
            <button type="button" className="btn" onClick={() => setPrev(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- 앱 삭제 ----

/**
 * 앱과 그 task·기획·배포 기록·히스토리·저장소 목록·규칙·실수 기록을 지운다. run 기록(비용)은 남는다.
 * 로컬 폴더와 GitHub 저장소는 그대로다. 되돌릴 수 없어서 앱 코드를 직접 입력해야 지운다.
 */
function DeleteSection({ app }: { app: AppDto }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { m } = usePrefs();
  const tasks = useTasks({ app: app.code });
  const ideas = useIdeas({ app: app.code });
  const [typed, setTyped] = useState('');
  const remove = useAction(async () => {
    if (typed !== app.code) return;
    await api.del(`/api/apps/${app.id}`);
    navigate('/');
    void qc.invalidateQueries();
    ui.toast(`${app.code} ${app.name}을 지웠어요 · 로컬 폴더와 GitHub 저장소는 그대로예요`);
  });
  return (
    <section className="card" style={{ borderColor: 'var(--risk-line)', padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--risk)' }}>앱 삭제</h3>
        <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          task {tasks.data?.length ?? '…'}개, 기획 {ideas.data?.length ?? '…'}개와 배포 기록, 히스토리, 저장소 목록, 규칙, 실수 기록이 함께 지워지고 되돌릴 수 없어요. 실행 기록은 비용 합계를 위해 남아요. 로컬 폴더와 GitHub 저장소는 건드리지 않아요.
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>잠시 손 놓는 거라면 지우지 말고 진행 상태를 "보관"으로 바꾸세요 · 사이드바 아래로 접혀요</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input className="input mono" style={{ flex: '1 1 200px' }} aria-label="앱 코드 입력" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder={`지우려면 ${app.code}를 입력하세요`} />
        <button type="button" className="btn btn-danger" disabled={typed !== app.code || remove.busy} onClick={() => void remove.run()}>
          {remove.busy ? '지우는 중' : '앱 삭제'}
        </button>
      </div>
    </section>
  );
}
