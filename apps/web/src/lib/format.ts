/** 시각과 기간 표시. 모두 브라우저 시간대(맥북, Asia/Seoul)로 보여 준다 */

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

const toDate = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** 오늘 0이면 오늘, -1이면 어제 */
const dayOffset = (d: Date, now = new Date()) => Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);

export function hm(v: string | Date): string {
  const d = toDate(v);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hms(v: string | Date): string {
  const d = toDate(v);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function md(v: string | Date): string {
  const d = toDate(v);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 오늘이면 09:12, 어제면 어제 09:12, 그 전이면 10/25 09:12 */
export function stamp(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = toDate(v);
  const k = dayOffset(d);
  return `${k === 0 ? '' : k === -1 ? '어제 ' : `${md(d)} `}${hm(d)}`;
}

/** 오늘 09:12 · 어제 09:12 · 10/25 09:12 */
export function when(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = toDate(v);
  const k = dayOffset(d);
  return `${k === 0 ? '오늘 ' : k === -1 ? '어제 ' : `${md(d)} `}${hm(d)}`;
}

/** 히스토리 묶음 이름: 오늘 · 어제 · 10월 25일 */
export function dayLabel(v: string | Date): string {
  const d = toDate(v);
  const k = dayOffset(d);
  if (k === 0) return '오늘';
  if (k === -1) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 10월 27일 화요일 */
export function longDate(d = new Date()): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`;
}

/** 초 → 12초 · 5분 · 2시간 3분 */
export function dur(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}시간 ${m % 60}분`;
  return `${Math.floor(h / 24)}일`;
}

/** 초 → 4:05 · 1:02:03 (실행 중 경과 시간) */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${pad(m)}` : m}:${pad(s % 60)}`;
}

export function since(v: string | Date | null | undefined, now = Date.now()): number {
  return v ? (now - toDate(v).getTime()) / 1000 : 0;
}

/** 방금 · 5분 전 · 3시간 전 · 2일 전 */
export function ago(v: string | Date | null | undefined, now = Date.now()): string {
  if (!v) return '';
  const s = since(v, now);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86_400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86_400)}일 전`;
}

export function money(n: number | null | undefined): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

/** YYYY-MM-DD (브라우저 시간대) */
export function isoDay(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 기한(YYYY-MM-DD)까지 남은 날. 지났으면 음수 */
export function dueOffset(due: string): number {
  const [y, m, d] = due.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(new Date())) / DAY_MS);
}

/** 11/1 · 3일 지남 · 오늘 · 내일 */
export function dueLabel(due: string | null): string {
  if (!due) return '기한 없음';
  const off = dueOffset(due);
  const [, m, d] = due.split('-').map(Number);
  return `${m}/${d}${off < 0 ? ` · ${-off}일 지남` : off === 0 ? ' · 오늘' : off === 1 ? ' · 내일' : ''}`;
}

/** 파일 크기: 812B · 34KB · 2.1MB */
export function fileSize(n: number): string {
  return n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${Math.round(n / 1024)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function percent(v: number | null | undefined): number {
  return Math.round((v ?? 0) * 100);
}
