import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatItem } from '@hub/shared';
import { dayLabel, hm } from '../lib/format';
import { Markdown } from '../lib/md';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
type Block = { kind: 'one'; item: Exclude<ChatItem, ToolItem> } | { kind: 'tools'; id: string; items: ToolItem[] };

/** 이어진 도구 사용은 한 묶음으로 접는다 */
function blocks(items: ChatItem[]): Block[] {
  const out: Block[] = [];
  for (const i of items) {
    const prev = out[out.length - 1];
    if (i.kind === 'tool') {
      if (prev?.kind === 'tools') prev.items.push(i);
      else out.push({ kind: 'tools', id: i.id, items: [i] });
    } else out.push({ kind: 'one', item: i });
  }
  return out;
}

const dayOf = (at: string | null) => (at ? new Date(at).toDateString() : null);

/**
 * 대화 화면. 세션 대화 보기와 실행 상세가 같이 쓴다.
 * 내 메시지는 오른쪽 말풍선, Claude 답변은 왼쪽 말풍선, Hub가 보낸 지시는 접히는 카드, 도구 사용은 한 줄 묶음, 안내는 가운데 줄이다.
 * 아래쪽을 보고 있으면 새 줄이 올 때 따라 내려간다.
 */
export function ChatView({ items, working, empty, height, onCancel }: { items: ChatItem[]; working?: boolean; empty: ReactNode; height: string; onCancel?: (itemId: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const last = items[items.length - 1];
  const sig = `${items.length}:${last?.id}:${last?.kind === 'tool' ? last.result?.length : ''}`;

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [sig, follow, working]);

  let prevDay: string | null = null;
  return (
    <div style={{ position: 'relative', height, minHeight: 0 }}>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (atBottom !== follow) setFollow(atBottom);
        }}
        style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}
      >
        {!items.length && <div style={{ margin: 'auto', fontSize: 13, color: 'var(--text-3)', textAlign: 'center' }}>{empty}</div>}
        {blocks(items).map((b) => {
          const at = b.kind === 'one' ? b.item.at : b.items[0].at;
          const day = dayOf(at);
          const divider = day && day !== prevDay ? dayLabel(at!) : null;
          if (day) prevDay = day;
          return (
            <div key={b.kind === 'one' ? b.item.id : `t:${b.id}`} style={{ display: 'contents' }}>
              {divider && <Divider text={divider} />}
              {b.kind === 'tools' ? <ToolGroup items={b.items} /> : <One item={b.item} onCancel={onCancel} />}
            </div>
          );
        })}
        {working && (
          <div style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 12, color: 'var(--text-3)' }}>
            <span aria-hidden="true" className="dot dot-6" style={{ background: 'var(--prog-dot)', animation: 'hubPulse 1.6s ease-in-out infinite' }} />
            Claude가 일하는 중
          </div>
        )}
      </div>
      {!follow && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          style={{ position: 'absolute', right: 16, bottom: 14, minHeight: 36, padding: '0 14px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, fontWeight: 600, boxShadow: '0 4px 12px var(--shadow)', cursor: 'pointer' }}
        >
          ↓ 최신으로
        </button>
      )}
    </div>
  );
}

function Divider({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-3)', margin: '4px 0' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      {text}
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}

function Meta({ who, at, right }: { who: string; at: string | null; right?: boolean }) {
  return (
    <span style={{ fontSize: 11, color: 'var(--text-3)', textAlign: right ? 'right' : 'left', padding: '0 4px' }}>
      {who}
      {at ? ` · ${hm(at)}` : ''}
    </span>
  );
}

const HUB_FOLD_LINES = 6;

