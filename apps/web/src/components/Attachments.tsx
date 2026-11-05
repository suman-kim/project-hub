import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MyDocFileDto } from '@hub/shared';
import { useAction } from '../api/mutations';
import { fileSize, stamp } from '../lib/format';
import { FILE_KIND, MAX_FILE_MB } from '../lib/mine';
import { usePrefs } from '../lib/prefs';
import { TextFile } from '../screens/AppDocs';
import { IconClose } from './icons';
import { useUi } from './ui';

// ---- 첨부 파일: 보관함 문서 서랍과 노트 편집기가 같이 쓰는 목록·올리기·보기 ----

const MB = 1024 * 1024;

/**
 * 올릴 수 있는 파일만 고른다. 너무 큰 파일과 빈 파일(폴더)은 빼고 알린다.
 * @param picked 고르거나 끌어 놓은 파일
 * @param toast 알림 (useUi().toast)
 */
export function uploadable(picked: File[], toast: (msg: string, opts?: { error?: boolean }) => void): File[] {
  const ok = picked.filter((f) => f.size > 0 && f.size <= MAX_FILE_MB * MB);
  const big = picked.filter((f) => f.size > MAX_FILE_MB * MB);
  if (big.length) toast(`${MAX_FILE_MB}MB를 넘어 올리지 않았어요: ${big.map((f) => f.name).join(', ')}`, { error: true });
  else if (ok.length < picked.length) toast('빈 파일과 폴더는 건너뛰었어요', { error: true });
  return ok;
}

/** 첨부 파일 한 개: 보관함 문서 첨부(MyDocFileDto)와 노트 첨부(NoteFileDto)가 같은 모양이다 */
export type AttachmentFile = Pick<MyDocFileDto, 'id' | 'name' | 'kind' | 'size' | 'url' | 'createdAt'>;

interface ListProps<F extends AttachmentFile> {
  /** 붙어 있는 파일, 올린 순 */
  files: F[];
  /** 파일 하나 올리기 (여러 개는 차례로 부른다) */
  onUpload(file: File): Promise<unknown>;
  /** 파일 하나 지우기 (확인은 이 부품이 받는다) */
  onDelete(file: F): Promise<unknown>;
  /** 끌어 놓기 칸 아래 도움말 */
  help: string;
  /** 파일 이름 옆에 붙일 표시 (예: 노트 본문에 들어간 그림) */
  badge?: (f: F) => ReactNode;
}

/**
 * 첨부 파일 목록과 올리기 칸: 끌어 놓거나 골라서 올리고(여러 개는 차례로), PDF·md·텍스트·그림은 눌러서 바로 본다.
 * 그 밖의 파일은 이름을 누르면 내려받는다. 보관함 문서 서랍과 노트 편집기가 같이 쓴다.
 */
