import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BugSeverity, TaskAssignee, TaskDto, TaskSize, TaskType } from '@hub/shared';
import { BUG_SEVERITIES, TASK_SIZES, TASK_TYPES } from '@hub/shared';
import { api } from '../../api/client';
import { useAction } from '../../api/mutations';
import { keys, useApps } from '../../api/queries';
import { useTaskContext } from '../../api/taskContext';
import { Field, Grid, Segmented, ToggleChip } from '../../components/forms';
import { Select } from '../../components/Select';
import { Dialog, useUi } from '../../components/ui';
import { ASSIGNEE, PRIORITY, SEVERITY, TASK_ST, TASK_TYPE, TONE } from '../../lib/labels';
import { useTaskPanel } from '../../lib/nav';

export interface CreateTaskPreset {
  app?: string;
  type?: TaskType;
  assignee?: TaskAssignee;
}

/** task 추가. 종류가 버그면 버그 칸이 펼쳐진다 */
export function CreateTaskDialog({ preset, onClose }: { preset: CreateTaskPreset; onClose(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const panel = useTaskPanel();
  const apps = useApps();
  const ctx = useTaskContext();
  const live = (apps.data ?? []).filter((a) => a.lifecycle !== 'archived');
  const [app, setApp] = useState(preset.app ?? live[0]?.code ?? '');
  const [title, setTitle] = useState('');
  const [md, setMd] = useState('');
  const [size, setSize] = useState<TaskSize>('M');
  const [deps, setDeps] = useState<string[]>([]);
  const [type, setType] = useState<TaskType>(preset.type ?? 'feature');
  const [assignee, setAssignee] = useState<TaskAssignee>(preset.assignee ?? 'claude');
  const [priority, setPriority] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const [stage, setStage] = useState('');
  const [repoId, setRepoId] = useState<number | null>(null);
  const [bug, setBug] = useState<{ severity: BugSeverity; steps: string; expected: string; actual: string; env: string; version: string }>({ severity: 'medium', steps: '', expected: '', actual: '', env: '', version: '' });

  const a = apps.data?.find((x) => x.code === app);
  const repos = ctx.reposOf(app);
  const depIds = deps;
  // 의존 task 후보: 이 앱의 task 중 취소되지 않은 것, 최신순
  const depChoices = ctx.list.filter((t) => t.appCode === app && t.status !== 'cancelled' && !deps.includes(t.id)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const ok = !!a && !!title.trim() && depIds.every((d) => ctx.byId.has(d));

  const create = useAction(async () => {
    if (!ok) return;
    const t = await api.post<TaskDto>('/api/tasks', {
      app,
      title: title.trim(),
      description: md.trim() || null,
      size,
      dependsOn: depIds,
      type,
      assignee,
      priority,
      dueDate: due || null,
      stage: stage || null,
      repoId,
      ...(type === 'bug' ? { bug: Object.fromEntries(Object.entries(bug).filter(([, v]) => v)) } : {}),
    });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: keys.apps });
    onClose();
    panel.open(t.id);
    ui.toast(`#${t.id}을 만들었어요`);
  });

  return (
    <Dialog label="task 추가" onClose={onClose} width={560}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2>task 추가</h2>
        {a && (
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
            #{a.code}-{a.nextTaskSeq}
          </span>
        )}
      </div>
      <div className="field">
        <span className="field-label">담당</span>
        <Segmented<TaskAssignee> label="담당" options={(['claude', 'me'] as const).map((k) => [k, ASSIGNEE[k]])} value={assignee} onChange={setAssignee} />
        {assignee === 'me' && <span className="field-hint">내 할 일은 Claude가 실행하지 않고, 리뷰 없이 바로 완료돼요</span>}
      </div>
      <div className="field">
        <span className="field-label">앱</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {live.map((x) => (
            <ToggleChip key={x.code} on={app === x.code} onClick={() => (setApp(x.code), setRepoId(null), setStage(''), setDeps([]))}>
              {x.name}
            </ToggleChip>
          ))}
        </div>
      </div>
      <Field label="제목">
        <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="무엇을 할지 한 줄로" />
      </Field>
      <Field
        label={
          <>
            설명 <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>markdown</span>
          </>
        }
      >
        <textarea className="textarea mono" rows={5} value={md} onChange={(e) => setMd(e.target.value)} placeholder="- 수용 기준을 목록으로" />
      </Field>
      <div className="field">
        <span className="field-label">종류</span>
        <Segmented<TaskType> label="종류" options={TASK_TYPES.map((k) => [k, TASK_TYPE[k]])} value={type} onChange={setType} />
      </div>
      {type === 'bug' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 10, background: 'var(--bg)' }}>
          <div className="field">
            <span className="field-label">심각도</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BUG_SEVERITIES.map((s) => (
                <ToggleChip key={s} on={bug.severity === s} onClick={() => setBug({ ...bug, severity: s })}>
                  <span style={{ color: bug.severity === s ? undefined : TONE[SEVERITY[s][1]].fg }}>{SEVERITY[s][0]}</span>
                </ToggleChip>
              ))}
            </div>
          </div>
          <Field label="재현 단계">
            <textarea className="textarea" rows={3} value={bug.steps} onChange={(e) => setBug({ ...bug, steps: e.target.value })} placeholder={'1. 로그인\n2. …'} />
          </Field>
          <Grid min={200}>
            <Field label="기대 결과">
              <input className="input" value={bug.expected} onChange={(e) => setBug({ ...bug, expected: e.target.value })} />
            </Field>
            <Field label="실제 결과">
              <input className="input" value={bug.actual} onChange={(e) => setBug({ ...bug, actual: e.target.value })} />
            </Field>
          </Grid>
          <Grid min={200}>
            <Field label="환경">
              <input className="input" value={bug.env} onChange={(e) => setBug({ ...bug, env: e.target.value })} placeholder="운영 · iOS 18" />
            </Field>
            <Field label="버전">
              <input className="input mono" value={bug.version} onChange={(e) => setBug({ ...bug, version: e.target.value })} placeholder="1.4.2" />
            </Field>
          </Grid>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div className="field">
          <span className="field-label">크기</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {TASK_SIZES.map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={size === z}
                onClick={() => setSize(z)}
                className="mono"
                style={{ minWidth: 44, minHeight: 44, borderRadius: 8, border: `1px solid ${size === z ? 'var(--ink)' : 'var(--line-strong)'}`, background: size === z ? 'var(--ink)' : 'var(--surface)', color: size === z ? 'var(--on-ink)' : 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {z}
              </button>
            ))}
          </div>
        </div>
        <Field label="의존 task" style={{ flex: '1 1 260px', minWidth: 0 }}>
          <Select
            label="의존 task 고르기"
            value={null}
            disabled={!depChoices.length}
            placeholder={depChoices.length ? '먼저 끝나야 하는 task 고르기 · 최신순' : '고를 task가 없어요'}
            menuWidth={420}
            searchAfter={0}
            onChange={(id) => setDeps([...deps, id])}
            options={depChoices.map((t) => ({ value: t.id, prefix: `#${t.id}`, label: t.title, badge: { text: TASK_ST[t.status][0], tone: TASK_ST[t.status][1] } }))}
          />
        </Field>
      </div>
      {depIds.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: -8 }}>
          {depIds.map((d) => {
            const t = ctx.byId.get(d);
            return (
              <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '4px 4px 4px 12px', borderRadius: 8, background: 'var(--chip)', fontSize: 13 }}>
                <span className="mono" style={{ flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>
                  #{d}
                </span>
                <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>
                  {t?.title ?? '없는 task'}
                </span>
                <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, color: !t ? 'var(--risk)' : t.status === 'done' ? 'var(--text-3)' : 'var(--attn)' }}>{t ? TASK_ST[t.status][0] : '없는 ID'}</span>
                <button type="button" className="icon-btn" aria-label={`#${d} 빼기`} onClick={() => setDeps(deps.filter((x) => x !== d))} style={{ minWidth: 32, minHeight: 32 }}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      <Grid min={150}>
        <Field label="우선순위">
          <Select
            label="우선순위"
            value={String(priority ?? '')}
            onChange={(v) => setPriority(v ? Number(v) : null)}
            options={[{ value: '', label: '정하지 않음' }, ...[1, 2, 3].map((p) => ({ value: String(p), label: PRIORITY[p] }))]}
          />
        </Field>
        <Field label="기한">
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="단계">
          <Select label="단계" value={stage} onChange={setStage} options={[{ value: '', label: '단계 없음' }, ...(a?.stages ?? []).map((s) => ({ value: s.key, label: s.name }))]} />
        </Field>
        {repos.length > 1 && (
          <Field label="저장소">
            <Select
              label="저장소"
              mono
              value={String(repoId ?? '')}
              onChange={(v) => setRepoId(v ? Number(v) : null)}
              options={[{ value: '', label: '나중에 고르기' }, ...repos.map((r) => ({ value: String(r.id), label: r.name }))]}
            />
          </Field>
        )}
      </Grid>
      <div className="dialog-actions" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" disabled={!ok || create.busy} onClick={() => void create.run()}>
          만들기
        </button>
      </div>
    </Dialog>
  );
}
