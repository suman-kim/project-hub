import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClaudeMdDto, ClaudeMdFileDto } from '@hub/shared';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { ErrorBox, Skeleton, useUi } from '../components/ui';
import { ago } from '../lib/format';
import { tildify } from '../lib/paths';

/** 규칙 화면의 CLAUDE.md 칸: 왼쪽에서 파일을 고르고 오른쪽에서 그대로 고친다. 파일이 원본이다 */
export function ClaudeMdView({ switcher }: { switcher: ReactNode }) {
  const files = useQuery({ queryKey: ['claudeMd'], queryFn: () => api.get<ClaudeMdFileDto[]>('/api/rules/claude-md') });
  const [key, setKey] = useState('global');
  const current = files.data?.find((f) => f.key === key);

  return (
    <div data-screen-label="규칙" className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <span className="page-sub">Claude Code가 그 폴더에서 세션을 시작할 때 읽어요 · 전역은 모든 세션이 읽어요</span>
          <h1 className="page-title">규칙</h1>
        </div>
      </div>
      {switcher}
      {files.isLoading && <Skeleton rows={6} height={44} />}
      {files.error && <ErrorBox error={files.error} onRetry={() => void files.refetch()} />}
      {files.data && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <nav aria-label="CLAUDE.md 파일" className="card" style={{ flex: '1 1 240px', maxWidth: 320, overflow: 'hidden' }}>
            {files.data.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-current={f.key === key}
                onClick={() => setKey(f.key)}
                className="row-btn"
                style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 16px', border: 0, borderTop: '1px solid var(--line-soft)', marginTop: -1, background: f.key === key ? 'var(--accent-sel)' : 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
              >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                  <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
                    {f.label}
                  </span>
                  <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 12, color: f.exists ? 'var(--text-3)' : 'var(--text-3)' }}>{f.exists ? `${Math.max(1, Math.round(f.size / 1024))}KB` : '없음'}</span>
                </span>
                <span className="mono ellipsis" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {tildify(f.path)}
                </span>
              </button>
            ))}
          </nav>
          {current && <Editor key={current.key} file={current} onSaved={() => void files.refetch()} />}
        </div>
      )}
    </div>
  );
}

function Editor({ file, onSaved }: { file: ClaudeMdFileDto; onSaved(): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const doc = useQuery({ queryKey: ['claudeMd', file.key], queryFn: () => api.get<ClaudeMdDto>(`/api/rules/claude-md/${encodeURIComponent(file.key)}`) });
  const [text, setText] = useState('');
  useEffect(() => setText(doc.data?.text ?? ''), [doc.data]);
  const dirty = !!doc.data && text !== doc.data.text;

  const save = useAction(async () => {
    if (!doc.data) return;
    const create = !doc.data.exists;
    const body = create
      ? `${tildify(file.path)}을 새로 만들어요. 이 폴더에서 새로 여는 세션부터 읽어요.`
      : `${tildify(file.path)}을 지금 내용으로 덮어써요. 이 폴더에서 새로 여는 세션부터 읽어요.${file.key === 'global' ? '' : ' 저장소 안의 파일이라 커밋하지 않은 변경으로 남아요.'}`;
    if (!(await ui.confirm({ title: create ? 'CLAUDE.md를 만들까요?' : 'CLAUDE.md를 저장할까요?', body, label: create ? '만들기' : '파일에 저장', danger: false }))) return;
    try {
      const saved = await api.put<ClaudeMdDto>(`/api/rules/claude-md/${encodeURIComponent(file.key)}`, { text, version: doc.data.version });
      qc.setQueryData(['claudeMd', file.key], saved);
      ui.toast(`${tildify(file.path)}에 저장했어요`);
      onSaved();
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        ui.toast('열어 둔 사이에 파일이 바뀌었어요 · 다시 불러온 뒤 고쳐 주세요', { error: true });
        return;
      }
      throw e;
    }
  });

  return (
    <section className="card" style={{ flex: '3 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', padding: '14px 20px', borderBottom: '1px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{file.label}</h2>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
            {tildify(file.path)}
            {doc.data?.updatedAt ? ` · ${ago(doc.data.updatedAt)} 수정` : doc.data && !doc.data.exists ? ' · 아직 없어요' : ''}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sm" disabled={doc.isFetching} onClick={() => void doc.refetch()} title="터미널에서 고친 내용을 다시 읽어요">
            다시 불러오기
          </button>
          {dirty && (
            <button type="button" className="btn btn-sm" onClick={() => setText(doc.data!.text)}>
              되돌리기
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || save.busy} onClick={() => void save.run()}>
            {doc.data && !doc.data.exists ? '만들기' : '파일에 저장'}
          </button>
        </div>
      </div>
      {doc.isLoading && <Skeleton rows={8} height={28} />}
      {doc.error && <ErrorBox error={doc.error} onRetry={() => void doc.refetch()} />}
      {doc.data && (
        <textarea
          className="mono"
          aria-label={`${file.label} CLAUDE.md`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (dirty) void save.run();
            }
          }}
          placeholder={doc.data.exists ? '' : '아직 파일이 없어요 · 여기에 쓰고 "만들기"를 누르면 생겨요'}
          spellCheck={false}
          style={{ minHeight: 520, resize: 'vertical', padding: '14px 20px', border: 0, outline: 'none', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, lineHeight: 1.7, borderRadius: '0 0 12px 12px' }}
        />
      )}
    </section>
  );
}
