import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import type { MyDocDto, MyDocFileDto, MyDocKind, MyDocRenew, MySecretMode, MyTodoDto } from '@hub/shared';
import { MY_DOC_KINDS } from '@hub/shared';
import { useAction } from '../api/mutations';
import { Segmented } from '../components/forms';
import { Select } from '../components/Select';
import { IconClose } from '../components/icons';
import { Dialog, ErrorBox, Skeleton, useUi } from '../components/ui';
import { fileSize, stamp } from '../lib/format';
import { ALERT_DAYS, daysLeft, dLeft, DOC_KIND, FILE_KIND, isoDay, MAX_FILE_MB, mdOf, useMine, useMineApi } from '../lib/mine';
import { usePrefs } from '../lib/prefs';
import { useNotes } from '../lib/notes';
import { TextFile } from './AppDocs';
import { NotesTab } from './AppNotes';

const PRIO: Record<1 | 2 | 3, string> = { 1: '우선순위 높음', 2: '우선순위 보통', 3: '우선순위 낮음' };
const SECRET0: Record<MyDocKind, MySecretMode> = { store: 'ref', apikey: 'ref', billing: 'none', domain: 'none', legal: 'none', memo: 'none' };
const KIND_ORDER = [...MY_DOC_KINDS].sort();

type Tab = 'todo' | 'notes' | 'vault';

/** 주소의 ?tab= 값 → 탭. 예전 주소(?tab=docs)도 보관함으로 연다 */
function tabOf(v: string | null): Tab {
  return v === 'notes' ? 'notes' : v === 'vault' || v === 'docs' ? 'vault' : 'todo';
}

