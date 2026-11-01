import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { CostSummaryDto, MonthlyCostDto, UsageWindowDto } from '@hub/shared';
import { api } from '../api/client';
import { useApps, useUsage } from '../api/queries';
import { CodeBox, ErrorBox, Skeleton } from '../components/ui';
import { percent, money, stamp, isoDay } from '../lib/format';
import { RUN_KIND } from '../lib/labels';
import { usePrefs } from '../lib/prefs';
import type { RunKind } from '@hub/shared';

const KIND_DESC: Record<string, string> = { implement: 'task 구현', idea_gen: '기획 생성·수정', bootstrap: '새 앱 시작' };

function Meter({ label, w, limit }: { label: string; w: UsageWindowDto | null; limit: number }) {
  // 받은 뒤 초기화 시각이 지났으면 그 값은 이미 지난 창의 것이다.
  const expired = !!w?.resetsAt && new Date(w.resetsAt).getTime() < Date.now();
  const p = expired ? 0 : percent(w?.utilization);
  const hot = p >= limit;
  const reset = !w?.resetsAt ? '초기화 시각 모름' : expired ? `${stamp(w.resetsAt)}에 초기화됐어요 · 새 값은 다음 실행 때 받아요` : `${stamp(w.resetsAt)}에 초기화`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{label}</span>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: hot ? 'var(--attn)' : 'var(--text)' }}>{w && !expired ? `${p}%` : '–'}</span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--chip)' }}>
        <div style={{ width: `${Math.min(100, p)}%`, height: 10, borderRadius: 5, background: hot ? 'var(--attn-dot)' : 'var(--accent)' }} />
        <div title={`${limit}% 기준선`} style={{ position: 'absolute', left: `${limit}%`, top: -4, width: 2, height: 18, borderRadius: 1, background: 'var(--text-3)' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px', fontSize: 12 }}>
        <span style={{ color: 'var(--text-2)' }}>{reset}</span>
        <span style={{ color: hot ? 'var(--attn)' : 'var(--text-3)' }}>{w && !expired ? (hot ? '기준을 넘었어요' : `기준까지 ${limit - p}%`) : ''}</span>
      </div>
    </div>
  );
}

