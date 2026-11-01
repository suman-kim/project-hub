import { Select } from '../../components/Select';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppDto, ProjectCandidateDto } from '@hub/shared';
import { api } from '../../api/client';
import { useAction } from '../../api/mutations';
import { keys, useApps } from '../../api/queries';
import { Field, Grid } from '../../components/forms';
import { Dialog, useUi } from '../../components/ui';
import { tildify, untildify } from '../../lib/paths';

/** 직접 만든 프로젝트를 Hub에 넣는다. 저장소는 이미 있어야 한다 */
export function AppRegisterDialog({ onClose }: { onClose(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const apps = useApps();
  const [f, setF] = useState({ code: '', name: '', repo: '', folders: '', branch: 'main' });
  const [tried, setTried] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const candidates = useQuery({ queryKey: ['projectCandidates'], queryFn: () => api.get<ProjectCandidateDto[]>('/api/project-candidates'), staleTime: 0 });
  const picked = candidates.data?.find((c) => c.path === untildify(f.repo.trim(), c.path).replace(/\/+$/, ''));
  /** 폴더를 고르면 경로·이름·기본 브랜치를 채운다. 폴더 이름은 비워 두면 경로 끝을 쓴다 */
  const pick = (path: string) => {
    const c = candidates.data?.find((x) => x.path === path);
    if (!c) return set({ repo: '' });
    set({ repo: tildify(c.path), name: f.name.trim() ? f.name : c.name, branch: c.repos[0]?.branch ?? f.branch });
  };

  const home = apps.data?.find((a) => a.repoPath)?.repoPath ?? null;
  const repoAbs = untildify(f.repo.trim(), home).replace(/\/+$/, '');
  const repoLast = repoAbs.split('/').pop() ?? '';
  const folders = f.folders.trim() ? f.folders.split(/[\s,]+/).filter(Boolean) : repoLast ? [repoLast] : [];
  const dup = apps.data?.find((a) => a.code === f.code);
  const e = {
    code: !/^[A-Z]{2,4}$/.test(f.code) ? '대문자 2~4자로 써 주세요' : dup ? `이미 있는 앱 코드예요 · ${dup.code} ${dup.name}` : '',
    name: f.name.trim() ? '' : '이름을 넣으세요',
    repo: !f.repo.trim()
      ? '저장소 경로를 넣으세요'
      : !repoAbs.startsWith('/')
        ? '경로는 / 또는 ~/로 시작해요'
        : apps.data?.some((a) => a.repoPath === repoAbs)
          ? '이미 등록된 저장소예요'
          : '',
    branch: f.branch.trim() ? '' : '기본 브랜치를 넣으세요',
  };
  const ok = !e.code && !e.name && !e.repo && !e.branch;
  const show = (k: keyof typeof e) => ((tried || !!f[k === 'repo' ? 'repo' : k]) && e[k]) || null;

  const create = useAction(async () => {
    if (!ok) return setTried(true);
    const app = await api.post<AppDto>('/api/apps', { code: f.code, name: f.name.trim(), repoPath: repoAbs, folderNames: folders, defaultBranch: f.branch.trim() });
    void qc.invalidateQueries({ queryKey: keys.apps });
    void qc.invalidateQueries({ queryKey: keys.appStatus });
    onClose();
    navigate(`/apps/${app.code}/settings`);
    ui.toast(`${app.code} ${app.name}을 등록했어요 · task는 Task Master에서 가져오거나 직접 만들어요`);
  });

  return (
    <Dialog label="앱 등록" onClose={onClose} width={540}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2>앱 등록</h2>
        <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>직접 만든 프로젝트를 Hub에 넣어요. 저장소는 이미 있어야 해요.</span>
      </div>
      <Grid min={200}>
        <Field label="앱 코드" error={show('code')} hint={`task ID 앞부분이 돼요 · ${f.code || 'XX'}-1`}>
          <input
            className="input mono"
            autoFocus
            value={f.code}
            onChange={(ev) => set({ code: ev.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) })}
            placeholder="AB"
            aria-invalid={!!show('code')}
            style={{ letterSpacing: '0.04em' }}
          />
        </Field>
        <Field label="이름" error={show('name')}>
          <input className="input" value={f.name} onChange={(ev) => set({ name: ev.target.value })} aria-invalid={!!show('name')} />
        </Field>
      </Grid>
      <Field label="프로젝트 폴더" hint={candidates.data?.length === 0 ? '~/project 아래에서 git 저장소가 있는 폴더를 찾지 못했어요 · 아래에 경로를 직접 넣으세요' : '~/project 아래의 git 프로젝트예요 · 고르면 경로와 기본 브랜치를 채워요'}>
        <Select
          label="프로젝트 폴더"
          value={picked?.path ?? ''}
          onChange={pick}
          placeholder={candidates.isLoading ? '폴더를 찾는 중' : '고르거나 아래에 직접 입력'}
          menuWidth={360}
          options={(candidates.data ?? []).map((c) => ({
            value: c.path,
            label: c.name,
            hint: c.repos.length > 1 ? `저장소 ${c.repos.length}개` : undefined,
            badge: c.appCode ? { text: `${c.appCode} 등록됨`, tone: 'muted' as const } : undefined,
            disabled: !!c.appCode,
          }))}
        />
      </Field>
      {picked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: -8, padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', fontSize: 12 }}>
          {picked.repos.map((r) => (
            <span key={r.path} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
              <span className="mono" style={{ fontWeight: 600 }}>
                {r.name}
              </span>
              <span style={{ color: r.github ? 'var(--text-2)' : 'var(--attn)' }}>{r.github ? `github.com/${r.github}` : 'GitHub 원격 없음 · 배포 기록과 PR을 쓰려면 origin을 GitHub로 두세요'}</span>
              {r.branch && <span style={{ color: 'var(--text-3)' }}>기본 브랜치 {r.branch}</span>}
            </span>
          ))}
          <span style={{ color: 'var(--text-3)' }}>GitHub 저장소는 폴더의 git 원격(origin)에서 읽어요 · 등록하면 저장소 목록에 저절로 들어가요</span>
        </div>
      )}
      <Field label="저장소 경로" error={show('repo')}>
        <input className="input mono" value={f.repo} onChange={(ev) => set({ repo: ev.target.value })} placeholder="~/project/my-app" aria-invalid={!!show('repo')} />
      </Field>
      <Field
        label={
          <>
            폴더 이름 <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>세션 판별용 · 쉼표로 여러 개</span>
          </>
        }
        hint={f.folders.trim() ? '세션을 시작한 폴더 이름이 이 중 하나면 이 앱으로 봐요' : repoLast ? `비워 두면 ${repoLast}를 써요` : '세션을 시작한 폴더 이름으로 어느 앱인지 알아봐요'}
      >
        <input className="input mono" value={f.folders} onChange={(ev) => set({ folders: ev.target.value })} placeholder="my-app, my-app-web" />
      </Field>
      {folders.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -8 }}>
          {folders.map((x) => (
            <span key={x} className="mono" style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'var(--chip)', color: 'var(--text-2)' }}>
              {x}
            </span>
          ))}
        </div>
      )}
      <Field label="기본 브랜치" error={show('branch')}>
        <input className="input mono" value={f.branch} onChange={(ev) => set({ branch: ev.target.value })} aria-invalid={!!show('branch')} />
      </Field>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" style={{ opacity: ok ? 1 : 0.6 }} disabled={create.busy} onClick={() => void create.run()}>
          등록
        </button>
      </div>
    </Dialog>
  );
}
