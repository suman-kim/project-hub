import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { IdeationSettingsDto, RunDto, SessionPermissionMode } from '@hub/shared';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { keys, useApps, useIdeas, useIdeationSettings, useRuns } from '../api/queries';
import { Field, SaveBar, ScheduleEditor, Section, Segmented } from '../components/forms';
import { ErrorBox, Skeleton, useUi } from '../components/ui';
import { parseCron, schedError, toCron, type Sched } from '../lib/cron';
import { dur, money } from '../lib/format';
import { tildify, untildify } from '../lib/paths';
import { usePrefs } from '../lib/prefs';

interface IdeationDraft {
  memo: string;
  sched: Sched;
  base: string;
  owner: string;
  permMode: SessionPermissionMode;
}

const draftOf = (s: IdeationSettingsDto): IdeationDraft => ({
  memo: s.directionNote ?? '',
  sched: parseCron(s.cron),
  base: tildify(s.projectRoot),
  owner: s.githubOwner ?? '',
  permMode: s.sessionPermissionMode,
});

/**
 * 프로젝트 기획 생성: 새 앱 기획 생성 run을 바로 돌린다. 만들어 둔 프로젝트 등록은 사이드바 "앱" 옆 + 버튼의 창에서 한다.
 * 앱 목록은 사이드바에 있으므로 여기서는 보여 주지 않는다. 아래에 새 앱 기획 설정을 둔다.
 */
export function NewApp() {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { m } = usePrefs();
  const apps = useApps();
  const ideation = useIdeationSettings();
  const runs = useRuns({ kind: 'idea_gen', limit: 50 });
  const pending = useIdeas({ kind: 'app', status: ['pending'] });
  const [note, setNote] = useState('');
  const concept = (runs.data ?? []).filter((r) => r.result.idea?.kind === 'app');
  const busy = concept.find((r) => ['queued', 'running', 'input'].includes(r.status) && !r.result.idea?.ideaId);
  const last = concept.find((r) => r.status === 'done' && r.startedAt && r.endedAt);
  const gen = useAction(async () => {
    const run = await api.post<RunDto>('/api/concepts/generate', note.trim() ? { note: note.trim() } : {});
    void qc.invalidateQueries({ queryKey: ['runs'] });
    ui.toast(`새 앱 기획 생성을 시작했어요 · run ${run.id}`);
    navigate(`/runs/${run.id}`);
  });
  const pad = m ? 16 : '20px 22px';

  return (
    <div data-screen-label="프로젝트 기획 생성" className="page">
      <div className="page-head">
        <div>
          <span className="page-sub">새 프로젝트를 기획부터 시작해요 · 만들어 둔 프로젝트는 사이드바 "앱" 옆 + 버튼으로 등록해요</span>
          <h1 className="page-title">프로젝트 기획 생성</h1>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch', maxWidth: 880 }}>
        <section className="card" style={{ flex: '3 1 420px', padding: pad, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>기획부터 시작</h2>
            <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>Claude가 구상 방향 메모와 웹 조사로 새 앱 하나를 기획해요. 기획 인박스에서 읽고 승인하면 폴더, GitHub 저장소, task, 시작 세션이 만들어져요.</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', padding: '12px 14px', borderRadius: 8, background: 'var(--bg)', fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--text-3)' }}>구상 방향 메모</span>
            <span style={{ flex: '1 1 200px', whiteSpace: 'pre-wrap', color: ideation.data?.directionNote ? 'var(--text)' : 'var(--text-3)' }}>{ideation.data?.directionNote || '비어 있어요 · 아래 설정에서 넣을 수 있어요'}</span>
          </div>
          <Field
            label={
              <>
                이번 요청 <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>선택</span>
              </>
            }
          >
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) void gen.run();
              }}
              placeholder="예: 오프라인 모임 관련으로"
            />
          </Field>
          {busy && (
            <button type="button" onClick={() => navigate(`/runs/${busy.id}`)} style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 8, border: 0, background: 'var(--prog-bg)', color: 'var(--prog)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              이미 생성 중이에요 · run {busy.id} →
            </button>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginTop: 'auto' }}>
            <button type="button" className="btn btn-primary" disabled={!!busy || gen.busy} onClick={() => void gen.run()}>
              {gen.busy ? '시작하는 중' : '지금 생성'}
            </button>
            {(pending.data?.length ?? 0) > 0 && (
              <button type="button" className="link" onClick={() => navigate('/ideas?type=app')}>
                검토 대기 새 앱 기획 {pending.data!.length}개 →
              </button>
            )}
            <span style={{ flex: '1 1 200px', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
              웹 조사가 들어가서 오래 걸리고 비용이 커요
              {last ? ` · 지난번 ${dur((new Date(last.endedAt!).getTime() - new Date(last.startedAt!).getTime()) / 1000)}, ${money(last.costUsd)}` : ''}
            </span>
          </div>
        </section>
      </div>
      {ideation.data ? <IdeationSettings saved={ideation.data} home={apps.data?.find((a) => a.repoPath)?.repoPath ?? null} /> : ideation.error ? <ErrorBox error={ideation.error} /> : <Skeleton rows={4} height={64} />}
    </div>
  );
}

