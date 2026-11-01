import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KoProgressDto } from '@hub/shared';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { run } from '../runner/git';

/** 한 번에 Claude에게 넘기는 항목 수 */
const BATCH = 40;
const CALL_TIMEOUT_MS = 180_000;
/** 요약은 싼 모델로 충분하다 */
const MODEL = 'haiku';

export interface KoItem {
  type: 'skill' | 'command' | 'plugin' | 'connector';
  name: string;
  /** 스킬·플러그인은 설명, 커넥터는 주소와 플러그인 이름 */
  text: string;
}

const SCHEMA = {
  type: 'object',
  properties: { summaries: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, ko: { type: 'string' } }, required: ['id', 'ko'] } } },
  required: ['summaries'],
};

export const koKey = (i: KoItem) => createHash('sha1').update(`${i.type}\n${i.name}\n${i.text}`).digest('hex').slice(0, 16);

function prompt(items: Array<KoItem & { id: string }>): string {
  return [
    '아래 항목은 Claude Code의 스킬, 슬래시 명령, 플러그인, 커넥터(MCP 서버)다.',
    '각 항목이 무엇을 하는지 한국어 한두 문장, 80자 안쪽으로 요약한다.',
    '- 해요체로 쓴다. 예: "PR을 여러 에이전트로 나눠 리뷰해요."',
    '- 제품 이름, 명령, 파일 이름은 원래 글자 그대로 둔다.',
    '- 커넥터는 설명이 없다. 이름과 주소로 어떤 서비스인지 알아보고, Claude가 그걸로 무엇을 할 수 있는지 쓴다.',
    '- 도구를 쓰지 말고 바로 답한다. 모든 id에 하나씩 답한다.',
    '',
    JSON.stringify(items.map((i) => ({ id: i.id, type: i.type, name: i.name, text: i.text }))),
  ].join('\n');
}

/**
 * 스킬·커넥터 화면의 한국어 요약. 원문(종류·이름·설명)의 해시로 ~/.hub/env-ko.json에 한 번 만들어 둔다.
 * 설명이 바뀐 항목만 다시 만든다. Claude 호출은 hook을 끄고 돌려 세션 목록에 남지 않게 한다.
 */
@Injectable()
export class KoSummaries {
  private readonly logger = new Logger('KoSummaries');
  private cache: Record<string, string> | null = null;
  private progress: KoProgressDto = { running: false, done: 0, total: 0, error: null };

  constructor(@Inject(HUB_CONFIG) private readonly config: HubConfig) {}

  private get file(): string {
    return join(this.config.hubHome, 'env-ko.json');
  }

  private load(): Record<string, string> {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
      } catch {
        this.cache = {};
      }
    }
    return this.cache;
  }

  private save(): void {
    mkdirSync(this.config.hubHome, { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.cache ?? {}));
    renameSync(tmp, this.file);
  }

  get(i: KoItem): string | null {
    return this.load()[koKey(i)] || null;
  }

  state(): KoProgressDto {
    return this.progress;
  }

  /** 요약이 없는 항목을 뒤에서 만든다. 이미 만드는 중이면 그대로 둔다 */
  start(items: KoItem[]): KoProgressDto {
    if (this.progress.running) return this.progress;
    const cache = this.load();
    const missing = new Map<string, KoItem>();
    for (const i of items) if (!(koKey(i) in cache)) missing.set(koKey(i), i);
    if (!missing.size) return this.progress;
    this.progress = { running: true, done: 0, total: missing.size, error: null };
    void this.work([...missing.entries()]);
    return this.progress;
  }

  private async work(entries: Array<[string, KoItem]>): Promise<void> {
    try {
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH).map(([id, item]) => ({ ...item, id }));
        const got = await this.call(batch);
        for (const s of got) if (batch.some((b) => b.id === s.id) && s.ko.trim()) this.cache![s.id] = s.ko.trim();
        // 답이 빠진 항목은 빈 값으로 남겨 화면을 열 때마다 다시 묻지 않는다(원문이 바뀌면 키가 달라져 다시 만든다).
        for (const b of batch) if (!(b.id in this.cache!)) this.cache![b.id] = '';
        this.save();
        this.progress = { ...this.progress, done: Math.min(this.progress.total, i + batch.length) };
      }
      this.progress = { ...this.progress, running: false };
    } catch (e) {
      this.logger.warn(`한국어 요약 실패: ${(e as Error).message}`);
      this.progress = { ...this.progress, running: false, error: (e as Error).message };
    }
  }

  private async call(items: Array<KoItem & { id: string }>): Promise<Array<{ id: string; ko: string }>> {
    const cwd = join(this.config.hubHome, 'ko');
    mkdirSync(cwd, { recursive: true });
    const out = await run(
      this.config.runner.claudeBin,
      ['-p', prompt(items), '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--model', MODEL, '--permission-mode', 'dontAsk', '--settings', JSON.stringify({ disableAllHooks: true })],
      cwd,
      CALL_TIMEOUT_MS,
    );
    const res = JSON.parse(out) as { structured_output?: { summaries?: Array<{ id: string; ko: string }> }; result?: string; is_error?: boolean };
    if (res.is_error) throw new Error(typeof res.result === 'string' ? res.result : 'claude 오류');
    const structured = res.structured_output ?? (typeof res.result === 'string' ? (JSON.parse(res.result) as { summaries?: Array<{ id: string; ko: string }> }) : undefined);
    return structured?.summaries ?? [];
  }
}
