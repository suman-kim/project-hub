import { useState } from 'react';
import type { TaskDto } from '@hub/shared';
import { useAction, useUpdateTask } from '../../api/mutations';
import { useApps } from '../../api/queries';
import { useTaskContext } from '../../api/taskContext';
import { Dialog, useUi } from '../../components/ui';
import { TASK_ST } from '../../lib/labels';
import { draftOf, draftPatch, TaskFields, type TaskDraft } from './TaskForm';

/**
 * task 고치기. 추가 창과 같은 입력 칸에 지금 값을 채워 열고, 바뀐 항목만 보낸다.
 * 앱은 바꾸지 않는다(task ID가 앱 코드로 시작한다). 상태는 패널의 "상태 바꾸기"로 바꾼다.
 * @param task 고칠 task
 * @param onClose 창을 닫을 때
 */
export function EditTaskDialog({ task, onClose }: { task: TaskDto; onClose(): void }) {
  const ui = useUi();
  const apps = useApps();
  const ctx = useTaskContext();
  const update = useUpdateTask();
  /** 창을 연 때의 값. 이것과 비교해 바뀐 항목만 보낸다 */
  const [initial] = useState<TaskDraft>(() => draftOf(task));
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const { patch, changed } = draftPatch(initial, draft);
  const app = apps.data?.find((a) => a.code === task.appCode);
  const running = ctx.activeRun(task.id);
  const ended = task.status === 'done' || task.status === 'cancelled';
  const missing = draft.deps.filter((d) => !ctx.byId.has(d));
  const ok = !!draft.title.trim() && changed.length > 0 && !missing.length;

  const save = useAction(async () => {
    if (!ok) return;
    await update(task.id, patch);
    onClose();
    ui.toast(`#${task.id}을 고쳤어요 · ${changed.join(', ')}`);
  });

  /** 고친 내용이 있으면 버릴지 묻고 닫는다 (Esc, 바깥 누르기, 닫기 버튼) */
  const close = async () => {
    if (changed.length && !(await ui.confirm({ title: '고친 내용을 버릴까요?', body: `${changed.join(', ')}을 바꾼 것이 저장되지 않아요.`, label: '버리기' }))) return;
    onClose();
  };

  return (
    <Dialog label="task 고치기" onClose={() => void close()} width={560}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2>task 고치기</h2>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
          #{task.id}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
          {app?.name ?? task.appCode} · {TASK_ST[task.status][0]}
        </span>
      </div>
      {(ended || running) && (
        <span role="note" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--attn-bg)', color: 'var(--attn)', fontSize: 13, lineHeight: 1.5 }}>
          {running
            ? '지금 실행 중이에요 · 실행 중인 세션은 시작할 때 받은 내용으로 계속해요. 바뀐 내용을 알리려면 진행 메모를 남기세요'
            : '끝난 task예요 · 고쳐도 상태는 그대로이고, 고친 내용은 히스토리에 남아요'}
        </span>
      )}
      <TaskFields appCode={task.appCode} draft={draft} onChange={setDraft} selfId={task.id} autoFocus />
      <div className="dialog-actions" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14, alignItems: 'center' }}>
        <span style={{ marginRight: 'auto', fontSize: 12, color: missing.length ? 'var(--risk)' : 'var(--text-3)' }}>
          {missing.length ? `없는 task를 선행으로 두었어요: ${missing.join(', ')}` : !draft.title.trim() ? '제목을 적어 주세요' : changed.length ? `바꾼 항목: ${changed.join(', ')}` : '바꾼 항목이 없어요'}
        </span>
        <button type="button" className="btn" onClick={() => void close()}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" disabled={!ok || save.busy} onClick={() => void save.run()}>
          저장하기
        </button>
      </div>
    </Dialog>
  );
}