export function AttachmentList<F extends AttachmentFile>({ files, onUpload, onDelete, help, badge }: ListProps<F>) {
  const ui = useUi();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  /** 올리는 중이면 몇 개 중 몇 개째인지 */
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  // 서랍이 열린 동안 끌어 놓기 칸 밖에 떨어뜨린 파일을 브라우저가 열어 Hub 화면을 떠나지 않게 한다.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const upload = async (picked: File[]) => {
    if (!picked.length || busy) return;
    const ok = uploadable(picked, ui.toast);
    if (!ok.length) return;
    let sent = 0;
    setBusy({ done: 0, total: ok.length });
    for (const f of ok) {
      try {
        await onUpload(f);
        sent++;
      } catch (e) {
        ui.fail(e);
      }
      setBusy((b) => b && { ...b, done: b.done + 1 });
    }
    setBusy(null);
    if (sent) ui.toast(`파일 ${sent}개를 붙였어요`);
  };
  const remove = useAction(async (f: F) => {
    if (!(await ui.confirm({ title: '이 파일을 지울까요?', body: f.name, label: '지우기' }))) return;
    await onDelete(f);
    ui.toast('파일을 지웠어요');
  });

  return (
    <>
      {files.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '4px 4px 4px 10px', borderRadius: 8, border: '1px solid var(--line-soft)' }}>
          <FileKindTag f={f} />
          {f.kind === 'other' ? (
            <a href={`${f.url}?download=1`} className="ellipsis" title={`${f.name} 내려받기`} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              {f.name}
            </a>
          ) : (
            <button type="button" className="ellipsis" title={`${f.name} 보기`} onClick={() => setViewing(f.id)} style={{ flex: 1, minWidth: 0, minHeight: 36, padding: 0, border: 0, background: 'none', textAlign: 'left', fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>
              {f.name}
            </button>
          )}
          {badge?.(f)}
          <span className="mono" style={{ flex: 'none', fontSize: 11, color: 'var(--text-3)' }}>
            {fileSize(f.size)}
          </span>
          <a className="icon-btn" href={`${f.url}?download=1`} aria-label={`${f.name} 내려받기`} title="내려받기">
            <IconDownload />
          </a>
          <button type="button" className="icon-btn" aria-label={`${f.name} 지우기`} title="지우기" disabled={remove.busy} onClick={() => void remove.run(f)}>
            ×
          </button>
        </div>
      ))}
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
        style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '10px 12px 10px 16px', borderRadius: 10, border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--line-strong)'}`, background: drag ? 'var(--accent-sel)' : 'var(--bg)', fontSize: 13, color: drag ? 'var(--text)' : 'var(--text-3)', transition: 'background .12s, border-color .12s' }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>{busy ? `올리는 중 ${Math.min(busy.done + 1, busy.total)}/${busy.total}…` : drag ? '여기에 놓으면 붙여요' : '파일을 여기로 끌어 놓거나'}</span>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => input.current?.click()}>
          파일 고르기
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = '';
            void upload(picked);
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{help}</span>
      {viewing !== null && <FileViewer files={files} id={viewing} onPick={setViewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** 종류 꼬리표 색: PDF는 붉게, md는 파랗게, 나머지는 회색 */
const TAG_TONE: Partial<Record<MyDocFileDto['kind'], [string, string]>> = { pdf: ['var(--risk-bg)', 'var(--risk)'], md: ['var(--accent-bg)', 'var(--accent-ink)'] };

export function FileKindTag({ f }: { f: Pick<AttachmentFile, 'kind'> }) {
  const [bg, fg] = TAG_TONE[f.kind] ?? ['var(--chip)', 'var(--text-2)'];
  return (
    <span className="mono" style={{ flex: 'none', minWidth: 40, padding: '2px 6px', borderRadius: 6, background: bg, color: fg, fontSize: 10, fontWeight: 700, textAlign: 'center' }}>
      {FILE_KIND[f.kind]}
    </span>
  );
}

export function IconDownload() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

/**
 * 첨부 보기 창: PDF는 브라우저 PDF 보기로, md는 렌더링해서, 텍스트는 글자 그대로, 그림은 화면에 맞춰 보여 준다.
 * 볼 수 있는 파일이 여럿이면 ← →로 넘긴다. Esc는 이 창만 닫는다(서랍은 열린 대화창이 있으면 Esc를 넘긴다).
 * @param files 첨부 목록
 * @param id 지금 볼 파일
 */
export function FileViewer({ files, id, onPick, onClose }: { files: AttachmentFile[]; id: number; onPick(id: number): void; onClose(): void }) {
  const { m } = usePrefs();
  const shown = files.filter((f) => f.kind !== 'other');
  const i = shown.findIndex((f) => f.id === id);
  const f = shown[i];
  const step = (d: 1 | -1) => shown.length > 1 && onPick(shown[(i + d + shown.length) % shown.length].id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // 보던 파일을 지우면 닫는다.
  useEffect(() => {
    if (!f) onClose();
  }, [f, onClose]);
  if (!f) return null;

  return createPortal(
    <div className="scrim" onClick={onClose} style={{ padding: m ? 0 : 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${f.name} 보기`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: m ? '100vw' : 'min(1100px, calc(100vw - 32px))', height: m ? '100dvh' : 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: m ? 0 : '1px solid var(--line)', borderRadius: m ? 0 : 12, boxShadow: '0 24px 60px var(--shadow)', overflow: 'hidden' }}
      >
        <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 12px 10px 18px', paddingTop: m ? 'max(10px, env(safe-area-inset-top))' : 10, borderBottom: '1px solid var(--line-soft)' }}>
          <FileKindTag f={f} />
          <span style={{ flex: m ? '1 1 0' : '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
              {f.name}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {fileSize(f.size)} · {stamp(f.createdAt)} 올림{shown.length > 1 ? ` · ${i + 1}/${shown.length}` : ''}
            </span>
          </span>
          {shown.length > 1 && (
            <>
              <button type="button" className="icon-btn" aria-label="이전 파일 (←)" title="이전 파일 (←)" onClick={() => step(-1)}>
                ‹
              </button>
              <button type="button" className="icon-btn" aria-label="다음 파일 (→)" title="다음 파일 (→)" onClick={() => step(1)}>
                ›
              </button>
            </>
          )}
          {/* 좁은 화면에서는 닫기를 첫 줄에 두고 두 버튼은 줄을 바꿔 아래에 둔다 */}
          {m && <span aria-hidden="true" style={{ order: 1, flexBasis: '100%', height: 0 }} />}
          <a className="btn btn-sm" href={f.url} target="_blank" rel="noopener noreferrer" style={{ order: m ? 2 : undefined }}>
            새 탭에서 열기
          </a>
          <a className="btn btn-sm" href={`${f.url}?download=1`} style={{ order: m ? 2 : undefined }}>
            내려받기
          </a>
          <button type="button" className="icon-btn" aria-label="닫기 (Esc)" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: f.kind === 'pdf' ? 'hidden' : 'auto', background: f.kind === 'image' ? 'var(--bg)' : undefined }}>
          {f.kind === 'pdf' && <iframe key={f.id} src={f.url} title={f.name} style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#FFFFFF' }} />}
          {(f.kind === 'md' || f.kind === 'text') && (
            <div style={{ maxWidth: 860, margin: '0 auto', padding: m ? '18px 16px 40px' : '24px 32px 48px' }}>
              <TextFile key={f.id} url={f.url} md={f.kind === 'md'} />
            </div>
          )}
          {f.kind === 'image' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16 }}>
              <img key={f.id} src={f.url} alt={f.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

