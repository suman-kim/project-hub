import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AppDto, AppNoteDto } from '@hub/shared';
import { useAction } from '../api/mutations';
import { BlockEditor } from '../components/BlockEditor';
import { Select } from '../components/Select';
import { ErrorBox, Skeleton, useUi } from '../components/ui';
import { parseBlocks, previewOf, serializeBlocks, type Block } from '../lib/blocks';
import { ago } from '../lib/format';
import { noteName, sortNotes, useAppNotes, useNotesApi, type NotePatch } from '../lib/notes';
import { usePrefs } from '../lib/prefs';

// ---- 노트: 앱마다 노션처럼 쓰는 글 (명령어 보관, 간단한 메모, 할 일) ----

/** 자동 저장: 손을 뗀 뒤 이만큼 지나면 저장한다 */
const SAVE_DELAY_MS = 1000;
/** 폴더 없는 노트의 묶음 이름 */
const NO_FOLDER = '폴더 없음';
/** 폴더 선택 목록에서 "새 폴더" 항목의 값 */
const NEW_FOLDER = '\u0000new';

/** 앱 페이지의 노트 탭 */
export function NotesTab({ app }: { app: AppDto }) {
  const { m } = usePrefs();
  const ui = useUi();
  const notes = useAppNotes(app.id);
  const api = useNotesApi(app.id);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const sorted = useMemo(() => sortNotes(notes.data ?? []), [notes.data]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? sorted.filter((n) => [n.title, n.folder, n.body].some((s) => s.toLowerCase().includes(needle))) : sorted;
  const selId = Number(params.get('note'));
  const picked = sorted.find((n) => n.id === selId) ?? null;
  // 모바일은 목록부터 보여 준다. 넓은 화면은 첫 노트를 바로 연다.
  const current = picked ?? (m ? null : sorted[0] ?? null);
  const select = (n: AppNoteDto | null) => setParams(n ? { note: String(n.id) } : {}, { replace: !n });
  const folders = useMemo(() => Array.from(new Set(sorted.map((n) => n.folder).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')), [sorted]);

  const create = useAction(async () => {
    const n = await api.create(current?.folder ? { folder: current.folder } : {});
    select(n);
  });
  const remove = useAction(async (n: AppNoteDto) => {
    if (!(await ui.confirm({ title: '노트를 지울까요?', body: `"${noteName(n, previewOf)}"을 지워요. 되돌릴 수 없어요.`, label: '지우기' }))) return;
    await api.remove(n.id);
    ui.toast('노트를 지웠어요');
    const rest = sorted.filter((x) => x.id !== n.id);
    select(m ? null : rest[0] ?? null);
  });

  if (notes.isLoading) return <Skeleton rows={6} height={40} />;
  if (notes.error) return <ErrorBox error={notes.error} onRetry={() => void notes.refetch()} />;

  const list = <NoteList notes={shown} total={sorted.length} current={current} onPick={select} q={q} setQ={setQ} onCreate={() => void create.run()} busy={create.busy} sticky={!m} />;
  const editor = current && <NoteEditor key={current.id} note={current} folders={folders} api={api} onDelete={() => void remove.run(current)} onBack={m ? () => select(null) : undefined} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>이 앱에서 자주 쓰는 명령어, 간단한 메모, 할 일을 노션처럼 적어 둬요 · 쓰는 대로 저장돼요</span>
      {!sorted.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: '28px 24px', border: '1px dashed var(--line-strong)', borderRadius: 12, background: 'var(--surface)' }}>
          <span style={{ fontSize: 14, color: 'var(--text-3)' }}>아직 노트가 없어요 · 자주 쓰는 명령어나 할 일부터 적어 보세요</span>
          <button type="button" className="btn btn-primary" disabled={create.busy} onClick={() => void create.run()}>
            첫 노트 만들기
          </button>
        </div>
      ) : m ? (
        editor ?? list
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          {list}
          {editor ?? <div style={{ padding: '28px 24px', border: '1px dashed var(--line-strong)', borderRadius: 12, background: 'var(--surface)', fontSize: 14, color: 'var(--text-3)' }}>왼쪽에서 노트를 고르세요</div>}
        </div>
      )}
    </div>
  );
}

