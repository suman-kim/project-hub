import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { IdeaBody, IdeaDto, RunDto } from '@hub/shared';
import { api } from '../../api/client';
import { useAction } from '../../api/mutations';
import { useApps, useIdeationSettings } from '../../api/queries';
import { Field, Grid } from '../../components/forms';
import { Dialog, useUi } from '../../components/ui';
import { tildify } from '../../lib/paths';

const MODE: Record<string, [string, string]> = {
  auto: ['오토', '허락 질문 없이 진행'],
  acceptEdits: ['편집만 자동 승인', '명령마다 허락 질문'],
};

/**
 * 새 앱 기획 승인: 1단계에서 앱 코드·이름·폴더를 고치고 생길 것을 미리 본 뒤,
 * 2단계에서 GitHub 저장소를 만든다는 것을 한 번 더 확인한다(Hub에서 지울 수 없다).
 */
export function ApproveConceptDialog({ idea, body, onClose }: { idea: IdeaDto; body: IdeaBody; onClose(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const apps = useApps();
  const ideation = useIdeationSettings();
  const proposed = body.concept!.app;
  const [code, setCode] = useState(proposed.code);
  const [name, setName] = useState(proposed.name);
  const [folder, setFolder] = useState(proposed.folder);
  const [step, setStep] = useState<1 | 2>(1);

  const dup = apps.data?.find((a) => a.code === code);
  const err = {
    code: !/^[A-Z]{2,4}$/.test(code) ? '대문자 2~4자로 써 주세요' : dup ? `이미 있는 앱 코드예요 · ${dup.code} ${dup.name}` : '',
    name: name.trim() ? '' : '이름을 넣으세요',
    folder: !/^[a-z0-9][a-z0-9-]*$/.test(folder) ? '영문 소문자, 숫자, 하이픈만 써요' : '',
  };
  const ok = !err.code && !err.name && !err.folder;
  const base = tildify(ideation.data?.projectRoot) || '~/project';
  const owner = ideation.data?.githubOwner;
  const repo = `${owner ?? '<gh 계정>'}/${folder}`;
  const mode = MODE[ideation.data?.sessionPermissionMode ?? 'auto'];
  const tasks = body.expectedTasks ?? [];

  const confirm = useAction(async () => {
    const r = await api.post<{ run: RunDto | null }>(`/api/ideas/${idea.id}/approve`, { app: { code, name: name.trim(), folder } });
    void qc.invalidateQueries();
    onClose();
    ui.toast(`${code} ${name.trim()}을 시작해요`);
    if (r.run) navigate(`/runs/${r.run.id}`);
  });

  return (
    <Dialog label="새 앱 승인" onClose={onClose} width={580}>
      {step === 1 ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2>승인하고 앱 시작하기</h2>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>새 앱 기획 · {idea.title} · 기획이 제안한 값을 고칠 수 있어요</span>
          </div>
          <Grid min={200}>
            <Field label="앱 코드" error={err.code || null} hint={`task ID 앞부분이 돼요 · ${code || 'XX'}-1`}>
              <input className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} aria-invalid={!!err.code} style={{ letterSpacing: '0.04em' }} />
            </Field>
            <Field label="이름" error={err.name || null}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err.name} />
            </Field>
          </Grid>
          <div className="field">
            <span className="field-label">폴더</span>
            <div style={{ display: 'flex', alignItems: 'center', minHeight: 44, borderRadius: 8, border: `1px solid ${err.folder ? 'var(--risk)' : 'var(--line-strong)'}`, background: 'var(--surface)', overflow: 'hidden' }}>
              <span className="mono" style={{ paddingLeft: 12, fontSize: 13, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                {base}/
              </span>
              <input
                aria-label="폴더 이름"
                className="mono"
                value={folder}
                onChange={(e) => setFolder(e.target.value.toLowerCase())}
                style={{ flex: 1, minWidth: 0, minHeight: 42, padding: '0 12px 0 2px', border: 0, background: 'transparent', color: 'var(--text)', fontSize: 13, outline: 'none' }}
              />
            </div>
            {err.folder && <span className="field-error">{err.folder}</span>}
            <span className="field-hint">로컬 폴더와 GitHub 저장소 이름이 돼요 · 이미 있으면 서버가 거부해요 · 영문 소문자, 숫자, 하이픈</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 10, background: 'var(--bg)' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>승인하면 생기는 것</span>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.55 }}>
              <li>
                <span className="mono">
                  {base}/{folder}
                </span>{' '}
                폴더와 첫 커밋 <span style={{ color: 'var(--text-3)' }}>· README.md, CLAUDE.md, docs/concept.md</span>
              </li>
              <li>
                GitHub 비공개 저장소 <span className="mono">{repo}</span>
              </li>
              <li>
                task {tasks.length}개
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--text-2)' }}>
                  {tasks.map((t, i) => (
                    <span key={i} style={{ display: 'flex', gap: 8 }}>
                      <span className="mono" style={{ flex: 'none', width: 44, color: 'var(--text-3)' }}>
                        {code}-{i + 1}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>{t.title}</span>
                      {!!t.dependsOnIndex?.length && (
                        <span className="mono" style={{ flex: 'none', color: 'var(--text-3)' }}>
                          ← {t.dependsOnIndex.map((d) => d + 1).join(',')}
                        </span>
                      )}
                      <span className="mono" style={{ flex: 'none' }}>
                        {t.size ?? 'M'}
                      </span>
                    </span>
                  ))}
                </div>
              </li>
              <li>
                원격 조종 세션 “{code} {name.trim()}” <span style={{ color: 'var(--text-3)' }}>· 권한 모드 {mode[0]} ({mode[1]})</span>
              </li>
            </ol>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              닫기
            </button>
            <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => setStep(2)}>
              다음
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2>GitHub 저장소를 만들까요?</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)' }}>
              <span className="mono" style={{ color: 'var(--text)' }}>
                {repo}
              </span>{' '}
              비공개 저장소를 만들고 첫 커밋을 push해요. 만든 저장소는 Hub에서 지울 수 없어서, 지우려면 GitHub에서 직접 지워야 해요.
            </p>
          </div>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '8px 16px', padding: '14px 16px', borderRadius: 10, background: 'var(--bg)', fontSize: 13 }}>
            <dt style={{ color: 'var(--text-3)' }}>앱</dt>
            <dd style={{ margin: 0 }}>
              <span className="mono">{code}</span> {name.trim()}
            </dd>
            <dt style={{ color: 'var(--text-3)' }}>폴더</dt>
            <dd className="mono" style={{ margin: 0, overflowWrap: 'anywhere' }}>
              {base}/{folder}
            </dd>
            <dt style={{ color: 'var(--text-3)' }}>세션</dt>
            <dd style={{ margin: 0 }}>
              “{code} {name.trim()}” · {mode[0]}
            </dd>
          </dl>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              뒤로
            </button>
            <button type="button" className="btn btn-primary" disabled={confirm.busy} onClick={() => void confirm.run()}>
              {confirm.busy ? '시작하는 중' : '저장소 만들고 시작'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