function One({ item, onCancel }: { item: Exclude<ChatItem, ToolItem>; onCancel?: (itemId: string) => void }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case 'user':
      if (item.from === 'hub') {
        const lines = item.text.split('\n');
        const long = lines.length > HUB_FOLD_LINES;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Meta who="Hub 지시" at={item.at} />
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px dashed var(--line-strong)', fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {long && !open ? lines.slice(0, HUB_FOLD_LINES).join('\n') : item.text}
              {long && (
                <button type="button" className="link" onClick={() => setOpen(!open)} style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                  {open ? '접기' : `펼치기 · ${lines.length}줄`}
                </button>
              )}
            </div>
          </div>
        );
      }
      return (
        <div style={{ alignSelf: 'flex-end', maxWidth: 'min(80%, 640px)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Meta who={item.delivery ? `나 · Hub에서 보냄 · ${item.delivery === 'pending' ? '전달 대기' : '전달됨'}` : '나'} at={item.at} right />
          <div style={{ padding: '10px 14px', borderRadius: '16px 16px 4px 16px', background: 'var(--accent)', color: '#FFFFFF', opacity: item.delivery === 'pending' ? 0.6 : 1, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {item.images > 0 && <span style={{ display: 'block', fontSize: 12, opacity: 0.85, marginBottom: item.text ? 4 : 0 }}>이미지 {item.images}장</span>}
            {item.text}
          </div>
          {item.delivery === 'pending' && onCancel && (
            <button type="button" className="link" onClick={() => onCancel(item.id)} style={{ alignSelf: 'flex-end', fontSize: 11 }}>
              보내기 취소
            </button>
          )}
        </div>
      );
    case 'assistant':
      return (
        <div style={{ alignSelf: 'flex-start', maxWidth: 'min(88%, 760px)', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <Meta who="Claude" at={item.at} />
          <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: 'var(--surface)', border: '1px solid var(--line)', minWidth: 0 }}>
            <Markdown src={item.text} />
          </div>
        </div>
      );
    case 'note':
      return (
        <div style={{ alignSelf: 'center', maxWidth: '90%', padding: '4px 12px', borderRadius: 999, background: item.tone === 'risk' ? 'var(--risk-bg)' : item.tone === 'attn' ? 'var(--attn-bg)' : item.tone === 'done' ? 'var(--done-bg)' : 'var(--chip)', color: item.tone === 'risk' ? 'var(--risk)' : item.tone === 'attn' ? 'var(--attn)' : item.tone === 'done' ? 'var(--done)' : 'var(--text-3)', fontSize: 12, textAlign: 'center', overflowWrap: 'anywhere' }}>
          {item.text}
          {item.at ? <span style={{ opacity: 0.7 }}> · {hm(item.at)}</span> : null}
        </div>
      );
  }
}

/** 이어진 도구 사용 묶음. 접힌 상태에서는 도구 이름만, 펼치면 도구마다 입력 요약과 결과 */
function ToolGroup({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const names = [...new Set(items.map((t) => (t.name.startsWith('mcp__') ? t.name.split('__').slice(1).join(' ') : t.name)))];
  const errors = items.filter((t) => t.error).length;
  const running = items.some((t) => t.result === null);
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%', minHeight: 32, padding: '4px 12px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600 }}>도구 {items.length}번</span>
        <span className="ellipsis mono" style={{ color: 'var(--text-3)' }}>
          {names.slice(0, 4).join(', ')}
          {names.length > 4 ? ` 외 ${names.length - 4}` : ''}
        </span>
        {errors > 0 && <span style={{ flex: 'none', color: 'var(--risk)', fontWeight: 600 }}>오류 {errors}</span>}
        {running && <span style={{ flex: 'none', color: 'var(--prog)' }}>실행 중</span>}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line-soft)', minWidth: 0 }}>
          {items.map((t) => (
            <ToolRow key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ t }: { t: ToolItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => t.result && setOpen(!open)}
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, padding: '2px 0', border: 0, background: 'none', color: 'var(--text)', cursor: t.result ? 'pointer' : 'default', textAlign: 'left', fontSize: 12 }}
      >
        <span className="mono" style={{ flex: 'none', fontWeight: 600, color: t.error ? 'var(--risk)' : 'var(--text-2)' }}>
          {t.name}
        </span>
        <span className="mono ellipsis" style={{ color: 'var(--text-3)' }}>
          {t.summary}
        </span>
        <span style={{ flex: 'none', marginLeft: 'auto', color: t.error ? 'var(--risk)' : 'var(--text-3)' }}>{t.result === null ? '…' : t.error ? '오류' : open ? '결과 접기' : '결과'}</span>
      </button>
      {open && t.result && (
        <pre className="mono" style={{ margin: 0, padding: '8px 10px', borderRadius: 6, background: 'var(--chip)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto', color: t.error ? 'var(--risk)' : 'var(--text-2)' }}>
          {t.result}
        </pre>
      )}
    </div>
  );
}