interface ListProps {
  notes: AppNoteDto[];
  /** 검색 전 전체 수 */
  total: number;
  current: AppNoteDto | null;
  onPick(n: AppNoteDto): void;
  q: string;
  setQ(v: string): void;
  onCreate(): void;
  busy: boolean;
  /** 넓은 화면에서 긴 노트를 내려도 목록이 화면에 남는다 */
  sticky: boolean;
}

/** 왼쪽 목록: 고정 노트 묶음이 맨 위, 그다음 폴더별 묶음 */
function NoteList({ notes, total, current, onPick, q, setQ, onCreate, busy, sticky }: ListProps) {
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);
  const folders = Array.from(new Set(rest.map((n) => n.folder))).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko')));
  const groups = [
    ...(pinned.length ? [{ key: '\u0000pinned', label: '고정', notes: pinned }] : []),
    // 폴더가 하나도 없으면 묶음 이름을 보이지 않는다
    ...folders.map((f) => ({ key: `f:${f}`, label: f || (folders.length > 1 || pinned.length ? NO_FOLDER : ''), notes: rest.filter((n) => n.folder === f) })),
  ];
  return (
    <section className="card" style={{ minWidth: 0, overflow: 'hidden', ...(sticky ? { position: 'sticky', top: 16 } : {}) }}>
      <div style={{ display: 'flex', gap: 8, padding: 12, borderBottom: '1px solid var(--line-soft)' }}>
        <input type="search" className="input" style={{ flex: 1, minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`노트 ${total}개에서 찾기`} aria-label="노트 찾기" />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onCreate} title="새 노트">
          + 새 노트
        </button>
      </div>
      <div style={{ maxHeight: '72vh', overflowY: 'auto' }}>
        {groups.map((g) => (
          <div key={g.key}>
            {g.label && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 6px', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                <span className="ellipsis">{g.label}</span>
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
                  {g.notes.length}
                </span>
              </div>
            )}
            {g.notes.map((n) => {
              const on = current?.id === n.id;
              const name = noteName(n, previewOf);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onPick(n)}
                  aria-current={on ? 'true' : undefined}
                  className="row-btn"
                  style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 48, padding: '8px 16px', border: 0, background: on ? 'var(--accent-sel)' : 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
                >
                  <span className="ellipsis" style={{ width: '100%', fontSize: 13, fontWeight: on ? 600 : 500, color: name === '제목 없음' ? 'var(--text-3)' : undefined }}>
                    {name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {n.pinned && n.folder ? `${n.folder} · ` : ''}
                    {ago(n.updatedAt)} 수정
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {!notes.length && <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-3)' }}>"{q.trim()}"에 맞는 노트가 없어요 · 제목·폴더·본문에서 찾아요</div>}
      </div>
    </section>
  );
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface EditorProps {
  note: AppNoteDto;
  /** 이 앱에 있는 폴더 이름들 (선택 목록) */
  folders: string[];
  api: ReturnType<typeof useNotesApi>;
  onDelete(): void;
  /** 모바일에서 목록으로 돌아가기 */
  onBack?: () => void;
}

/** 오른쪽 편집기: 제목·폴더·고정과 블록 편집기. 손을 떼면 자동 저장, Cmd+S는 바로 저장 */
function NoteEditor({ note, folders, api, onDelete, onBack }: EditorProps) {
  const ui = useUi();
  const [title, setTitle] = useState(note.title);
  const [folder, setFolder] = useState(note.folder);
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(note.body));
  const [state, setState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<string>(note.updatedAt);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  /** 마지막으로 서버에 보낸 값. 같으면 저장하지 않는다 */
  const last = useRef<Required<Pick<NotePatch, 'title' | 'folder' | 'body'>>>({ title: note.title, folder: note.folder, body: note.body });
  const latest = useRef({ title, folder, blocks });
  latest.current = { title, folder, blocks };
  const timer = useRef<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const cur = latest.current;
    const patch = { title: cur.title, folder: cur.folder, body: serializeBlocks(cur.blocks) };
    if (patch.title === last.current.title && patch.folder === last.current.folder && patch.body === last.current.body) {
      setState('saved');
      return;
    }
    setState('saving');
    try {
      const n = await api.update(note.id, patch);
      last.current = patch;
      setSavedAt(n.updatedAt);
      setState('saved');
    } catch (e) {
      setState('error');
      ui.fail(e);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /** 값이 바뀌면 잠시 뒤 저장한다 */
  const touch = () => {
    setState('dirty');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveRef.current(), SAVE_DELAY_MS);
  };
  // 다른 노트로 옮기거나 탭을 떠날 때 남은 변경을 바로 저장한다
  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        void saveRef.current();
      }
    },
    [],
  );
  useEffect(() => {
    if (!note.title && !note.body) titleRef.current?.focus();
  }, [note.id, note.title, note.body]);

  const togglePin = useAction(async () => {
    await api.update(note.id, { pinned: !note.pinned });
    ui.toast(note.pinned ? '고정을 풀었어요' : '목록 맨 위에 고정했어요');
  });

  const folderOptions = [{ value: '', label: NO_FOLDER }, ...folders.map((f) => ({ value: f, label: f })), ...(folder && !folders.includes(folder) ? [{ value: folder, label: folder }] : []), { value: NEW_FOLDER, label: '+ 새 폴더…' }];
  const status = state === 'saving' ? '저장 중…' : state === 'dirty' ? '쓰는 중…' : state === 'error' ? '저장하지 못했어요' : `저장됨 · ${ago(savedAt)}`;

  return (
    <section
      className="card"
      style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}
      onKeyDown={(e) => {
        if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
        {onBack && (
          <button type="button" className="btn btn-sm" onClick={onBack}>
            ← 목록
          </button>
        )}
        {newFolder === null ? (
          <Select
            label="폴더"
            size="sm"
            value={folder}
            options={folderOptions}
            onChange={(v) => {
              if (v === NEW_FOLDER) setNewFolder('');
              else {
                setFolder(v);
                touch();
              }
            }}
          />
        ) : (
          <form
            style={{ display: 'flex', gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = newFolder.trim().slice(0, 100);
              setNewFolder(null);
              if (!f) return;
              setFolder(f);
              touch();
            }}
          >
            <input className="input" autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="새 폴더 이름" aria-label="새 폴더 이름" style={{ minHeight: 32, width: 160, fontSize: 13 }} onKeyDown={(e) => e.key === 'Escape' && setNewFolder(null)} />
            <button type="submit" className="btn btn-sm btn-primary">
              만들기
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setNewFolder(null)}>
              취소
            </button>
          </form>
        )}
        <span role="status" style={{ marginLeft: 'auto', fontSize: 12, color: state === 'error' ? 'var(--risk)' : 'var(--text-3)' }}>
          {status}
          {state === 'error' && (
            <button type="button" className="link" style={{ marginLeft: 6, fontSize: 12 }} onClick={() => void save()}>
              다시 저장
            </button>
          )}
        </span>
        <button type="button" className="btn btn-sm" aria-pressed={note.pinned} disabled={togglePin.busy} onClick={() => void togglePin.run()}>
          {note.pinned ? '고정 풀기' : '고정'}
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>
          지우기
        </button>
      </div>
      <div style={{ padding: '18px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            touch();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === title.length)) {
              e.preventDefault();
              (e.currentTarget.parentElement?.querySelector('[data-block-id]') as HTMLElement | null)?.focus();
            }
          }}
          placeholder="제목 없음"
          aria-label="노트 제목"
          maxLength={300}
          style={{ width: '100%', border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: 28, fontWeight: 700, lineHeight: 1.3, padding: 0 }}
        />
        <BlockEditor
          blocks={blocks}
          onChange={(next) => {
            setBlocks(next);
            touch();
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>"/" 블록 종류 · Enter 새 블록 · Shift+Enter 줄바꿈 · Cmd+Shift+↑↓ 블록 옮기기 · Cmd+S 바로 저장</span>
      </div>
    </section>
  );
}