function IdeationSettings({ saved, home }: { saved: IdeationSettingsDto; home: string | null }) {
  const ui = useUi();
  const qc = useQueryClient();
  const base = useMemo(() => draftOf(saved), [saved]);
  const [d, setD] = useState(base);
  useEffect(() => setD(base), [base]);
  const set = (p: Partial<IdeationDraft>) => setD((x) => ({ ...x, ...p }));

  const projectRoot = untildify(d.base.trim(), home ?? saved.projectRoot);
  const err: Record<string, string> = {};
  if (!projectRoot.startsWith('/')) err.base = '경로는 / 또는 ~/로 시작해요';
  if (d.owner.trim() && !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(d.owner.trim())) err.owner = '영문, 숫자, 하이픈만 써요';
  const se = schedError(d.sched);
  if (se) err.sched = se;

  const patch: Partial<IdeationSettingsDto> = {};
  if ((d.memo.trim() || null) !== saved.directionNote) patch.directionNote = d.memo.trim() || null;
  if (toCron(d.sched) !== saved.cron) patch.cron = toCron(d.sched);
  if (projectRoot !== saved.projectRoot) patch.projectRoot = projectRoot;
  if ((d.owner.trim() || null) !== saved.githubOwner) patch.githubOwner = d.owner.trim() || null;
  if (d.permMode !== saved.sessionPermissionMode) patch.sessionPermissionMode = d.permMode;

  const save = useAction(async () => {
    const next = await api.patch<IdeationSettingsDto>('/api/settings/ideation', patch);
    qc.setQueryData(keys.ideation, next);
    ui.toast('새 앱 기획 설정을 저장했어요');
  });

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>새 앱 기획 설정</h2>
        <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>아직 저장소가 없는 새 앱을 구상하는 기획의 설정이에요. 승인하면 아래 위치에 폴더와 저장소를 만들어요.</span>
      </div>
      <Section title="구상" dirty={'directionNote' in patch}>
        <Field label="구상 방향 메모" hint="새 앱 기획을 만들 때 프롬프트 맨 앞에 들어가요 · 예: 1인 개발, 3개월 MVP, Flutter + NestJS">
          <textarea className="textarea" rows={3} value={d.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="관심 분야와 조건" />
        </Field>
      </Section>
      <Section title="자동 생성 주기" dirty={'cron' in patch}>
        <ScheduleEditor value={d.sched} onChange={(sched) => set({ sched })} />
        <span className="field-hint">5시간·7일 사용량 중 하나라도 80%를 넘으면 그 회차는 건너뛰어요 · 새 앱 기획은 웹 조사가 들어가 기능 기획보다 오래 걸리고 비용이 커요</span>
      </Section>
      <Section title="만들 곳" dirty={'projectRoot' in patch || 'githubOwner' in patch}>
        <Field label="새 앱 폴더 위치" error={err.base} hint="승인하면 이 아래에 폴더를 만들어요 · 예: ~/project/fine-jar">
          <input className="input mono" value={d.base} onChange={(e) => set({ base: e.target.value })} aria-invalid={!!err.base} />
        </Field>
        <Field label="GitHub 소유자" error={err.owner} hint={d.owner.trim() ? `github.com/${d.owner.trim()} 조직에 비공개로 만들어요` : 'gh에 로그인한 계정에 비공개로 만들어요'}>
          <input className="input mono" value={d.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="비우면 gh에 로그인한 계정" aria-invalid={!!err.owner} />
        </Field>
      </Section>
      <Section title="시작 세션 권한 모드" dirty={'sessionPermissionMode' in patch}>
        <Segmented
          label="권한 모드"
          options={[
            ['auto', '오토'],
            ['acceptEdits', '편집만 자동 승인'],
          ]}
          value={d.permMode}
          onChange={(permMode) => set({ permMode })}
        />
        <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          {d.permMode === 'auto' ? '허락 질문 없이 진행해요. 승인한 기획대로 바로 만들기 시작해요.' : '파일 편집은 자동으로 허락하고, 명령은 실행할 때마다 물어요. 세션이 "허락 대기"로 자주 멈춰요.'}
        </span>
      </Section>
      <SaveBar count={Object.keys(patch).length} error={Object.keys(err).length ? '빨간 칸을 먼저 고쳐 주세요' : null} busy={save.busy} onRevert={() => setD(base)} onSave={() => void save.run()} />
    </>
  );
}
