import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppDto, ProjectFileDto, ProjectFileKind, ProjectFilesDto } from '@hub/shared';
import { api, qs } from '../api/client';
import { useAction } from '../api/mutations';
import { keys, useProjectFiles } from '../api/queries';
import { uploadable, usePreventFileDrop } from '../components/Attachments';
import { Select } from '../components/Select';
import { ErrorBox, Skeleton, useUi } from '../components/ui';
import { ago, fileSize } from '../lib/format';
import { Markdown } from '../lib/md';
import { usePrefs } from '../lib/prefs';

// ---- 문서·디자인: 프로젝트의 docs/와 design/ ----

export type ProjectDir = 'docs' | 'design';

const TEXT: Record<ProjectDir, { hint: string; empty: string }> = {
  docs: {
    hint: '프로젝트의 docs/ 폴더를 그대로 보여 줘요 · 파일을 올리거나 지울 수 있어요 · Claude가 Hub에 남긴 인수인계·기획 문서는 docs/hub/에도 저장돼요',
    empty: 'docs/ 폴더가 없거나 비어 있어요 · 위에서 파일을 올리거나, 프로젝트 문서(기획, 설계, API, 운영 메모)를 docs/에 두면 여기에 보여요',
  },
  design: {
    hint: '프로젝트의 design/ 폴더를 그대로 보여 줘요 · HTML 시안은 Hub와 떨어진 창에서 열려 대시보드에 닿지 않아요',
    empty: 'design/ 폴더가 없거나 비어 있어요 · 디자인 시안, 프로토타입, 화면 캡처를 design/에 두면 여기에 보여요',
  },
};
const KIND_LABEL: Record<ProjectFileKind, string> = { md: 'MD', text: 'TXT', html: 'HTML', image: '이미지', pdf: 'PDF', other: '파일' };

/** docs/hub/는 Hub가 인수인계·기획 사본을 다시 쓰는 곳이라 올리거나 지우지 않는다 */
const isHubCopy = (path: string) => path === 'docs/hub' || path.startsWith('docs/hub/');
/** 파일이 든 폴더 경로 (docs/설계/a.pdf → docs/설계) */
const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');

/** 올릴 곳 한 개: 루트(앱 폴더·저장소)와 그 안의 docs/ 폴더 */
interface Target {
  /** 선택 목록 값 (루트 번호:폴더) */
  value: string;
  label: string;
  root: number;
  /** docs 또는 docs/하위 */
  dir: string;
}

/**
 * 올릴 곳 목록: 루트마다 docs/와 그 아래 폴더들 (docs/hub/는 뺀다)
 * @param data 문서 탭 목록
 * @param files docs/ 아래 파일
 */
function uploadTargets(data: ProjectFilesDto, files: ProjectFileDto[]): Target[] {
  return data.roots.flatMap((root) => {
    const dirs = new Set(['docs']);
    for (const f of files.filter((x) => x.root === root.index)) {
      const parts = dirOf(f.path).split('/');
      for (let k = 1; k <= parts.length; k++) dirs.add(parts.slice(0, k).join('/'));
    }
    return [...dirs]
      .filter((d) => !isHubCopy(d))
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map((dir) => ({ value: `${root.index}:${dir}`, label: `${data.roots.length > 1 ? `${root.label} · ` : ''}${dir}/`, root: root.index, dir }));
  });
}

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
  const writable = dir === 'docs';

  if (files.isLoading) return <Skeleton rows={6} height={40} />;
  if (files.error || !data) return <ErrorBox error={files.error} onRetry={() => void files.refetch()} />;
  if (!data.roots.length) return <Empty text="앱 폴더가 정해지지 않았거나 없어요 · 설정 탭에서 앱 폴더를 넣으세요" />;

  const needle = q.trim().toLowerCase();
  const shown = inDir.filter((f) => !needle || f.path.toLowerCase().includes(needle));
  const list = <FileList data={data} dir={dir} files={shown} current={current} onPick={select} q={q} setQ={setQ} total={inDir.length} sticky={!m} />;
  const viewer = (f: ProjectFileDto, tall: boolean) => <Viewer data={data} f={f} tall={tall} onDelete={writable && !isHubCopy(f.path) ? () => select(null) : undefined} appId={app.id} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{TEXT[dir].hint}</span>
      {writable && <DocsUpload appId={app.id} data={data} files={inDir} current={current} onUploaded={select} />}
      {!inDir.length ? (
        <Empty text={TEXT[dir].empty} />
      ) : m ? (
        current ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => select(null)}>
              ← 목록
            </button>
            {viewer(current, false)}
          </div>
        ) : (
          list
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          {list}
          {current ? viewer(current, true) : <Empty text="왼쪽에서 파일을 고르세요" />}
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

/**
 * 문서 탭 올리기 칸: 올릴 곳(저장소·docs/ 폴더)을 고르고 끌어 놓거나 파일을 고른다. 여러 개는 차례로.
 * 같은 이름이 있으면 서버가 번호를 붙인다. 올린 마지막 파일을 연다.
 * @param appId 앱 id
 * @param data 문서 탭 목록
 * @param files docs/ 아래 파일 (올릴 폴더 목록을 만든다)
 * @param current 보고 있는 파일 (그 폴더를 기본 올릴 곳으로)
 * @param onUploaded 올린 파일 열기
 */
function DocsUpload({ appId, data, files, current, onUploaded }: { appId: number; data: ProjectFilesDto; files: ProjectFileDto[]; current: ProjectFileDto | null; onUploaded(f: ProjectFileDto): void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  /** 올리는 중이면 몇 개 중 몇 개째인지 */
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  usePreventFileDrop();
  const targets = uploadTargets(data, files);
  const fallback = current && !isHubCopy(current.path) ? `${current.root}:${dirOf(current.path)}` : targets[0]?.value;
  const value = picked && targets.some((t) => t.value === picked) ? picked : fallback;
  const target = targets.find((t) => t.value === value) ?? targets[0];

  const upload = async (list: File[]) => {
    if (busy || !target) return;
    const ok = uploadable(list, ui.toast);
    if (!ok.length) return;
    let last: ProjectFileDto | null = null;
    let sent = 0;
    setBusy({ done: 0, total: ok.length });
    for (const f of ok) {
      try {
        last = await api.upload<ProjectFileDto>(`/api/apps/${appId}/files${qs({ root: target.root, dir: target.dir, name: f.name })}`, f);
        sent++;
      } catch (e) {
        ui.fail(e);
      }
      setBusy((b) => b && { ...b, done: b.done + 1 });
    }
    setBusy(null);
    await qc.invalidateQueries({ queryKey: keys.projectFiles(appId) });
    if (sent) ui.toast(`${target.label}에 ${sent}개를 올렸어요 · 저장소에 새 파일로 생겼으니 커밋해 주세요`);
    if (last) onUploaded(last);
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void upload([...e.dataTransfer.files]);
      }}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minHeight: 56, padding: '10px 12px 10px 16px', borderRadius: 10, border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--line-strong)'}`, background: drag ? 'var(--accent-sel)' : 'var(--surface)', fontSize: 13, color: drag ? 'var(--text)' : 'var(--text-3)', transition: 'background .12s, border-color .12s' }}
    >
      <span style={{ flex: '1 1 200px', minWidth: 0 }}>{busy ? `올리는 중 ${Math.min(busy.done + 1, busy.total)}/${busy.total}…` : drag ? `여기에 놓으면 ${target?.label ?? 'docs/'}에 올려요` : '파일을 여기로 끌어 놓거나 골라서 docs/에 올려요 · 같은 이름이면 번호를 붙여요'}</span>
      {targets.length > 0 && <Select label="올릴 곳" size="sm" mono value={value ?? ''} options={targets.map((t) => ({ value: t.value, label: t.label }))} onChange={setPicked} menuWidth={280} />}
      <button type="button" className="btn btn-sm btn-primary" disabled={!!busy || !target} onClick={() => input.current?.click()}>
        파일 고르기
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          void upload(list);
        }}
      />
    </div>
  );
}

