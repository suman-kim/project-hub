import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AppDto, ProjectFileDto, ProjectFileKind, ProjectFilesDto } from '@hub/shared';
import { useProjectFiles } from '../api/queries';
import { ErrorBox, Skeleton } from '../components/ui';
import { ago, fileSize } from '../lib/format';
import { Markdown } from '../lib/md';
import { usePrefs } from '../lib/prefs';

// ---- 문서·디자인: 프로젝트의 docs/와 design/ ----

export type ProjectDir = 'docs' | 'design';

const TEXT: Record<ProjectDir, { hint: string; empty: string }> = {
  docs: {
    hint: '프로젝트의 docs/ 폴더를 그대로 보여 줘요 · Claude가 Hub에 남긴 인수인계·기획 문서는 docs/hub/에도 저장돼요',
    empty: 'docs/ 폴더가 없거나 비어 있어요 · 프로젝트 문서(기획, 설계, API, 운영 메모)를 docs/에 두면 여기에 보여요',
  },
  design: {
    hint: '프로젝트의 design/ 폴더를 그대로 보여 줘요 · HTML 시안은 Hub와 떨어진 창에서 열려 대시보드에 닿지 않아요',
    empty: 'design/ 폴더가 없거나 비어 있어요 · 디자인 시안, 프로토타입, 화면 캡처를 design/에 두면 여기에 보여요',
  },
};
const KIND_LABEL: Record<ProjectFileKind, string> = { md: 'MD', text: 'TXT', html: 'HTML', image: '이미지', pdf: 'PDF' };

const fileKey = (f: ProjectFileDto) => `${f.root}:${f.path}`;
const viewUrl = (data: ProjectFilesDto, f: ProjectFileDto) => data.roots[f.root].viewBase + f.path.split('/').map(encodeURIComponent).join('/');

/** 고른 파일이 없을 때 처음 보여 줄 파일: 문서는 README, 디자인은 첫 HTML, 없으면 첫 파일 */
function firstFile(files: ProjectFileDto[], dir: ProjectDir): ProjectFileDto | null {
  const preferred = dir === 'docs' ? files.find((f) => /^docs\/readme\.md$/i.test(f.path)) : files.find((f) => f.kind === 'html');
  return preferred ?? files[0] ?? null;
}

/** 앱 페이지의 문서 탭(docs/)과 디자인 탭(design/) */
export function DocsTab({ app, dir }: { app: AppDto; dir: ProjectDir }) {
  const { m } = usePrefs();
  const files = useProjectFiles(app.id);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const data = files.data;
  const inDir = (data?.files ?? []).filter((f) => f.path.startsWith(`${dir}/`));
  const sel = params.get('file');
  const picked = inDir.find((f) => fileKey(f) === sel) ?? null;
  // 모바일은 목록부터 보여 준다. 넓은 화면은 처음 파일을 바로 연다.
  const current = picked ?? (m ? null : firstFile(inDir, dir));
  const select = (f: ProjectFileDto | null) => setParams(f ? { file: fileKey(f) } : {}, { replace: !f });

  if (files.isLoading) return <Skeleton rows={6} height={40} />;
  if (files.error || !data) return <ErrorBox error={files.error} onRetry={() => void files.refetch()} />;
  if (!data.roots.length) return <Empty text="앱 폴더가 정해지지 않았거나 없어요 · 설정 탭에서 앱 폴더를 넣으세요" />;

  const needle = q.trim().toLowerCase();
  const shown = inDir.filter((f) => !needle || f.path.toLowerCase().includes(needle));
  const list = <FileList data={data} dir={dir} files={shown} current={current} onPick={select} q={q} setQ={setQ} total={inDir.length} sticky={!m} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{TEXT[dir].hint}</span>
      {!inDir.length ? (
        <Empty text={TEXT[dir].empty} />
      ) : m ? (
        current ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => select(null)}>
              ← 목록
            </button>
            <Viewer data={data} f={current} tall={false} />
          </div>
        ) : (
          list
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          {list}
          {current ? <Viewer data={data} f={current} tall /> : <Empty text="왼쪽에서 파일을 고르세요" />}
        </div>
      )}
    </div>
  );
}

