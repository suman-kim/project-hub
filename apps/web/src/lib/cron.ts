/**
 * 자동 생성 주기 선택기 ↔ cron 5필드. 서버는 cron을 저장하고 Asia/Seoul로 돌린다.
 * 선택기로 나타낼 수 없는 cron(분이 0이 아니거나 날짜를 쓰는 것)은 custom으로 두고 그대로 보여 준다.
 */

export type SchedMode = 'off' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface Sched {
  mode: SchedMode;
  hour: number;
  /** cron 요일 번호 (0=일 … 6=토) */
  days: number[];
  /** mode가 custom일 때의 cron 원문 */
  raw: string;
}

/** 화면 순서: 월화수목금토일 */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAME: Record<number, string> = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };

export const SCHED_MODES: Array<[Exclude<SchedMode, 'custom'>, string]> = [
  ['off', '끄기'],
  ['daily', '매일'],
  ['weekdays', '평일'],
  ['weekly', '매주'],
];

const pad = (n: number) => String(n).padStart(2, '0');

function parseDays(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) out.add(d % 7);
    } else if (/^\d$/.test(part)) out.add(Number(part) % 7);
    else return null;
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(cron: string | null | undefined): Sched {
  if (!cron) return { mode: 'off', hour: 2, days: [], raw: '' };
  const f = cron.trim().split(/\s+/);
  const custom: Sched = { mode: 'custom', hour: 2, days: [], raw: cron.trim() };
  if (f.length !== 5 || f[0] !== '0' || !/^\d{1,2}$/.test(f[1]) || f[2] !== '*' || f[3] !== '*') return custom;
  const hour = Number(f[1]);
  if (hour > 23) return custom;
  if (f[4] === '*') return { mode: 'daily', hour, days: [], raw: '' };
  const days = parseDays(f[4]);
  if (!days) return custom;
  if (days.join(',') === '1,2,3,4,5') return { mode: 'weekdays', hour, days: [], raw: '' };
  return { mode: 'weekly', hour, days, raw: '' };
}

export function toCron(s: Sched): string | null {
  switch (s.mode) {
    case 'off':
      return null;
    case 'custom':
      return s.raw.trim() || null;
    case 'daily':
      return `0 ${s.hour} * * *`;
    case 'weekdays':
      return `0 ${s.hour} * * 1-5`;
    case 'weekly':
      return `0 ${s.hour} * * ${[...s.days].sort((a, b) => a - b).join(',')}`;
  }
}

/** 화면에 보여 줄 이름: 매일 02:00 · 매주 월·목 02:00 · 자동 생성 꺼짐 */
export function schedLabel(s: Sched): string {
  if (s.mode === 'off') return '자동 생성 꺼짐';
  if (s.mode === 'custom') return `cron ${s.raw}`;
  const when = s.mode === 'daily' ? '매일' : s.mode === 'weekdays' ? '평일' : `매주 ${DAY_ORDER.filter((d) => s.days.includes(d)).map((d) => DAY_NAME[d]).join('·') || '?'}`;
  return `${when} ${pad(s.hour)}:00`;
}

export function schedError(s: Sched): string | null {
  if (s.mode === 'weekly' && !s.days.length) return '요일을 하나 이상 고르세요';
  if (s.mode === 'custom' && !/^\S+(\s+\S+){4}$/.test(s.raw.trim())) return 'cron은 "분 시 일 월 요일" 5필드예요';
  return null;
}

/** 다음 생성 시각. 끄거나 직접 넣은 cron이면 null */
export function nextAt(s: Sched, now = new Date()): Date | null {
  if (s.mode === 'off' || s.mode === 'custom') return null;
  const ok = (dow: number) => s.mode === 'daily' || (s.mode === 'weekdays' && dow >= 1 && dow <= 5) || (s.mode === 'weekly' && s.days.includes(dow));
  for (let k = 0; k < 8; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, s.hour, 0);
    if (d > now && ok(d.getDay())) return d;
  }
  return null;
}

/** 오늘 02:00 · 내일 02:00 · 목요일 02:00 */
export function dayHour(d: Date, now = new Date()): string {
  const k = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const day = k === 0 ? '오늘' : k === 1 ? '내일' : `${DAY_NAME[d.getDay()]}요일`;
  return `${day} ${pad(d.getHours())}:00`;
}

/** 다음 생성 · 오늘 02:00 · 내일 02:00 · 목요일 02:00 */
export function nextLabel(s: Sched, now = new Date()): string {
  if (s.mode === 'off') return '자동 생성 꺼짐';
  if (s.mode === 'custom') return '직접 넣은 cron대로 돌아요';
  const d = nextAt(s, now);
  return d ? `다음 생성 · ${dayHour(d, now)}` : '요일을 고르세요';
}
