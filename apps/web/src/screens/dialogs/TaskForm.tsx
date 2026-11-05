import type { BugSeverity, TaskAssignee, TaskDto, TaskSize, TaskType } from '@hub/shared';
import { BUG_SEVERITIES, TASK_SIZES, TASK_TYPES } from '@hub/shared';
import { useApps } from '../../api/queries';
import { useTaskContext } from '../../api/taskContext';
import { Field, Grid, Segmented, ToggleChip } from '../../components/forms';
import { Select } from '../../components/Select';
import { ASSIGNEE, PRIORITY, SEVERITY, TASK_ST, TASK_TYPE, TONE } from '../../lib/labels';

/**
 * task 추가·고치기 창이 함께 쓰는 입력 칸과 입력값.
 * 추가 창은 newDraft로 빈 값에서, 고치기 창은 draftOf로 지금 값에서 시작하고, 서버로 보낼 때는 draftPayload로 바꾼다.
 */

/** 버그 칸 입력값 (종류가 버그일 때만 보낸다) */
export interface BugDraft {
  /** 심각도 */
  severity: BugSeverity;
  /** 재현 단계 */
  steps: string;
  /** 기대 결과 */
  expected: string;
  /** 실제 결과 */
  actual: string;
  /** 환경 (운영 · iOS 18 등) */
  env: string;
  /** 버전 */
  version: string;
}

/** 창 안의 task 입력값. 빈 칸은 빈 글('')로 두고 보낼 때 null로 바꾼다 */
export interface TaskDraft {
  /** 제목 */
  title: string;
  /** 설명 markdown */
  md: string;
  /** 크기 (정하지 않으면 null) */
  size: TaskSize | null;
  /** 선행 task ID (이 task보다 먼저 끝나야 하는 것) */
  deps: string[];
  /** 종류 */
  type: TaskType;
  /** 담당 */
  assignee: TaskAssignee;
  /** 우선순위 1 높음 · 2 보통 · 3 낮음 (정하지 않으면 null) */
  priority: number | null;
  /** 기한 YYYY-MM-DD */
  due: string;
  /** 앱 단계 key */
  stage: string;
  /** 저장소 id (저장소가 여러 개인 앱) */
  repoId: number | null;
  /** 태그 */
  tag: string;
  /** 버그 칸 */
  bug: BugDraft;
}

const EMPTY_BUG: BugDraft = { severity: 'medium', steps: '', expected: '', actual: '', env: '', version: '' };

/**
 * 추가 창의 첫 값
 * @param preset 미리 고른 종류·담당
 */
export function newDraft(preset: { type?: TaskType; assignee?: TaskAssignee }): TaskDraft {
  return { title: '', md: '', size: 'M', deps: [], type: preset.type ?? 'feature', assignee: preset.assignee ?? 'claude', priority: null, due: '', stage: '', repoId: null, tag: '', bug: EMPTY_BUG };
}

/**
 * 고치기 창의 첫 값: 지금 task 값
 * @param t 고칠 task
 */
export function draftOf(t: TaskDto): TaskDraft {
  const bug = (t.metadata.bug as Partial<BugDraft> | undefined) ?? {};
  return {
    title: t.title,
    md: t.description ?? '',
    size: t.size,
    deps: t.dependsOn,
    type: t.type,
    assignee: t.assignee,
    priority: t.priority,
    due: t.dueDate ?? '',
    stage: t.stage ?? '',
    repoId: t.repoId,
    tag: t.tag ?? '',
    bug: { ...EMPTY_BUG, ...bug },
  };
}

/** 서버로 보낼 task 값 (POST·PATCH 본문의 이름) */
export interface TaskPayload {
  title: string;
  description: string | null;
  size: TaskSize | null;
  dependsOn: string[];
  type: TaskType;
  assignee: TaskAssignee;
  priority: number | null;
  dueDate: string | null;
  stage: string | null;
  repoId: number | null;
  tag: string | null;
  /** 종류가 버그일 때만 */
  bug?: Partial<BugDraft>;
}

/**
 * 입력값 → 서버로 보낼 값. 빈 칸은 null로 바꾼다.
 * @param d 입력값
 * @param keepEmptyBug 버그 칸의 빈 값도 보낼지 (고치기는 지운 칸을 비우려고 보낸다, 추가는 뺀다)
 */