/** 구독 사용량과 API 환산 비용 */
export function Costs() {
  const navigate = useNavigate();
  const { m } = usePrefs();
  const apps = useApps();
  const usage = useUsage();
  const summary = useQuery({ queryKey: ['costs', 'summary'], queryFn: () => api.get<CostSummaryDto>('/api/costs') });
  const monthly = useQuery({ queryKey: ['costs', 'monthly'], queryFn: () => api.get<MonthlyCostDto[]>('/api/costs/monthly?limit=12') });
  const [day, setDay] = useState<string | null>(null);
  const appName = (code: string | null) => (code ? (apps.data?.find((a) => a.code === code)?.name ?? code) : '새 앱 기획 · 앱 없음');

  if (summary.isLoading) return <Skeleton rows={6} height={48} />;
  if (summary.error || !summary.data) return <ErrorBox error={summary.error} onRetry={() => void summary.refetch()} />;
  const s = summary.data;
  const [y, mo] = s.month.split('-').map(Number);
  const today = isoDay();
  const lastDay = s.month === today.slice(0, 7) ? Number(today.slice(8)) : new Date(y, mo, 0).getDate();
  const days = Array.from({ length: lastDay }, (_, i) => {
    const date = `${s.month}-${String(i + 1).padStart(2, '0')}`;
    const d = s.byDay.find((x) => x.date === date);
    return { date, n: i + 1, costUsd: d?.costUsd ?? 0, runs: d?.runs ?? 0 };
  });
  const maxDay = Math.max(0.01, ...days.map((d) => d.costUsd));
  const selDay = days.find((d) => d.date === (day ?? today)) ?? days[days.length - 1];
  const months = [...(monthly.data ?? [])].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  const maxMonth = Math.max(0.01, ...months.map((x) => x.costUsd));
  const prev = months.find((x) => x.month < s.month && x.month === months.filter((z) => z.month < s.month).pop()?.month);
  const appTotal = Math.max(0.01, ...s.byApp.map((a) => a.costUsd));
  const kindTotal = Math.max(0.01, ...s.byKind.map((k) => k.costUsd));
  const limit = percent(usage.data?.limit ?? 0.8);

  return (
    <div data-screen-label="비용" className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="page-sub">
          구독 사용량과 API 환산 비용 · {mo}월 1일–{lastDay}일
        </span>
        <h1 className="page-title">비용</h1>
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'var(--prog-bg)', color: 'var(--prog)', fontSize: 13, lineHeight: 1.6 }}>
        <span aria-hidden="true">ⓘ</span>
        <span>구독으로 실행해서 실제로 청구되는 금액이 아니에요. 같은 사용량을 API 요금으로 계산한 값이에요.</span>
      </div>
      <section className="card" style={{ padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 12px' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>구독 사용량</h2>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{usage.data?.at ? `${stamp(usage.data.at)}에 받은 값 · Hub가 claude를 실행할 때만 갱신돼요` : '아직 받은 값이 없어요 · Hub가 claude를 실행할 때 받아요'}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px 32px' }}>
          <Meter label="5시간 창" w={usage.data?.fiveHour ?? null} limit={limit} />
          <Meter label="7일 창" w={usage.data?.sevenDay ?? null} limit={limit} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>5시간·7일 중 하나라도 {limit}%를 넘으면 자동 기획 생성이 멈춰요{usage.data?.high ? ' · 지금 멈춰 있어요' : ''}</span>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${m ? 140 : 200}px, 1fr))`, gap: m ? 10 : 16 }}>
        {[
          ['이번 달 합계', money(s.costUsd), `run ${s.runs}개`],
          ['run당 평균', money(s.runs ? s.costUsd / s.runs : 0), '이번 달 끝난 run 기준'],
          ['지난달', prev ? money(prev.costUsd) : '–', prev ? `${prev.month.replace('-', '년 ')}월 · run ${prev.runs}개` : '기록이 없어요'],
        ].map(([label, n, sub]) => (
          <div key={label} className="card" style={{ padding: m ? '14px 16px' : '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{label}</span>
            <span style={{ fontSize: m ? 26 : 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{n}</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{sub}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section className="card" style={{ flex: '3 1 420px', padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>최근 12개월</h2>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(months.length, 1)}, minmax(0,1fr))`, gap: 6, alignItems: 'end', height: 180 }}>
            {months.map((x) => (
              <div key={x.month} title={`${x.month} · ${money(x.costUsd)} · run ${x.runs}개`} style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {x.month === s.month && (
                  <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
                    {money(x.costUsd)}
                  </span>
                )}
                <div style={{ width: '100%', maxWidth: 32, height: `${Math.max(2, (x.costUsd / maxMonth) * 100)}%`, borderRadius: '4px 4px 0 0', background: x.month === s.month ? 'var(--accent)' : 'var(--line-strong)' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(months.length, 1)}, minmax(0,1fr))`, gap: 6, marginTop: -8 }}>
            {months.map((x) => (
              <span key={x.month} style={{ textAlign: 'center', fontSize: 11, color: x.month === s.month ? 'var(--text)' : 'var(--text-3)', fontWeight: x.month === s.month ? 600 : 400, whiteSpace: 'nowrap' }}>
                {Number(x.month.slice(5))}월
              </span>
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>막대에 올리면 금액이 보여요</span>
        </section>
        <section className="card" style={{ flex: '2 1 300px', padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>이번 달 · 앱별</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {s.byApp.map((a) => (
              <div key={a.appCode ?? 'none'} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: '4px 10px', alignItems: 'center' }}>
                <CodeBox code={a.appCode ?? '새 앱'} small style={{ gridRow: 'span 2' }} />
                {a.appCode ? (
                  <button type="button" className="title-btn ellipsis" style={{ fontSize: 13 }} onClick={() => navigate(`/apps/${a.appCode}`)}>
                    <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>run {a.runs}개</span>
                  </button>
                ) : (
                  <span className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
                    {appName(null)} <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>· run {a.runs}개</span>
                  </span>
                )}
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                  {money(a.costUsd)}
                </span>
                <div style={{ gridColumn: 'span 2', height: 6, borderRadius: 3, background: 'var(--chip)' }}>
                  <div style={{ width: `${(a.costUsd / appTotal) * 100}%`, height: 6, borderRadius: 3, background: 'var(--accent)' }} />
                </div>
              </div>
            ))}
            {!s.byApp.length && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>이번 달에는 실행한 run이 없어요</span>}
          </div>
          <h2 style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 600 }}>이번 달 · 종류별</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {s.byKind.map((k) => (
              <div key={k.kind} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '4px 10px', alignItems: 'center' }}>
                <span style={{ fontSize: 13, minWidth: 0 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {k.kind}
                  </span>{' '}
                  <span style={{ color: 'var(--text-3)' }}>
                    {KIND_DESC[k.kind] ?? RUN_KIND[k.kind as RunKind] ?? ''} · run {k.runs}개
                  </span>
                </span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                  {money(k.costUsd)}
                </span>
                <div style={{ gridColumn: 'span 2', height: 6, borderRadius: 3, background: 'var(--chip)' }}>
                  <div style={{ width: `${(k.costUsd / kindTotal) * 100}%`, height: 6, borderRadius: 3, background: 'var(--check-dot)' }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="card" style={{ padding: m ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 12px' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>날짜별 · {mo}월</h2>
          {selDay && (
            <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-2)' }}>
              {mo}월 {selDay.n}일 · <span className="mono" style={{ fontWeight: 600, color: 'var(--text)' }}>{money(selDay.costUsd)}</span> · run {selDay.runs}개
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, gap: 3, alignItems: 'end', height: 140 }}>
          {days.map((d) => {
            const on = d.date === selDay?.date;
            const isToday = d.date === today;
            return (
              <button
                key={d.date}
                type="button"
                aria-pressed={on}
                aria-label={`${mo}월 ${d.n}일 ${money(d.costUsd)}`}
                title={`${mo}월 ${d.n}일 · ${money(d.costUsd)}`}
                onClick={() => setDay(d.date)}
                style={{ height: '100%', minWidth: 0, padding: 0, border: 0, background: 'none', display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}
              >
                <span style={{ display: 'block', width: '100%', height: `${Math.max(2, (d.costUsd / maxDay) * 100)}%`, borderRadius: '3px 3px 0 0', background: on ? 'var(--accent)' : isToday ? 'transparent' : 'var(--line-strong)', border: isToday && !on ? '1px dashed var(--text-3)' : 0 }} />
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, gap: 3, marginTop: -6 }}>
          {days.map((d) => (
            <span key={d.date} className="mono" style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
              {d.n === 1 || d.n % 5 === 0 ? d.n : ''}
            </span>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>막대를 누르면 그날 합계가 위에 나와요 · 점선은 오늘, 아직 집계 중 · 날짜는 {s.timezone} 기준</span>
      </section>
    </div>
  );
}