/**
 * @param data 문서 탭 목록 (보기 주소)
 * @param f 볼 파일
 * @param tall 넓은 화면 (HTML 시안을 길게)
 * @param appId 앱 id (지우기)
 * @param onDelete 있으면 지우기 버튼을 보이고, 지운 뒤 부른다 (docs/만, docs/hub/ 빼고)
 */
function Viewer({ data, f, tall, appId, onDelete }: { data: ProjectFilesDto; f: ProjectFileDto; tall: boolean; appId: number; onDelete?: () => void }) {
  const ui = useUi();
  const qc = useQueryClient();
  const url = viewUrl(data, f);
  const root = data.roots[f.root];
  const name = f.path.split('/').pop() ?? f.path;
  const remove = useAction(async () => {
    const ok = await ui.confirm({
      title: '이 파일을 지울까요?',
      body: `${f.path}를 저장소에서 지워요. git에 커밋된 파일은 git으로 되돌릴 수 있지만, 커밋하지 않은 파일은 되돌릴 수 없어요.`,
      label: '지우기',
    });
    if (!ok) return;
    await api.del(`/api/apps/${appId}/files${qs({ root: f.root, path: f.path })}`);
    await qc.invalidateQueries({ queryKey: keys.projectFiles(appId) });
    ui.toast('파일을 지웠어요');
    onDelete?.();
  });
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
        {f.kind === 'other' ? (
          <a className="btn btn-sm" href={url} download={name}>
            내려받기
          </a>
        ) : (
          <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">
            새 탭에서 열기
          </a>
        )}
        {onDelete && (
          <button type="button" className="btn btn-sm btn-danger" disabled={remove.busy} onClick={() => void remove.run()}>
            지우기
          </button>
        )}
      </div>
      <div style={{ padding: f.kind === 'html' ? 0 : '18px 22px', minWidth: 0 }}>
        {(f.kind === 'md' || f.kind === 'text') && <TextFile url={url} md={f.kind === 'md'} />}
        {f.kind === 'html' && (
          // allow-same-origin 없이 띄워 디자인 파일의 스크립트가 대시보드 쿠키·API에 닿지 않게 한다.
          <iframe key={url} src={url} title={f.path} sandbox="allow-scripts allow-popups allow-forms allow-modals" style={{ display: 'block', width: '100%', height: tall ? '78vh' : '70vh', border: 0, background: '#FFFFFF' }} />
        )}
        {f.kind === 'image' && <img src={url} alt={f.path} style={{ display: 'block', maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line-soft)' }} />}
        {f.kind === 'pdf' && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>PDF는 "새 탭에서 열기"로 봐요</span>}
        {f.kind === 'other' && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>이 파일은 화면에서 볼 수 없어요 · "내려받기"로 열어요</span>}
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
