import { Select } from './Select';
import type { CSSProperties, ReactNode } from 'react';
import { DAY_NAME, DAY_ORDER, nextLabel, SCHED_MODES, schedError, toCron, type Sched } from '../lib/cron';
import { usePrefs } from '../lib/prefs';

/** 회색 판 위의 버튼 묶음 (디자인의 seg) */
export function Segmented<T extends string>({ options, value, onChange, label, style }: { options: Array<[T, string]>; value: T; onChange(v: T): void; label: string; style?: CSSProperties }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', padding: 3, gap: 2, borderRadius: 9, background: 'var(--chip)', alignSelf: 'flex-start', ...style }}>
      {options.map(([k, text]) => {
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(k)}
            style={{ minHeight: 38, padding: '0 14px', border: 0, borderRadius: 7, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--text)' : 'var(--text-3)', boxShadow: on ? '0 1px 2px var(--shadow)' : 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{ position: 'relative', flex: 'none', width: 44, height: 26, padding: 0, border: 0, borderRadius: 13, background: checked ? 'var(--accent)' : 'var(--line-strong)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      <span style={{ position: 'absolute', top: 3, left: checked ? 20 : 3, width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left .12s' }} />
    </button>
  );
}

/** 둥근 토글 칩 (요일, 도구) */
export function ToggleChip({ on, onClick, children, round, mono }: { on: boolean; onClick(): void; children: ReactNode; round?: boolean; mono?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        ...(round ? { width: 44, height: 44 } : { minHeight: 40, padding: '0 14px' }),
        borderRadius: 999,
        border: `1px solid ${on ? 'var(--ink)' : 'var(--line-strong)'}`,
        background: on ? 'var(--ink)' : 'var(--surface)',
        color: on ? 'var(--on-ink)' : 'var(--text)',
        fontFamily: mono ? 'var(--mono)' : 'inherit',
        fontSize: mono ? 12 : 14,
        fontWeight: mono ? 500 : 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 자동 생성 주기: 끄기·매일·평일·매주 + 시각 + 요일. 선택기로 못 나타내는 cron은 직접 고친다 */
export function ScheduleEditor({ value, onChange }: { value: Sched; onChange(s: Sched): void }) {
  const err = schedError(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Segmented
          label="주기"
          options={value.mode === 'custom' ? [...SCHED_MODES, ['custom', '직접 입력']] : SCHED_MODES}
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode, days: mode === 'weekly' && !value.days.length ? [1] : value.days })}
        />
        {value.mode !== 'off' && value.mode !== 'custom' && (
          <Select label="시각" mono size="sm" value={String(value.hour)} onChange={(h) => onChange({ ...value, hour: Number(h) })} menuWidth={120} searchAfter={99} options={HOURS.map((h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))} />
        )}
      </div>
      {value.mode === 'weekly' && (
        <div role="group" aria-label="요일" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DAY_ORDER.map((d) => {
            const on = value.days.includes(d);
            return (
              <ToggleChip key={d} round on={on} onClick={() => onChange({ ...value, days: on ? value.days.filter((x) => x !== d) : [...value.days, d] })}>
                {DAY_NAME[d]}
              </ToggleChip>
            );
          })}
        </div>
      )}
      {value.mode === 'custom' && (
        <input className="input mono" aria-label="cron" value={value.raw} onChange={(e) => onChange({ ...value, raw: e.target.value })} placeholder="0 2 * * *" />
      )}
      {err && <span className="field-error">{err}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '10px 14px', borderRadius: 8, background: 'var(--bg)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-3)' }}>
          cron <span className="mono" style={{ color: 'var(--text)' }}>{toCron(value) ?? '—'}</span>
        </span>
        <span style={{ color: 'var(--text-2)' }}>{nextLabel(value)}</span>
      </div>
    </div>
  );
}

/** 바꾼 항목이 있으면 아래에 붙는 저장 막대 */
export function SaveBar({ count, error, busy, onRevert, onSave }: { count: number; error?: string | null; busy?: boolean; onRevert(): void; onSave(): void }) {
  const { m } = usePrefs();
  if (!count) return null;
  return (
    <div
      style={{ position: 'sticky', bottom: m ? 72 : 16, zIndex: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', padding: '12px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--accent)', boxShadow: '0 8px 24px var(--shadow)' }}
    >
      <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>바꾼 항목 {count}개 · 아직 저장하지 않았어요</span>
        {error && <span style={{ fontSize: 12, color: 'var(--risk)' }}>{error}</span>}
      </div>
      <button type="button" className="btn" onClick={onRevert} disabled={busy}>
        되돌리기
      </button>
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={!!error || busy} style={{ padding: '0 20px' }}>
        {busy ? '저장하는 중' : '저장'}
      </button>
    </div>
  );
}

/** 카드 모양 칸 (설정 화면의 section) */
export function Section({ title, sub, children, dirty, style, right }: { title: ReactNode; sub?: ReactNode; children: ReactNode; dirty?: boolean; style?: CSSProperties; right?: ReactNode }) {
  const { m } = usePrefs();
  return (
    <section className="card" style={{ borderColor: dirty ? 'var(--accent)' : undefined, padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 16, ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          {sub && <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>{sub}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, style }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; style?: CSSProperties }) {
  return (
    <label className="field" style={{ minWidth: 0, ...style }}>
      <span className="field-label">{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** 두 칸 이상을 나란히 (좁으면 한 줄씩) */
export function Grid({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 16 }}>{children}</div>;
}