export function draftPayload(d: TaskDraft, keepEmptyBug = false): TaskPayload {
  const bug = Object.fromEntries(Object.entries(d.bug).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => keepEmptyBug || v)) as Partial<BugDraft>;
  return {
    title: d.title.trim(),
    description: d.md.trim() || null,
    size: d.size,
    dependsOn: d.deps,
    type: d.type,
    assignee: d.assignee,
    priority: d.priority,
    dueDate: d.due || null,
    stage: d.stage || null,
    repoId: d.repoId,
    tag: d.tag.trim() || null,
    ...(d.type === 'bug' ? { bug } : {}),
  };
}

/** 고친 항목 이름. 서버 히스토리 문장(TASK_FIELD_LABEL)과 같은 이름·순서 */
const FIELD_LABEL: Record<keyof TaskPayload, string> = {
  title: '제목',
  description: '설명',
  type: '종류',
  assignee: '담당',
  size: '크기',
  priority: '우선순위',
  dueDate: '기한',
  stage: '단계',
  repoId: '저장소',
  tag: '태그',
  dependsOn: '선행 task',
  bug: '버그 정보',
};

/**
 * 고치기 전후를 비교해 바뀐 항목만 담은 PATCH 본문과 바뀐 항목 이름을 만든다.
 * @param before 창을 열 때 값
 * @param after 지금 입력값
 */
export function draftPatch(before: TaskDraft, after: TaskDraft): { patch: Partial<TaskPayload>; changed: string[] } {
  const a = draftPayload(before, true);
  const b = draftPayload(after, true);
  const patch: Partial<TaskPayload> = {};
  const changed: string[] = [];
  for (const key of Object.keys(FIELD_LABEL) as Array<keyof TaskPayload>) {
    if (b[key] === undefined || JSON.stringify(a[key] ?? null) === JSON.stringify(b[key])) continue;
    (patch as Record<string, unknown>)[key] = b[key];
    changed.push(FIELD_LABEL[key]);
  }
  return { patch, changed };
}

/**
 * task 입력 칸 (앱 고르기는 빼고). 추가·고치기 창이 함께 쓴다.
 * @param appCode 이 task의 앱 (단계·저장소·선행 task 후보가 이 앱 것)
 * @param draft 입력값
 * @param onChange 입력값이 바뀔 때
 * @param selfId 고치는 task의 ID. 자기 자신과 이 task를 기다리는 task는 선행 후보에서 뺀다(순환 방지)
 * @param autoFocus 제목 칸에 커서를 둘지
 */
