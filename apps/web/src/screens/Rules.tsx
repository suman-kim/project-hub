import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RuleDto } from '@hub/shared';
import { api } from '../api/client';
import { useAction } from '../api/mutations';
import { useApps } from '../api/queries';
import { Segmented } from '../components/forms';
import { ErrorBox, Skeleton, useUi } from '../components/ui';
import { tildify } from '../lib/paths';
import { readPref, writePref } from '../lib/prefs';
import { ClaudeMdView } from './ClaudeMd';

interface RulesResponse {
  file: string;
  rules: RuleDto[];
}
interface Item {
  app: string | null;
  body: string;
}

const NOTICE = '<!-- Hub가 이 파일을 써 준다. 고칠 때는 Hub 규칙 화면(PUT /api/rules)에서 고친다. 여기서 직접 고치면 다음 저장 때 덮어쓴다. -->';

/** 서버의 renderRulesFile과 같은 모양으로 미리 보기를 만든다 */
function render(items: Item[], names: Map<string, string>): string[] {
  const numbered = (bodies: string[]) =>
    bodies.flatMap((body, i) => {
      const [first, ...rest] = body.trim().split('\n');
      const pad = ' '.repeat(`${i + 1}. `.length);
      return [`${i + 1}. ${first}`, ...rest.map((l) => `${pad}${l}`)];
    });
  const lines = ['# 작업 규칙', '', NOTICE, ''];
  const global = items.filter((r) => !r.app).map((r) => r.body);
  lines.push(...(global.length ? numbered(global) : ['(전역 규칙 없음)']));
  for (const code of [...new Set(items.filter((r) => r.app).map((r) => r.app!))]) {
    lines.push('', `## ${names.get(code) ?? code} (${code})에서만`, '');
    lines.push(...numbered(items.filter((r) => r.app === code).map((r) => r.body)));
  }
  return lines;
}

type RulesView = 'hub' | 'claude';
const VIEWS = ['hub', 'claude'] as const;

/** 규칙 화면: Hub가 써 주는 hub-rules.md(목록으로 고침)와 CLAUDE.md(파일 그대로 고침) */
export function Rules() {
  const [view, setViewState] = useState<RulesView>(() => readPref<RulesView>('hub.rulesView', 'hub', VIEWS));
  const setView = (v: RulesView) => {
    writePref('hub.rulesView', v);
    setViewState(v);
  };
  const switcher = (
    <Segmented
      label="규칙 파일"
      value={view}
      onChange={setView}
      options={[
        ['hub', 'Hub 규칙 · hub-rules.md'],
        ['claude', 'CLAUDE.md'],
      ]}
    />
  );
  return view === 'claude' ? <ClaudeMdView switcher={switcher} /> : <HubRules switcher={switcher} />;
}

