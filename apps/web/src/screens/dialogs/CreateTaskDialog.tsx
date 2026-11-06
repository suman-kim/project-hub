import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TaskAssignee, TaskDto, TaskType } from '@hub/shared';
import { api } from '../../api/client';
import { useAction } from '../../api/mutations';
import { keys, useApps } from '../../api/queries';
import { useTaskContext } from '../../api/taskContext';
import { ToggleChip } from '../../components/forms';
import { Dialog, useUi } from '../../components/ui';
import { useTaskPanel } from '../../lib/nav';
import { draftPayload, newDraft, TaskFields, type TaskDraft } from './TaskForm';

export interface CreateTaskPreset {
  /** 미리 고른 앱 코드 */
  app?: string;
  /** 미리 고른 종류 */
  type?: TaskType;
  /** 미리 고른 담당 */
  assignee?: TaskAssignee;
}

/** task 추가. 입력 칸은 수정 창과 같은 TaskFields를 쓰고, 종류가 버그면 버그 칸이 펼쳐진다 */
export function CreateTaskDialog({ preset, onClose }: { preset: CreateTaskPreset; onClose(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const panel = useTaskPanel();
  const apps = useApps();
  const ctx = useTaskContext();
  const live = (apps.data ?? []).filter((a) => a.lifecycle !== 'archived');
  const [app, setApp] = useState(preset.app ?? live[0]?.code ?? '');
  const [draft, setDraft] = useState<TaskDraft>(() => newDraft(preset));

  const a = apps.data?.find((x) => x.code === app);
  const ok = !!a && !!draft.title.trim() && draft.deps.every((d) => ctx.byId.has(d));

  const create = useAction(async () => {
    if (!ok) return;
    const t = await api.post<TaskDto>('/api/tasks', { app, ...draftPayload(draft) });
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
        <span className="field-label">앱</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {live.map((x) => (
            <ToggleChip key={x.code} on={app === x.code} onClick={() => (setApp(x.code), setDraft({ ...draft, repoId: null, stage: '', deps: [] }))}>
              {x.name}
            </ToggleChip>
          ))}
        </div>
      </div>
      <TaskFields appCode={app} draft={draft} onChange={setDraft} autoFocus />
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