/** sticky: 넓은 화면에서 긴 문서를 내려도 목록이 화면에 남는다 */
function FileList({ data, dir, files, current, onPick, q, setQ, total, sticky }: { data: ProjectFilesDto; dir: ProjectDir; files: ProjectFileDto[]; current: ProjectFileDto | null; onPick(f: ProjectFileDto): void; q: string; setQ(v: string): void; total: number; sticky: boolean }) {
  // 루트(앱 폴더·저장소)마다 묶는다. 루트가 하나면 폴더 이름만 보여 준다.
  const groups = data.roots.map((root) => ({
    key: String(root.index),
    label: data.roots.length > 1 ? `${root.label} · ${dir}/` : `${dir}/`,
    files: files.filter((f) => f.root === root.index),
  }));
  return (
    <section className="card" style={{ minWidth: 0, overflow: 'hidden', ...(sticky ? { position: 'sticky', top: 16 } : {}) }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--line-soft)' }}>
        <input type="search" className="input" style={{ width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`파일 ${total}개에서 찾기`} aria-label="파일 찾기" />
      </div>
      <div style={{ maxHeight: '72vh', overflowY: 'auto' }}>
        {groups.map((g) =>
          g.files.length ? (
            <div key={g.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 6px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                <span className="ellipsis">{g.label}</span>
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
                  {g.files.length}
                </span>
              </div>
              {g.files.map((f) => {
                const parts = f.path.split('/');
                const folder = parts.slice(1, -1).join('/');
                const on = current && fileKey(current) === fileKey(f);
                return (
                  <button
                    key={fileKey(f)}
                    type="button"
                    onClick={() => onPick(f)}
                    aria-current={on ? 'true' : undefined}
                    className="row-btn"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '6px 16px', border: 0, background: on ? 'var(--accent-sel)' : 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="ellipsis" style={{ fontSize: 13, fontWeight: on ? 600 : 500 }}>
                        {parts[parts.length - 1]}
                      </span>
                      {folder && (
                        <span className="ellipsis mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {folder}/
                        </span>
                      )}
                    </span>
                    <span className="mono" style={{ flex: 'none', fontSize: 10, color: 'var(--text-3)' }}>
                      {KIND_LABEL[f.kind]}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
        {!files.length && <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-3)' }}>맞는 파일이 없어요</div>}
        {data.roots.some((r) => r.truncated) && <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--attn)' }}>파일이 많아 일부만 보여요</div>}
      </div>
    </section>
  );
}

function Viewer({ data, f, tall }: { data: ProjectFilesDto; f: ProjectFileDto; tall: boolean }) {
  const url = viewUrl(data, f);
  const root = data.roots[f.root];
  return (
    <section className="card" style={{ minWidth: 0, overflow: 'hidden' }}>
      <div className="card-head" style={{ borderBottom: '1px solid var(--line-soft)' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="ellipsis mono" style={{ fontSize: 13, fontWeight: 600 }}>
            {f.path}
          </span>
          <span className="card-sub">
            {data.roots.length > 1 ? `${root.label} · ` : ''}
            {KIND_LABEL[f.kind]} · {fileSize(f.size)} · {ago(f.modifiedAt)} 수정
          </span>
        </span>
        <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">
          새 탭에서 열기
        </a>
      </div>
      <div style={{ padding: f.kind === 'html' ? 0 : '18px 22px', minWidth: 0 }}>
        {(f.kind === 'md' || f.kind === 'text') && <TextFile url={url} md={f.kind === 'md'} />}
        {f.kind === 'html' && (
          // allow-same-origin 없이 띄워 디자인 파일의 스크립트가 대시보드 쿠키·API에 닿지 않게 한다.
          <iframe key={url} src={url} title={f.path} sandbox="allow-scripts allow-popups allow-forms allow-modals" style={{ display: 'block', width: '100%', height: tall ? '78vh' : '70vh', border: 0, background: '#FFFFFF' }} />
        )}
        {f.kind === 'image' && <img src={url} alt={f.path} style={{ display: 'block', maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line-soft)' }} />}
        {f.kind === 'pdf' && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>PDF는 "새 탭에서 열기"로 봐요</span>}
      </div>
    </section>
  );
}

/** 주소의 글을 받아 md는 렌더링하고, 나머지는 글자 그대로 보여 준다 (내 업무 첨부 보기도 쓴다) */
export function TextFile({ url, md }: { url: string; md: boolean }) {
  const text = useQuery({
    queryKey: ['projectFile', url],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`파일을 읽지 못했어요 (${res.status})`);
      return res.text();
    },
    staleTime: 0,
  });
  if (text.isLoading) return <Skeleton rows={6} height={20} />;
  if (text.error) return <ErrorBox error={text.error} onRetry={() => void text.refetch()} />;
  return md ? (
    <Markdown src={text.data} doc />
  ) : (
    <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {text.data}
    </pre>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '28px 24px', border: '1px dashed var(--line-strong)', borderRadius: 12, background: 'var(--surface)', fontSize: 14, color: 'var(--text-3)' }}>{text}</div>;
}