export function TaskFields({ appCode, draft, onChange, selfId, autoFocus }: { appCode: string; draft: TaskDraft; onChange(next: TaskDraft): void; selfId?: string; autoFocus?: boolean }) {
  const apps = useApps();
  const ctx = useTaskContext();
  const a = apps.data?.find((x) => x.code === appCode);
  const repos = ctx.reposOf(appCode);
  const set = (patch: Partial<TaskDraft>) => onChange({ ...draft, ...patch });
  const setBug = (patch: Partial<BugDraft>) => set({ bug: { ...draft.bug, ...patch } });

  // 이 task가 끝나기를 (거쳐서라도) 기다리는 task: 선행으로 고르면 순환이 된다
  const waiting = new Set<string>();
  if (selfId) {
    const queue = [selfId];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const t of ctx.list) if (t.dependsOn.includes(cur) && !waiting.has(t.id)) (waiting.add(t.id), queue.push(t.id));
    }
  }
  // 선행 task 후보: 이 앱의 task 중 취소되지 않은 것, 최신순
  const depChoices = ctx.list
    .filter((t) => t.appCode === appCode && t.status !== 'cancelled' && t.id !== selfId && !waiting.has(t.id) && !draft.deps.includes(t.id))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));

  return (
    <>
      <div className="field">
        <span className="field-label">담당</span>
        <Segmented<TaskAssignee> label="담당" options={(['claude', 'me'] as const).map((k) => [k, ASSIGNEE[k]])} value={draft.assignee} onChange={(assignee) => set({ assignee })} />
        {draft.assignee === 'me' && <span className="field-hint">내 할 일은 Claude가 실행하지 않고, 리뷰 없이 바로 완료돼요</span>}
      </div>
      <Field label="제목">
        <input className="input" autoFocus={autoFocus} value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="무엇을 할지 한 줄로" />
      </Field>
      <Field
        label={
          <>
            설명 <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>markdown</span>
          </>
        }
      >
        <textarea className="textarea mono" rows={draft.md.split('\n').length > 5 ? 10 : 5} value={draft.md} onChange={(e) => set({ md: e.target.value })} placeholder="- 수용 기준을 목록으로" />
      </Field>
      <div className="field">
        <span className="field-label">종류</span>
        <Segmented<TaskType> label="종류" options={TASK_TYPES.map((k) => [k, TASK_TYPE[k]])} value={draft.type} onChange={(type) => set({ type })} />
      </div>
      {draft.type === 'bug' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 10, background: 'var(--bg)' }}>
          <div className="field">
            <span className="field-label">심각도</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BUG_SEVERITIES.map((s) => (
                <ToggleChip key={s} on={draft.bug.severity === s} onClick={() => setBug({ severity: s })}>
                  <span style={{ color: draft.bug.severity === s ? undefined : TONE[SEVERITY[s][1]].fg }}>{SEVERITY[s][0]}</span>
                </ToggleChip>
              ))}
            </div>
          </div>
          <Field label="재현 단계">
            <textarea className="textarea" rows={3} value={draft.bug.steps} onChange={(e) => setBug({ steps: e.target.value })} placeholder={'1. 로그인\n2. …'} />
          </Field>
          <Grid min={200}>
            <Field label="기대 결과">
              <input className="input" value={draft.bug.expected} onChange={(e) => setBug({ expected: e.target.value })} />
            </Field>
            <Field label="실제 결과">
              <input className="input" value={draft.bug.actual} onChange={(e) => setBug({ actual: e.target.value })} />
            </Field>
          </Grid>
          <Grid min={200}>
            <Field label="환경">
              <input className="input" value={draft.bug.env} onChange={(e) => setBug({ env: e.target.value })} placeholder="운영 · iOS 18" />
            </Field>
            <Field label="버전">
              <input className="input mono" value={draft.bug.version} onChange={(e) => setBug({ version: e.target.value })} placeholder="1.4.2" />
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
                aria-pressed={draft.size === z}
                title={draft.size === z ? '한 번 더 누르면 크기를 비워요' : undefined}
                onClick={() => set({ size: draft.size === z ? null : z })}
                className="mono"
                style={{ minWidth: 44, minHeight: 44, borderRadius: 8, border: `1px solid ${draft.size === z ? 'var(--ink)' : 'var(--line-strong)'}`, background: draft.size === z ? 'var(--ink)' : 'var(--surface)', color: draft.size === z ? 'var(--on-ink)' : 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {z}
              </button>
            ))}
          </div>
        </div>
        <Field label="선행 task" style={{ flex: '1 1 260px', minWidth: 0 }}>
          <Select
            label="선행 task 고르기"
            value={null}
            disabled={!depChoices.length}
            placeholder={depChoices.length ? '먼저 끝나야 하는 task 고르기 · 최신순' : '고를 task가 없어요'}
            menuWidth={420}
            searchAfter={0}
            onChange={(id) => set({ deps: [...draft.deps, id] })}
            options={depChoices.map((t) => ({ value: t.id, prefix: `#${t.id}`, label: t.title, badge: { text: TASK_ST[t.status][0], tone: TASK_ST[t.status][1] } }))}
          />
        </Field>
      </div>
      {draft.deps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: -8 }}>
          {draft.deps.map((d) => {
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
                <button type="button" className="icon-btn" aria-label={`#${d} 빼기`} onClick={() => set({ deps: draft.deps.filter((x) => x !== d) })} style={{ minWidth: 32, minHeight: 32 }}>
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
            value={String(draft.priority ?? '')}
            onChange={(v) => set({ priority: v ? Number(v) : null })}
            options={[{ value: '', label: '정하지 않음' }, ...[1, 2, 3].map((p) => ({ value: String(p), label: PRIORITY[p] }))]}
          />
        </Field>
        <Field label="기한">
          <input className="input" type="date" value={draft.due} onChange={(e) => set({ due: e.target.value })} />
        </Field>
        <Field label="단계">
          <Select label="단계" value={draft.stage} onChange={(stage) => set({ stage })} options={[{ value: '', label: '단계 없음' }, ...(a?.stages ?? []).map((s) => ({ value: s.key, label: s.name }))]} />
        </Field>
        {repos.length > 1 && (
          <Field label="저장소">
            <Select
              label="저장소"
              mono
              value={String(draft.repoId ?? '')}
              onChange={(v) => set({ repoId: v ? Number(v) : null })}
              options={[{ value: '', label: '나중에 고르기' }, ...repos.map((r) => ({ value: String(r.id), label: r.name }))]}
            />
          </Field>
        )}
        <Field label="태그">
          <input className="input" value={draft.tag} onChange={(e) => set({ tag: e.target.value })} placeholder="예: ui, 결제" />
        </Field>
      </Grid>
    </>
  );
}
