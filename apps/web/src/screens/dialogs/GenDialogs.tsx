import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { RunDto, RunListItemDto } from '@hub/shared';
import { api } from '../../api/client';
import { useAction } from '../../api/mutations';
import { useApps, useIdeationSettings, useRuns } from '../../api/queries';
import { Field, ToggleChip } from '../../components/forms';
import { Dialog, useUi } from '../../components/ui';
import { dur, money } from '../../lib/format';

const ACTIVE = ['queued', 'running'] as const;

function NoteBox({ label, text, onSet }: { label: string; text: string | null; onSet(): void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', padding: '12px 14px', borderRadius: 8, background: 'var(--bg)', fontSize: 13, lineHeight: 1.5 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ flex: '1 1 200px', whiteSpace: 'pre-wrap', color: text ? 'var(--text)' : 'var(--text-3)' }}>{text || '비어 있어요'}</span>
      <button type="button" className="link" onClick={onSet}>
        설정에서 바꾸기
      </button>
    </div>
  );
}

function BusyLink({ run, onOpen }: { run: RunListItemDto; onOpen(): void }) {
  return (
    <button type="button" onClick={onOpen} style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 8, border: 0, background: 'var(--prog-bg)', color: 'var(--prog)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
      이미 생성 중이에요 · run {run.id} →
    </button>
  );
}

/**
 * 기능 기획 즉시 생성. 서버는 생성할 때 앱의 방향성 메모를 쓰고, 이번에만 덧붙이는 메모는 받지 않는다.
 * 같은 앱의 생성이 이미 돌고 있으면 서버가 409를 돌려주므로 미리 막는다.
 */
export function GenDialog({ app: initial, onClose }: { app?: string; onClose(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const apps = useApps();
  const live = (apps.data ?? []).filter((a) => a.lifecycle !== 'archived');
  const [code, setCode] = useState(initial ?? live.find((a) => a.repoPath)?.code ?? live[0]?.code ?? '');
  const running = useRuns({ kind: 'idea_gen', status: ['queued', 'running'] });
  const app = live.find((a) => a.code === code);
  const busy = running.data?.find((r) => ACTIVE.includes(r.status as (typeof ACTIVE)[number]) && r.result.idea?.appId === app?.id && !r.result.idea?.ideaId);
  const ok = !!app?.repoPath && !busy;
  const gen = useAction(async () => {
    if (!app || !ok) return;
    const run = await api.post<RunDto>(`/api/apps/${app.id}/ideas/generate`);
    void qc.invalidateQueries({ queryKey: ['runs'] });
    onClose();
    ui.toast(`${app.name} 기획 생성을 시작했어요 · run ${run.id}`);
  });
  return (
    <Dialog label="기획 지금 생성" onClose={onClose} width={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2>기획 지금 생성</h2>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>앱을 고르면 Claude가 방향성 메모를 보고 기획 하나를 써서 인박스에 올려요</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {live.map((a) => (
          <ToggleChip key={a.code} on={code === a.code} onClick={() => setCode(a.code)}>
            {a.name}
          </ToggleChip>
        ))}
      </div>
      {app && (
        <NoteBox
          label="방향성 메모"
          text={app.directionNote}
          onSet={() => {
            onClose();
            navigate(`/apps/${app.code}/settings`);
          }}
        />
      )}
      {busy && (
        <BusyLink
          run={busy}
          onOpen={() => {
            onClose();
            navigate(`/runs/${busy.id}`);
          }}
        />
      )}
      {app && !app.repoPath && <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--attn-bg)', color: 'var(--attn)', fontSize: 13 }}>저장소 경로가 없어서 생성할 수 없어요 · 앱 설정에서 경로를 넣어 주세요</div>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" disabled={!ok || gen.busy} onClick={() => void gen.run()}>
          생성하기
        </button>
      </div>
    </Dialog>
  );
}

/** 새 앱 기획 생성: 구상 방향 메모와 웹 조사로 새 앱 하나를 기획하고 다른 후보도 남긴다 */
export function ConceptGenDialog({ onClose }: { onClose(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ideation = useIdeationSettings();
  const runs = useRuns({ kind: 'idea_gen', limit: 50 });
  const [note, setNote] = useState('');
  const concept = (runs.data ?? []).filter((r) => r.result.idea?.kind === 'app');
  const busy = concept.find((r) => ACTIVE.includes(r.status as (typeof ACTIVE)[number]) && !r.result.idea?.ideaId);
  const last = concept.find((r) => r.status === 'done' && r.startedAt && r.endedAt);
  const gen = useAction(async () => {
    const run = await api.post<RunDto>('/api/concepts/generate', note.trim() ? { note: note.trim() } : {});
    void qc.invalidateQueries({ queryKey: ['runs'] });
    onClose();
    ui.toast(`새 앱 기획 생성을 시작했어요 · run ${run.id}`);
  });
  return (
    <Dialog label="새 앱 기획 생성" onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2>새 앱 기획 생성</h2>
        <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>구상 방향 메모와 웹 조사로 새 앱 하나를 기획해요. 다른 후보 2~4개도 함께 남겨요.</span>
      </div>
      <NoteBox
        label="구상 방향 메모"
        text={ideation.data?.directionNote ?? null}
        onSet={() => {
          onClose();
          navigate('/new-app');
        }}
      />
      <Field
        label={
          <>
            이번 요청 <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>선택</span>
          </>
        }
      >
        <input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 오프라인 모임 관련으로" />
      </Field>
      {busy && (
        <BusyLink
          run={busy}
          onOpen={() => {
            onClose();
            navigate(`/runs/${busy.id}`);
          }}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '8px 12px' }}>
        <span style={{ flex: '1 1 220px', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
          웹 조사가 항상 들어가서 기능 기획보다 오래 걸리고 비용이 커요
          {last ? ` · 지난번 ${dur((new Date(last.endedAt!).getTime() - new Date(last.startedAt!).getTime()) / 1000)}, ${money(last.costUsd)}` : ''}
        </span>
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" disabled={!!busy || gen.busy} onClick={() => void gen.run()}>
          생성하기
        </button>
      </div>
    </Dialog>
  );
}