function HubRules({ switcher }: { switcher: ReactNode }) {
  const ui = useUi();
  const qc = useQueryClient();
  const apps = useApps();
  const data = useQuery({ queryKey: ['rules'], queryFn: () => api.get<RulesResponse>('/api/rules') });
  const saved = useMemo<Item[]>(() => [...(data.data?.rules ?? [])].sort((a, b) => a.position - b.position).map((r) => ({ app: r.appCode, body: r.body })), [data.data]);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => setItems(saved), [saved]);
  const [scope, setScope] = useState<string>('global');
  const [edit, setEdit] = useState<{ i: number; text: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const names = new Map((apps.data ?? []).map((a) => [a.code, a.name]));
  const dirty = JSON.stringify(items) !== JSON.stringify(saved);

  const inScope = (r: Item) => (scope === 'global' ? !r.app : r.app === scope);
  const rows = items.map((r, i) => ({ r, i })).filter(({ r }) => inScope(r));
  const move = (pos: number, d: -1 | 1) => {
    const a = rows[pos].i;
    const b = rows[pos + d]?.i;
    if (b === undefined) return;
    const next = [...items];
    [next[a], next[b]] = [next[b], next[a]];
    setItems(next);
  };
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    setItems([...items, { app: scope === 'global' ? null : scope, body: v }]);
    setDraft('');
  };
  const finishEdit = () => {
    if (!edit) return;
    const v = edit.text.trim();
    setItems(v ? items.map((r, i) => (i === edit.i ? { ...r, body: v } : r)) : items.filter((_, i) => i !== edit.i));
    setEdit(null);
  };

  const save = useAction(async () => {
    if (!(await ui.confirm({ title: '규칙 파일을 다시 쓸까요?', body: `${tildify(data.data?.file)}을 지금 목록으로 덮어써요. 새 세션부터 적용돼요.`, label: '파일에 저장', danger: false }))) return;
    const r = await api.put<RulesResponse>('/api/rules', { rules: items.map((x) => ({ app: x.app, body: x.body })) });
    qc.setQueryData(['rules'], r);
    setSavedAt(new Date());
  });

  const before = render(saved, names);
  const after = render(items, names);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((l) => !beforeSet.has(l) && l.trim()).length;
  const removed = before.filter((l) => !afterSet.has(l) && l.trim());

  const scopes: Array<[string, string]> = [['global', '전역'], ...(apps.data ?? []).map((a) => [a.code, a.name] as [string, string])];
  const scopeName = scope === 'global' ? '전역 규칙' : `${names.get(scope) ?? scope}에서만`;

  if (data.isLoading) return <Skeleton rows={6} height={44} />;
  if (data.error) return <ErrorBox error={data.error} onRetry={() => void data.refetch()} />;

  return (
    <div data-screen-label="규칙" className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <span className="page-sub">
            Claude Code가 세션을 시작할 때 읽어요 · <span className="mono">{tildify(data.data?.file)}</span>
          </span>
          <h1 className="page-title">규칙</h1>
        </div>
        <div className="page-actions">
          {dirty && (
            <button type="button" className="btn" onClick={() => setItems(saved)}>
              되돌리기
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!dirty || save.busy} onClick={() => void save.run()}>
            파일에 저장
          </button>
        </div>
      </div>
      {switcher}
      {savedAt && !dirty && (
        <div style={{ display: 'flex', gap: 10, padding: '14px 16px', borderRadius: 10, background: 'var(--done-bg)', color: 'var(--done)', fontSize: 14, lineHeight: 1.55 }}>
          <span aria-hidden="true">✓</span>
          <span>
            <strong style={{ fontWeight: 600 }}>{tildify(data.data?.file)}에 저장했어요</strong>
            <br />
            <span style={{ color: 'var(--text-2)' }}>새 세션부터 적용돼요 · 이미 열린 세션은 다시 시작해야 읽어요</span>
          </span>
        </div>
      )}
      <div role="group" aria-label="적용 범위" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {scopes.map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={scope === k} onClick={() => (finishEdit(), setScope(k))}>
            {label}
            <span className="chip-count">{items.filter((r) => (k === 'global' ? !r.app : r.app === k)).length}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '3 1 460px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '16px 20px' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{scopeName}</h2>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{scope === 'global' ? '모든 앱의 세션이 읽어요' : '이 앱 폴더의 세션만 읽어요'} · 위에 있는 규칙부터 읽어요</span>
          </div>
          {rows.map(({ r, i }, pos) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '6px 12px 6px 20px', borderTop: '1px solid var(--line-soft)' }}>
              <span className="mono" style={{ width: 20, flex: 'none', fontSize: 12, color: 'var(--text-3)' }}>
                {pos + 1}
              </span>
              {edit?.i === i ? (
                <input
                  autoFocus
                  className="input"
                  aria-label="규칙 고치기"
                  style={{ flex: 1, minHeight: 40, padding: '0 12px' }}
                  value={edit.text}
                  onChange={(e) => setEdit({ i, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) finishEdit();
                    if (e.key === 'Escape') setEdit(null);
                  }}
                  onBlur={finishEdit}
                />
              ) : (
                <button type="button" title="눌러서 고치기" onClick={() => setEdit({ i, text: r.body })} style={{ flex: 1, minWidth: 0, padding: '8px 0', border: 0, background: 'none', color: 'var(--text)', fontSize: 14, lineHeight: 1.55, textAlign: 'left', cursor: 'text', whiteSpace: 'pre-wrap' }}>
                  {r.body}
                </button>
              )}
              <div style={{ display: 'flex', flex: 'none' }}>
                <button type="button" className="icon-btn" aria-label="위로" disabled={pos === 0} style={{ opacity: pos === 0 ? 0.3 : 1 }} onClick={() => move(pos, -1)}>
                  ↑
                </button>
                <button type="button" className="icon-btn" aria-label="아래로" disabled={pos === rows.length - 1} style={{ opacity: pos === rows.length - 1 ? 0.3 : 1 }} onClick={() => move(pos, 1)}>
                  ↓
                </button>
                <button type="button" className="icon-btn" aria-label="지우기" onClick={() => setItems(items.filter((_, x) => x !== i))}>
                  ×
                </button>
              </div>
            </div>
          ))}
          {!rows.length && <div className="card-empty">아직 규칙이 없어요</div>}
          <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--line-soft)' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              aria-label="새 규칙"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
              }}
              placeholder="새 규칙 · Enter로 추가"
            />
            <button type="button" className="btn" disabled={!draft.trim()} onClick={add}>
              추가
            </button>
          </div>
        </section>
        <section aria-labelledby="rules-preview" style={{ flex: '2 1 340px', minWidth: 0, background: '#14171C', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', padding: '12px 18px', borderBottom: '1px solid #2A2F38' }}>
            <h2 id="rules-preview" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#F2F3F5' }}>
              저장하면 써질 내용
            </h2>
            <span className="mono" style={{ fontSize: 12, color: '#A8ADB8' }}>
              hub-rules.md
            </span>
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: dirty ? '#F2C46D' : '#7D8391' }}>
              {dirty ? `+${added} −${removed.length}` : '바뀐 것 없음'}
            </span>
          </div>
          <div style={{ maxHeight: 480, overflow: 'auto', padding: '12px 0', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7 }}>
            {after.map((t, i) => {
              const isNew = dirty && !beforeSet.has(t) && t.trim();
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', padding: '0 16px 0 0', background: isNew ? 'rgba(125,211,168,0.10)' : 'transparent' }}>
                  <span style={{ textAlign: 'center', color: '#7DD3A8' }}>{isNew ? '+' : ''}</span>
                  <span style={{ color: t.startsWith('#') ? '#F2F3F5' : t.startsWith('<!--') ? '#7D8391' : '#C9CDD6', fontWeight: t.startsWith('#') ? 600 : 400, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t}</span>
                </div>
              );
            })}
            {dirty &&
              removed.map((t, i) => (
                <div key={`r${i}`} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', padding: '0 16px 0 0', background: 'rgba(255,155,143,0.10)' }}>
                  <span style={{ textAlign: 'center', color: '#FF9B8F' }}>−</span>
                  <span style={{ color: '#FF9B8F', textDecoration: 'line-through', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t}</span>
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
