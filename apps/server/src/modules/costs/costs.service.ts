import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CostSummaryDto, CostTotal, MonthlyCostDto } from '@hub/shared';
import { Repository } from 'typeorm';
import { HUB_TIMEZONE } from '../../config/hub-config';
import { Run } from '../runner/run.entity';

/** 집계 단위 행: 앱 × 종류 × 날짜 */
export interface CostRow {
  appCode: string | null;
  kind: string;
  date: string;
  costUsd: number;
  runs: number;
}

/**
 * run마다 시작 시각(없으면 만든 시각)을 Hub 시간대로 바꾸고 앱을 붙인다.
 * implement run은 task의 앱, idea_gen run은 result.idea.appId의 앱이다.
 */
const LOCAL_RUNS = `
  SELECT r.cost_usd, r.kind, a.code AS app_code,
         (COALESCE(r.started_at, r.created_at) AT TIME ZONE '${HUB_TIMEZONE}') AS local_ts
  FROM runs r
  LEFT JOIN tasks t ON t.id = r.task_id
  LEFT JOIN apps a ON a.id = COALESCE(t.app_id, (r.result->'idea'->>'appId')::int)`;

const round = (v: number) => Math.round(v * 10000) / 10000;

/** 지금 Hub 시간대의 YYYY-MM */
export function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: HUB_TIMEZONE, year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

function group<K extends string>(rows: CostRow[], key: (r: CostRow) => string, name: K): Array<CostTotal & Record<K, string>> {
  const totals = new Map<string, CostTotal>();
  for (const r of rows) {
    const t = totals.get(key(r)) ?? { costUsd: 0, runs: 0 };
    t.costUsd += r.costUsd;
    t.runs += r.runs;
    totals.set(key(r), t);
  }
  return [...totals].map(([k, t]) => ({ [name]: k, costUsd: round(t.costUsd), runs: t.runs }) as CostTotal & Record<K, string>);
}

/** 한 달치 집계 행을 합계, 앱별(비용 큰 순), 종류별, 날짜별로 묶는다. */
export function summarizeCosts(month: string, rows: CostRow[]): CostSummaryDto {
  const byCost = (a: CostTotal, b: CostTotal) => b.costUsd - a.costUsd;
  const byApp = group(rows, (r) => r.appCode ?? '', 'appCode')
    .map((g) => ({ ...g, appCode: g.appCode || null }))
    .sort(byCost);
  return {
    month,
    timezone: HUB_TIMEZONE,
    costUsd: round(rows.reduce((s, r) => s + r.costUsd, 0)),
    runs: rows.reduce((s, r) => s + r.runs, 0),
    byApp,
    byKind: group(rows, (r) => r.kind, 'kind').sort(byCost),
    byDay: group(rows, (r) => r.date, 'date').sort((a, b) => a.date.localeCompare(b.date)),
  };
}

@Injectable()
export class CostsService {
  constructor(@InjectRepository(Run) private readonly runs: Repository<Run>) {}

  /** month(YYYY-MM)에 시작한 run의 비용 */
  async summary(month: string): Promise<CostSummaryDto> {
    const rows: Array<{ app_code: string | null; kind: string; date: string; cost_usd: number; runs: number }> = await this.runs.query(
      `SELECT app_code, kind, to_char(local_ts, 'YYYY-MM-DD') AS date, SUM(cost_usd)::float8 AS cost_usd, COUNT(*)::int AS runs
       FROM (${LOCAL_RUNS}) x
       WHERE local_ts >= ($1 || '-01')::timestamp AND local_ts < ($1 || '-01')::timestamp + interval '1 month'
       GROUP BY 1, 2, 3`,
      [month],
    );
    return summarizeCosts(
      month,
      rows.map((r) => ({ appCode: r.app_code, kind: r.kind, date: r.date, costUsd: r.cost_usd, runs: r.runs })),
    );
  }

  /** 최근 limit개월의 월 합계 (최근 달부터). run이 없는 달은 빠진다. */
  async monthly(limit: number): Promise<MonthlyCostDto[]> {
    const rows: Array<{ month: string; cost_usd: number; runs: number }> = await this.runs.query(
      `SELECT to_char(local_ts, 'YYYY-MM') AS month, SUM(cost_usd)::float8 AS cost_usd, COUNT(*)::int AS runs
       FROM (${LOCAL_RUNS}) x
       GROUP BY 1 ORDER BY 1 DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ month: r.month, costUsd: round(r.cost_usd), runs: r.runs }));
  }
}