/** 내 업무: 앱에 묶이지 않는 내 할 일, 노트, 보관함(계정·키·결제·도메인 문서). ?tab=vault&doc=ID로 문서 서랍을 연다 */
export function Mine() {
  const [params, setParams] = useSearchParams();
  const tab = tabOf(params.get('tab'));
  const mine = useMine();
  const notes = useNotes(null);
  const setTab = (t: Tab) => setParams(t === 'todo' ? {} : { tab: t }, { replace: true });
  const openDoc = (id: number) => setParams({ tab: 'vault', doc: String(id) });
  const todos = mine.data?.todos ?? [];
  // 할 일에 연결하는 문서는 공통 보관함 것만 (앱 전용 문서는 앱 페이지 보관함에 있다)
  const common = (mine.data?.docs ?? []).filter((d) => d.appId === null);

  return (
    <div data-screen-label="내 업무" className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="page-sub">앱에 묶이지 않는 내 할 일, 노트, 계정·키·결제·도메인 보관함 · 모든 앱에 공통이에요</span>
        <h1 className="page-title">내 업무</h1>
      </div>
      <div role="tablist" aria-label="내 업무" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' }}>
        {(
          [
            ['todo', '할 일', todos.filter((t) => !t.parentId && !t.done).length],
            ['notes', '노트', notes.data?.length],
            ['vault', '보관함', common.length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            style={{ minHeight: 44, padding: '0 14px', marginBottom: -1, border: 0, borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`, background: 'none', color: tab === k ? 'var(--text)' : 'var(--text-3)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {label}
            {n !== undefined && (
              <span className="mono" style={{ padding: '0 7px', borderRadius: 999, background: 'var(--chip)', color: 'var(--text-2)', fontSize: 12 }}>
                {n}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === 'todo' && mine.isLoading && <Skeleton rows={6} height={48} />}
      {tab === 'todo' && mine.error && <ErrorBox error={mine.error} onRetry={() => void mine.refetch()} />}
      {tab === 'todo' && mine.data && <TodoTab todos={todos} docs={common} openDoc={openDoc} />}
      {tab === 'notes' && <NotesTab owner={null} />}
      {tab === 'vault' && <VaultPanel appId={null} />}
    </div>
  );
}

/**
 * 보관함: 계정·키·결제·도메인·법무·메모 문서 목록과 문서 서랍. 내 업무(공통)와 앱 페이지(앱 전용)가 같이 쓴다.
 * 문서는 공통·앱 전용이 모두 ['mine'] 캐시에 있고, 여기서 appId로 골라 보여 준다. 연 문서는 주소의 ?doc=로 남긴다.
 * @param appId 앱 전용 보관함이면 앱 id, 내 업무 공통 보관함이면 null
 */
export function VaultPanel({ appId }: { appId: number | null }) {
  const [params, setParams] = useSearchParams();
  const mine = useMine();
  const docId = Number(params.get('doc')) || null;
  // 다른 쿼리(내 업무의 ?tab=)는 그대로 두고 ?doc=만 바꾼다. 열 때는 기록을 남겨 뒤로 가기로 닫히게 한다.
  const openDoc = (id: number | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('doc', String(id));
        else next.delete('doc');
        return next;
      },
      { replace: !!docId === !!id },
    );
  const docs = (mine.data?.docs ?? []).filter((d) => d.appId === appId);
  const open = docs.find((d) => d.id === docId) ?? null;

  if (mine.isLoading) return <Skeleton rows={6} height={48} />;
  if (mine.error) return <ErrorBox error={mine.error} onRetry={() => void mine.refetch()} />;
  return (
    <>
      <DocsTab docs={docs} appId={appId} openId={docId} openDoc={openDoc} />
      {open && <DocDrawer key={open.id} doc={open} onClose={() => openDoc(null)} />}
    </>
  );
}

function TodoTab({ todos, docs, openDoc }: { todos: MyTodoDto[]; docs: MyDocDto[]; openDoc(id: number): void }) {
  const ui = useUi();
  const mx = useMineApi();
  const [draft, setDraft] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const add = useAction(async () => {
    const v = draft.trim();
    if (!v) return;
    const t = await mx.addTodo(v);
    setDraft('');
    ui.toast(`${t.key}을 추가했어요 · 기한은 행에서 넣어요`);
  });

  // 이번 주는 오늘부터 이번 주 일요일까지
  const toSunday = (7 - new Date().getDay()) % 7;
  const sort = (a: MyTodoDto, b: MyTodoDto) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.priority - b.priority;
  // 하위 할 일은 묶음에 따로 나오지 않고 자기 상위 아래에만 보인다.
  const top = todos.filter((t) => !t.parentId);
  const subsOf = useMemo(() => {
    const m = new Map<number, MyTodoDto[]>();
    for (const t of todos) if (t.parentId) m.set(t.parentId, [...(m.get(t.parentId) ?? []), t]);
    for (const list of m.values()) list.sort((a, b) => a.id - b.id);
    return m;
  }, [todos]);
  const open = top.filter((t) => !t.done);
  const groups = [
    { key: 'over', label: '기한 지남', dot: 'var(--attn-dot)', list: open.filter((t) => t.dueDate && daysLeft(t.dueDate) < 0) },
    { key: 'week', label: `이번 주 · ${mdOf(isoDay(toSunday))}까지`, dot: 'var(--prog-dot)', list: open.filter((t) => t.dueDate && daysLeft(t.dueDate) >= 0 && daysLeft(t.dueDate) <= toSunday) },
    { key: 'later', label: '나중', dot: 'var(--muted-dot)', list: open.filter((t) => !t.dueDate || daysLeft(t.dueDate) > toSunday) },
  ].map((g) => ({ ...g, list: g.list.sort(sort) }));
  const done = top.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 880 }}>
      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>어느 앱에도 묶이지 않는 내 할 일이에요. 앱마다의 할 일은 각 앱 페이지의 태스크 보드에 있어요.</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          aria-label="내 할 일 추가"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void add.run();
            }
          }}
          placeholder="할 일을 한 줄로 쓰고 Enter · 예: Apple Developer 멤버십 갱신"
        />
        <button type="button" className="btn" disabled={!draft.trim() || add.busy} onClick={() => void add.run()}>
          추가
        </button>
      </div>
      {!top.length && (
        <div style={{ padding: '28px 24px', border: '1px dashed var(--line-strong)', borderRadius: 12, background: 'var(--surface)', fontSize: 14, color: 'var(--text-3)' }}>내 할 일이 없어요 · 위 입력란에 한 줄로 쓰고 Enter</div>
      )}
      {groups
        .filter((g) => g.list.length)
        .map((g) => (
          <section key={g.key} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 20px' }}>
              <span aria-hidden="true" className="dot" style={{ background: g.dot }} />
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{g.label}</h2>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {g.list.length}
              </span>
            </div>
            {g.list.map((t) => (
              <TodoRow key={t.id} t={t} subs={subsOf.get(t.id) ?? []} docs={docs} openDoc={openDoc} />
            ))}
          </section>
        ))}
      {done.length > 0 && (
        <section className="card">
          <button type="button" onClick={() => setDoneOpen(!doneOpen)} aria-expanded={doneOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 20px', border: 0, background: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
            <span aria-hidden="true" className="dot" style={{ background: 'var(--done-dot)' }} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>완료</h2>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {done.length}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>{doneOpen ? '▾' : '▸'}</span>
          </button>
          {doneOpen && done.map((t) => <TodoRow key={t.id} t={t} subs={subsOf.get(t.id) ?? []} docs={docs} openDoc={openDoc} />)}
        </section>
      )}
    </div>
  );
}

/**
 * 체크하면 완료(되돌리기 6초). 상위 할 일을 끝내면 남은 하위 할 일도 서버가 같이 끝내고,
 * 되돌리면 그때 같이 끝난 하위만 돌아온다. 하위 할 일 체크는 조용히 바꾼다.
 */
export function useToggleMine() {
  const ui = useUi();
  const mx = useMineApi();
  return useAction(async (t: MyTodoDto, openSubs = 0) => {
    await mx.updateTodo(t.id, { done: !t.done });
    if (t.parentId) return;
    // 서버가 남은 하위 할 일도 같이 바꿨으니 다시 읽는다.
    await mx.refresh();
    const undo = async () => {
      await mx.updateTodo(t.id, { done: false });
      await mx.refresh();
    };
    if (!t.done) ui.toast(`${t.key} 완료했어요${openSubs ? ` · 하위 ${openSubs}개도 완료` : ''}`, { undo: () => void undo().catch(ui.fail) });
    else ui.toast(`${t.key} 다시 할 일로 돌렸어요`);
  });
}

function TodoRow({ t, subs, docs, openDoc }: { t: MyTodoDto; subs: MyTodoDto[]; docs: MyDocDto[]; openDoc(id: number): void }) {
  const ui = useUi();
  const mx = useMineApi();
  const toggle = useToggleMine();
  const [edit, setEdit] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const openSubs = subs.filter((x) => !x.done).length;
  const [title, setTitle] = useState(t.title);
  const doc = docs.find((d) => d.id === t.docId) ?? null;
  const off = t.dueDate ? daysLeft(t.dueDate) : null;
  const overdue = !t.done && off !== null && off < 0;
  const note = t.done || off === null ? '' : off < 0 ? `${-off}일 지남` : off === 0 ? '오늘' : off === 1 ? '내일' : '';
  const save = useAction(async (patch: Parameters<typeof mx.updateTodo>[1]) => {
    await mx.updateTodo(t.id, patch);
  });
  const remove = useAction(async () => {
    if (!(await ui.confirm({ title: `${t.key}를 지울까요?`, body: subs.length ? `${t.title}\n하위 할 일 ${subs.length}개도 함께 지워져요.` : t.title, label: '지우기' }))) return;
    await mx.deleteTodo(t.id);
    ui.toast(`${t.key}를 지웠어요`);
  });

  return (
    <div style={{ borderTop: '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', minHeight: 56, padding: '6px 12px 6px 8px' }}>
        <button
          type="button"
          role="checkbox"
          aria-checked={t.done}
          aria-label="완료"
          disabled={toggle.busy}
          onClick={() => void toggle.run(t, openSubs)}
          style={{ width: 44, height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'none', cursor: 'pointer' }}
        >
          <CheckBox done={t.done} />
        </button>
        <button type="button" onClick={() => doc && openDoc(doc.id)} style={{ flex: '1 1 220px', minWidth: 0, padding: 0, border: 0, background: 'none', color: 'var(--text)', textAlign: 'left', cursor: doc ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45, textDecoration: t.done ? 'line-through' : undefined, color: t.done ? 'var(--text-3)' : undefined }}>{t.title}</span>
          <span style={{ fontSize: 12, color: doc ? 'var(--accent)' : 'var(--text-3)' }}>
            {t.key} · {doc ? `문서 ${doc.title || '제목 없음'}` : '공통'}
          </span>
        </button>
        {subs.length > 0 && (
          <button type="button" aria-expanded={subsOpen} onClick={() => setSubsOpen(!subsOpen)} title="하위 할 일 보기" style={{ flex: 'none', minHeight: 32, padding: '0 10px', borderRadius: 999, border: '1px solid var(--line-strong)', background: subs.length - openSubs === subs.length ? 'var(--done-bg)' : 'var(--surface)', color: subs.length - openSubs === subs.length ? 'var(--done)' : 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {subsOpen ? '▾' : '▸'} 하위 {subs.length - openSubs}/{subs.length}
          </button>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {note && <span style={{ fontSize: 12, fontWeight: 600, color: overdue ? 'var(--attn)' : 'var(--text-2)' }}>{note}</span>}
          <input
            type="date"
            aria-label="기한"
            className="input mono"
            value={t.dueDate ?? ''}
            onChange={(e) => void save.run({ dueDate: e.target.value || null })}
            style={{ minHeight: 36, padding: '0 8px', fontSize: 12, borderColor: overdue ? 'var(--attn-soft)' : undefined, color: overdue ? 'var(--attn)' : undefined }}
          />
          <Select
            label="우선순위"
            size="sm"
            value={String(t.priority)}
            onChange={(v) => void save.run({ priority: Number(v) as 1 | 2 | 3 })}
            menuWidth={150}
            options={([1, 2, 3] as const).map((p) => ({ value: String(p), label: PRIO[p] }))}
            style={{ fontSize: 12 }}
          />
          <button type="button" className="icon-btn" aria-label="고치기·문서 연결·지우기" aria-expanded={edit} onClick={() => (setTitle(t.title), setEdit(!edit))}>
            ⋯
          </button>
        </div>
      </div>
      {edit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '0 20px 14px 52px' }}>
          <input
            className="input"
            aria-label="제목 고치기"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && title.trim()) void save.run({ title }).then(() => setEdit(false));
              if (e.key === 'Escape') setEdit(false);
            }}
            style={{ flex: '1 1 240px' }}
          />
          <button type="button" className="btn btn-sm" disabled={!title.trim() || title === t.title || save.busy} onClick={() => void save.run({ title }).then(() => setEdit(false))}>
            제목 저장
          </button>
          <Select
            label="문서 연결"
            size="sm"
            value={String(t.docId ?? '')}
            onChange={(v) => void save.run({ docId: v ? Number(v) : null })}
            menuWidth={320}
            options={[{ value: '', label: '문서 연결 안 함' }, ...docs.map((d) => ({ value: String(d.id), label: d.title || '제목 없음', hint: DOC_KIND[d.kind] }))]}
            style={{ fontSize: 12, maxWidth: 260 }}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setSubsOpen(true);
              setEdit(false);
            }}
          >
            + 하위 할 일
          </button>
          <button type="button" className="btn btn-sm" disabled={remove.busy} onClick={() => void remove.run()} style={{ color: 'var(--risk)' }}>
            지우기
          </button>
        </div>
      )}
      {subsOpen && <SubTodos parent={t} subs={subs} />}
    </div>
  );
}

function CheckBox({ done, small }: { done: boolean; small?: boolean }) {
  const size = small ? 16 : 20;
  return (
    <span style={{ width: size, height: size, borderRadius: small ? 5 : 6, border: `2px solid ${done ? 'var(--accent)' : 'var(--line-strong)'}`, background: done ? 'var(--accent)' : 'var(--surface)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: small ? 10 : 12, fontWeight: 700 }}>
      {done ? '✓' : ''}
    </span>
  );
}

/** 하위 할 일: 체크리스트처럼 제목과 완료만. 제목을 누르면 고치고, ×로 지운다 */
function SubTodos({ parent, subs }: { parent: MyTodoDto; subs: MyTodoDto[] }) {
  const ui = useUi();
  const mx = useMineApi();
  const toggle = useToggleMine();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: number; title: string } | null>(null);
  const add = useAction(async () => {
    const v = draft.trim();
    if (!v) return;
    await mx.addTodo(v, parent.id);
    setDraft('');
  });
  const rename = useAction(async () => {
    if (!editing) return;
    if (editing.title.trim()) await mx.updateTodo(editing.id, { title: editing.title });
    setEditing(null);
  });
  const remove = useAction(async (id: number) => {
    await mx.deleteTodo(id);
    ui.toast('하위 할 일을 지웠어요');
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '0 20px 12px 52px' }}>
      {subs.map((x) => (
        <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 40, borderTop: '1px dashed var(--line-soft)' }}>
          <button type="button" role="checkbox" aria-checked={x.done} aria-label="하위 할 일 완료" disabled={toggle.busy} onClick={() => void toggle.run(x)} style={{ width: 36, height: 36, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'none', cursor: 'pointer' }}>
            <CheckBox done={x.done} small />
          </button>
          {editing?.id === x.id ? (
            <input
              autoFocus
              className="input"
              aria-label="하위 할 일 고치기"
              value={editing.title}
              onChange={(e) => setEditing({ id: x.id, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void rename.run();
                if (e.key === 'Escape') setEditing(null);
              }}
              onBlur={() => void rename.run()}
              style={{ flex: 1, minHeight: 34, fontSize: 13 }}
            />
          ) : (
            <button type="button" title="눌러서 고치기" onClick={() => setEditing({ id: x.id, title: x.title })} style={{ flex: 1, minWidth: 0, padding: '6px 0', border: 0, background: 'none', color: x.done ? 'var(--text-3)' : 'var(--text)', textDecoration: x.done ? 'line-through' : undefined, fontSize: 13, textAlign: 'left', cursor: 'text' }}>
              {x.title}
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="하위 할 일 지우기" title="지우기" disabled={remove.busy} onClick={() => void remove.run(x.id)}>
            ×
          </button>
        </div>
      ))}
      <input
        autoFocus={!subs.length}
        className="input"
        aria-label="하위 할 일 추가"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void add.run();
          }
        }}
        placeholder="+ 하위 할 일 · 한 줄로 쓰고 Enter"
        style={{ marginTop: 6, minHeight: 36, fontSize: 13 }}
      />
    </div>
  );
}

// ---- 문서 ----

/** 만료·갱신 알약: 지났으면 risk, 14일 안이면 attn */
export function ExpiryPill({ d }: { d: MyDocDto }) {
  if (!d.expiresOn) return null;
  const off = daysLeft(d.expiresOn);
  const tone = off < 0 ? { bg: 'var(--risk-bg)', fg: 'var(--risk)' } : off <= ALERT_DAYS ? { bg: 'var(--attn-bg)', fg: 'var(--attn)' } : { bg: 'var(--chip)', fg: 'var(--text-2)' };
  return (
    <span className="pill" style={{ flex: 'none', background: tone.bg, color: tone.fg, whiteSpace: 'nowrap' }}>
      {d.renewLabel} {mdOf(d.expiresOn)} · {dLeft(off)}
    </span>
  );
}

function docSub(d: MyDocDto): string {
  if (d.secretMode === 'ref' && d.secretRef) return d.secretRef;
  const f = d.fields.find(([k, v]) => k || v);
  if (f) return `${f[0]} · ${f[1]}`;
  return d.memo.split('\n')[0] ?? '';
}

/**
 * @param docs 이 보관함의 문서 (공통이면 공통 것만, 앱이면 그 앱 것만)
 * @param appId 앱 전용 보관함이면 앱 id, 공통이면 null (새 문서가 어디에 생길지)
 * @param openId 서랍에 열린 문서
 * @param openDoc 문서 서랍 열기
 */
function DocsTab({ docs, appId, openId, openDoc }: { docs: MyDocDto[]; appId: number | null; openId: number | null; openDoc(id: number): void }) {
  const [kind, setKind] = useState<MyDocKind | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const shown = docs
    .filter((d) => kind === 'all' || d.kind === kind)
    .sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id - b.id);
  const near = docs.filter((d) => d.expiresOn && daysLeft(d.expiresOn) <= ALERT_DAYS).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 920 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <div role="group" aria-label="문서 종류" style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: '1 1 300px', paddingBottom: 2 }}>
          {(['all', ...MY_DOC_KINDS] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === 'all' ? '전체' : DOC_KIND[k]}
              <span className="chip-count">{k === 'all' ? docs.length : docs.filter((d) => d.kind === k).length}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          문서 추가
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', borderRadius: 10, background: 'var(--bg)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>
        <span>
          {appId === null
            ? 'ⓘ 여기 문서는 모든 앱에 공통이에요. 한 앱에서만 쓰는 계정·키는 그 앱 페이지의 보관함에 두세요. '
            : 'ⓘ 이 앱에서만 쓰는 문서예요. 여러 앱에 두루 쓰는 계정·키는 내 업무의 보관함에 두세요. '}
          Claude가 새 세션에서 {appId === null ? '이 문서들을' : '이 문서들과 공통 보관함을'} 읽어요 ([Hub context]). 저장한 키 값은 넘기지 않고, 이름과 위치, 마지막 4자리만 넘겨요.
        </span>
        {near > 0 && <span style={{ color: 'var(--attn)' }}>14일 안에 만료·갱신되는 문서 {near}개는 대시보드에도 떠요</span>}
      </div>
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '14px 20px' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>문서</h2>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {shown.length}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>만료·갱신이 가까운 것부터</span>
        </div>
        {shown.map((d) => (
          <button
            key={d.id}
            type="button"
            className="row-btn"
            onClick={() => openDoc(d.id)}
            style={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', minHeight: 60, padding: '10px 20px', border: 0, borderTop: '1px solid var(--line-soft)', background: openId === d.id ? 'var(--accent-sel)' : 'none', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
          >
            <span style={{ width: 132, flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>{DOC_KIND[d.kind]}</span>
            <span style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
                {d.title || '제목 없음'}
              </span>
              {docSub(d) && (
                <span className="ellipsis" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {docSub(d)}
                </span>
              )}
            </span>
            {d.files.length > 0 && (
              <span title={d.files.map((f) => f.name).join('\n')} style={{ flex: 'none', padding: '1px 8px', borderRadius: 6, background: 'var(--chip)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                첨부 {d.files.length}
              </span>
            )}
            {d.secretMode !== 'none' && (
              <span style={{ flex: 'none', padding: '1px 8px', borderRadius: 6, border: '1px solid var(--line-strong)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{d.secretMode === 'value' ? '값 저장' : '위치만'}</span>
            )}
            <ExpiryPill d={d} />
          </button>
        ))}
        {!shown.length && <div className="card-empty">{docs.length ? '이 종류의 문서가 없어요' : `아직 문서가 없어요 · 문서 추가로 ${appId === null ? '' : '이 앱의 '}계정·키·결제·도메인을 남겨요`}</div>}
      </section>
      {adding && (
        <AddDoc
          kind={kind === 'all' ? 'apikey' : kind}
          appId={appId}
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setKind('all');
            openDoc(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * @param kind 처음 고른 종류
 * @param appId 앱 전용 보관함이면 앱 id, 공통이면 null
 * @param onCreated 만든 뒤 그 문서 서랍을 연다
 */
function AddDoc({ kind: kind0, appId, onClose, onCreated }: { kind: MyDocKind; appId: number | null; onClose(): void; onCreated(id: number): void }) {
  const ui = useUi();
  const mx = useMineApi();
  const [kind, setKind] = useState<MyDocKind>(kind0);
  const [title, setTitle] = useState('');
  const create = useAction(async () => {
    if (!title.trim()) return;
    const d = await mx.addDoc(kind, title.trim(), appId);
    ui.toast('문서를 만들었어요');
    onCreated(d.id);
  });
  return (
    <Dialog label="문서 추가" width={460} onClose={onClose}>
      <h2>문서 추가</h2>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
        종류
        <Select<MyDocKind> label="종류" value={kind} onChange={setKind} options={MY_DOC_KINDS.map((k) => ({ value: k, label: DOC_KIND[k] }))} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
        제목
        <input
          autoFocus
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void create.run();
          }}
          placeholder="예: Toss Payments 테스트 키"
        />
      </label>
      <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.55 }}>
        {SECRET0[kind] === 'ref' ? '키나 비밀번호는 다음 화면에서 값을 저장할지, 위치만 적을지 골라요 · 처음에는 위치만 적기로 시작해요' : '다음 화면에서 내용, 만료·갱신일, 메모를 채워요'}
      </span>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" disabled={!title.trim() || create.busy} onClick={() => void create.run()}>
          만들기
        </button>
      </div>
    </Dialog>
  );
}

/** 글을 고치면 잠깐 기다렸다가 저장한다. 서랍을 닫을 때 남은 것을 바로 저장한다 */
function useAutosave(save: (patch: Record<string, unknown>) => Promise<unknown>) {
  const ui = useUi();
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) void save(patch).catch(ui.fail);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  return {
    later: (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flushRef.current(), 600);
    },
    now: (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      flushRef.current();
    },
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>{title}</h3>
      {children}
    </section>
  );
}

/** 문서 서랍: 고치는 대로 자동 저장. 키 값은 보기를 눌렀을 때만 받아 오고 그때만 고칠 수 있다 */
function DocDrawer({ doc, onClose }: { doc: MyDocDto; onClose(): void }) {
  const { m } = usePrefs();
  const ui = useUi();
  const mx = useMineApi();
  const auto = useAutosave((patch) => mx.updateDoc(doc.id, patch));
  const [title, setTitle] = useState(doc.title);
  const [fields, setFields] = useState<Array<[string, string]>>(doc.fields);
  const [ref, setRef] = useState(doc.secretRef);
  const [memo, setMemo] = useState(doc.memo);
  const [revealed, setRevealed] = useState<string | null>(null);
  const secretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=alertdialog],[role=dialog]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setFieldsSave = (next: Array<[string, string]>) => {
    setFields(next);
    auto.later({ fields: next });
  };
  const setMode = useAction(async (mode: MySecretMode) => {
    if (mode === doc.secretMode) return;
    if (doc.secretMode === 'value' && doc.hasValue && !(await ui.confirm({ title: '저장한 키 값을 지울까요?', body: `${doc.title || '이 문서'}에 저장한 값은 다른 방식으로 바꾸면 지워져요.`, label: '지우고 바꾸기' }))) return;
    setRevealed(null);
    await mx.updateDoc(doc.id, { secretMode: mode });
  });
  const reveal = useAction(async () => {
    if (revealed !== null) return setRevealed(null);
    setRevealed(await mx.getSecret(doc.id));
  });
  const editSecret = (v: string) => {
    setRevealed(v);
    if (secretTimer.current) clearTimeout(secretTimer.current);
    secretTimer.current = setTimeout(() => void mx.setSecret(doc.id, v).catch(ui.fail), 600);
  };
  const copy = useAction(async () => {
    const v = revealed ?? (doc.hasValue ? await mx.getSecret(doc.id) : '');
    if (!v) return;
    await navigator.clipboard.writeText(v).then(
      () => ui.toast(`${doc.title || '문서'} 값을 복사했어요`),
      () => ui.toast('복사하지 못했어요', { error: true }),
    );
  });
  const remove = useAction(async () => {
    const body = doc.secretMode === 'value' && doc.hasValue ? `${doc.title || '제목 없음'}\n저장한 키 값도 함께 지워져요.` : doc.title || '제목 없음';
    if (!(await ui.confirm({ title: '이 문서를 지울까요?', body, label: '지우기' }))) return;
    await mx.deleteDoc(doc.id);
    onClose();
    ui.toast('문서를 지웠어요');
  });

  const off = doc.expiresOn ? daysLeft(doc.expiresOn) : null;
  const expiryHint =
    off === null
      ? `날짜를 넣으면 ${ALERT_DAYS}일 전부터 대시보드에 알림이 떠요`
      : `${doc.renewLabel} ${mdOf(doc.expiresOn!)} · ${dLeft(off)} · ${off <= ALERT_DAYS ? '지금 대시보드에 떠 있어요' : `${ALERT_DAYS}일 전부터 대시보드에 떠요`}`;

  return (
    <aside
      aria-label="문서"
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 35, width: m ? '100vw' : 480, maxWidth: '100vw', overflowY: 'auto', background: 'var(--surface)', borderLeft: '1px solid var(--line)', boxShadow: '-16px 0 40px var(--shadow)' }}
    >
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', borderBottom: '1px solid var(--line-soft)', padding: '14px 20px', paddingTop: 'max(14px, env(safe-area-inset-top))', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Select<MyDocKind> label="문서 종류" size="sm" value={doc.kind} onChange={(k) => auto.now({ kind: k })} menuWidth={180} options={MY_DOC_KINDS.map((k) => ({ value: k, label: DOC_KIND[k] }))} style={{ minHeight: 32, fontSize: 12 }} />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>마지막 수정 {stamp(doc.updatedAt)}</span>
          <button type="button" className="icon-btn" aria-label="닫기 (Esc)" onClick={onClose} style={{ marginLeft: 'auto' }}>
            <IconClose size={18} />
          </button>
        </div>
        <input
          aria-label="제목"
          placeholder="제목"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            auto.later({ title: e.target.value });
          }}
          style={{ border: 0, outline: 'none', padding: 0, background: 'none', color: 'var(--text)', fontSize: 22, fontWeight: 700, fontFamily: 'inherit' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '20px 20px 40px' }}>
        <Section title="내용">
          {fields.map(([k, v], i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input className="input" aria-label="항목 이름" placeholder="항목" value={k} onChange={(e) => setFieldsSave(fields.map((f, x) => (x === i ? [e.target.value, f[1]] : f)))} style={{ width: 120, flex: 'none' }} />
              <input className="input" aria-label="항목 내용" placeholder="내용" value={v} onChange={(e) => setFieldsSave(fields.map((f, x) => (x === i ? [f[0], e.target.value] : f)))} style={{ flex: 1, minWidth: 0 }} />
              <button type="button" className="icon-btn" aria-label="항목 빼기" title="항목 빼기" onClick={() => setFieldsSave(fields.filter((_, x) => x !== i))}>
                ×
              </button>
            </div>
          ))}
          {!fields.length && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>계정, 요금, 콘솔 주소처럼 남길 항목을 더해요</span>}
          <button type="button" className="link" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setFieldsSave([...fields, ['', '']])}>
            + 항목 더하기
          </button>
        </Section>

        <Section title={`첨부 파일${doc.files.length ? ` ${doc.files.length}` : ''}`}>
          <DocFiles doc={doc} />
        </Section>

        <Section title="키·비밀번호">
          <Segmented
            label="키 보관 방식"
            value={doc.secretMode}
            onChange={(v) => void setMode.run(v)}
            options={[
              ['value', '값 저장'],
              ['ref', '위치만 적기'],
              ['none', '없음'],
            ]}
          />
          {doc.secretMode === 'value' && (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {revealed === null ? (
                  <span className="mono" style={{ flex: 1, minWidth: 0, minHeight: 40, display: 'flex', alignItems: 'center', padding: '0 12px', borderRadius: 8, background: 'var(--chip)', fontSize: 13, color: doc.hasValue ? 'var(--text)' : 'var(--text-3)' }}>
                    {doc.hasValue ? `••••••••••••${doc.secretLast4 ?? ''}` : '아직 값이 없어요 · 보기를 눌러 넣으세요'}
                  </span>
                ) : (
                  <input autoFocus className="input mono" aria-label="키 값" placeholder="키 값을 붙여 넣으세요" value={revealed} onChange={(e) => editSecret(e.target.value)} style={{ flex: 1, minWidth: 0, fontSize: 13 }} />
                )}
                <button type="button" className="btn btn-sm" disabled={reveal.busy} onClick={() => void reveal.run()}>
                  {revealed === null ? '보기' : '숨기기'}
                </button>
                <button type="button" className="btn btn-sm" disabled={copy.busy || (!doc.hasValue && !revealed)} onClick={() => void copy.run()}>
                  복사
                </button>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Hub에 암호화해 저장돼요 · Hub는 127.0.0.1에서 토큰으로만 열려요 · Claude에게는 값을 넘기지 않아요</span>
            </>
          )}
          {doc.secretMode === 'ref' && (
            <>
              <input
                className="input mono"
                aria-label="위치"
                placeholder="1Password 항목, .env 경로, 콘솔 주소"
                value={ref}
                onChange={(e) => {
                  setRef(e.target.value);
                  auto.later({ secretRef: e.target.value });
                }}
                style={{ fontSize: 13 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>값은 Hub에 남기지 않고 어디 있는지만 적어요</span>
            </>
          )}
          {doc.secretMode === 'none' && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>키나 비밀번호가 없는 문서예요</span>}
        </Section>

        <Section title="만료·갱신">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Select<MyDocRenew> label="종류" value={doc.renewLabel} onChange={(r) => auto.now({ renewLabel: r })} menuWidth={120} options={(['만료', '갱신', '결제'] as const).map((r) => ({ value: r, label: r }))} style={{ minHeight: 40 }} />
            <input type="date" className="input mono" aria-label="날짜" value={doc.expiresOn ?? ''} onChange={(e) => auto.now({ expiresOn: e.target.value || null })} />
            {doc.expiresOn && (
              <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => auto.now({ expiresOn: null })}>
                날짜 지우기
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: off !== null && off <= ALERT_DAYS ? 'var(--attn)' : 'var(--text-3)' }}>{expiryHint}</span>
        </Section>

        <Section title="메모">
          <textarea
            className="input"
            aria-label="메모"
            rows={4}
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value);
              auto.later({ memo: e.target.value });
            }}
            style={{ resize: 'vertical', padding: '10px 12px', lineHeight: 1.6 }}
          />
        </Section>

        <button type="button" className="btn" disabled={remove.busy} onClick={() => void remove.run()} style={{ alignSelf: 'flex-start', color: 'var(--risk)' }}>
          문서 지우기
        </button>
      </div>
    </aside>
  );
}

const MB = 1024 * 1024;

/**
 * 문서 서랍의 첨부 파일: 끌어 놓거나 골라서 올리고(여러 개는 차례로), PDF·md·텍스트·그림은 눌러서 바로 본다.
 * 그 밖의 파일은 이름을 누르면 내려받는다.
 */
function DocFiles({ doc }: { doc: MyDocDto }) {
  const ui = useUi();
  const mx = useMineApi();
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
    const ok = picked.filter((f) => f.size > 0 && f.size <= MAX_FILE_MB * MB);
    const big = picked.filter((f) => f.size > MAX_FILE_MB * MB);
    if (big.length) ui.toast(`${MAX_FILE_MB}MB를 넘어 올리지 않았어요: ${big.map((f) => f.name).join(', ')}`, { error: true });
    else if (ok.length < picked.length) ui.toast('빈 파일과 폴더는 건너뛰었어요', { error: true });
    if (!ok.length) return;
    let sent = 0;
    setBusy({ done: 0, total: ok.length });
    for (const f of ok) {
      try {
        await mx.uploadFile(doc.id, f);
        sent++;
      } catch (e) {
        ui.fail(e);
      }
      setBusy((b) => b && { ...b, done: b.done + 1 });
    }
    setBusy(null);
    if (sent) ui.toast(`파일 ${sent}개를 붙였어요`);
  };
  const remove = useAction(async (f: MyDocFileDto) => {
    if (!(await ui.confirm({ title: '이 파일을 지울까요?', body: f.name, label: '지우기' }))) return;
    await mx.deleteFile(f.id);
    ui.toast('파일을 지웠어요');
  });

  return (
    <>
      {doc.files.map((f) => (
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
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>PDF·md·텍스트·그림은 눌러서 바로 봐요 · 한 파일 {MAX_FILE_MB}MB까지 · Hub 폴더(~/.hub/files)에 그대로 저장되고 Claude에게는 넘기지 않아요</span>
      {viewing !== null && <FileViewer files={doc.files} id={viewing} onPick={setViewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** 종류 꼬리표 색: PDF는 붉게, md는 파랗게, 나머지는 회색 */
const TAG_TONE: Partial<Record<MyDocFileDto['kind'], [string, string]>> = { pdf: ['var(--risk-bg)', 'var(--risk)'], md: ['var(--accent-bg)', 'var(--accent-ink)'] };

function FileKindTag({ f }: { f: MyDocFileDto }) {
  const [bg, fg] = TAG_TONE[f.kind] ?? ['var(--chip)', 'var(--text-2)'];
  return (
    <span className="mono" style={{ flex: 'none', minWidth: 40, padding: '2px 6px', borderRadius: 6, background: bg, color: fg, fontSize: 10, fontWeight: 700, textAlign: 'center' }}>
      {FILE_KIND[f.kind]}
    </span>
  );
}

function IconDownload() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

/**
 * 첨부 보기 창: PDF는 브라우저 PDF 보기로, md는 렌더링해서, 텍스트는 글자 그대로, 그림은 화면에 맞춰 보여 준다.
 * 볼 수 있는 파일이 여럿이면 ← →로 넘긴다. Esc는 이 창만 닫는다(서랍은 열린 대화창이 있으면 Esc를 넘긴다).
 * @param files 문서의 첨부 목록
 * @param id 지금 볼 파일
 */
function FileViewer({ files, id, onPick, onClose }: { files: MyDocFileDto[]; id: number; onPick(id: number): void; onClose(): void }) {
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

/** 대시보드 등 다른 화면에서 쓰는 문서 이름 찾기 */
export function useDocTitles(): Map<number, string> {
  const mine = useMine();
  return useMemo(() => new Map((mine.data?.docs ?? []).map((d) => [d.id, d.title || '제목 없음'])), [mine.data]);
}
