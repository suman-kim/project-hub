import { Inject, Injectable } from '@nestjs/common';
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { run } from '../runner/git';

/** claude agents --json 한 줄 */
export interface BgSession {
  id?: string;
  sessionId: string;
  name?: string;
  cwd: string;
  kind: string;
  status: string;
  waitingFor?: string;
  state?: string;
}

/** 세션 화면 출력에서 원격 조종 링크를 찾는다 */
export function extractRemoteLink(output: string): string | null {
  return /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/.exec(output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))?.[0] ?? null;
}

export interface PendingTool {
  tool: string;
  cmd: string;
}

/**
 * Hub 밖에서 도는 Claude 세션(claude --bg). claude agents --json으로 상태를 읽고,
 * 대화 기록 파일로 허락을 기다리는 명령을, claude logs로 원격 조종 링크를 알아낸다.
 * 모두 공식 문서에 없는 동작이라 읽지 못하면 비워 둔다.
 */
@Injectable()
export class BgSessionsService {
  private cache: { at: number; list: BgSession[] } | null = null;
  private readonly links = new Map<string, string>();

  constructor(@Inject(HUB_CONFIG) private readonly config: HubConfig) {}

  async list(): Promise<BgSession[]> {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.list;
    let list: BgSession[] = [];
    try {
      list = (JSON.parse(await run(this.config.runner.claudeBin, ['agents', '--json'], this.config.hubHome, 15_000)) as BgSession[]).filter(
        (s) => s.kind === 'background',
      );
    } catch {
      list = [];
    }
    this.cache = { at: Date.now(), list };
    return list;
  }

  /** 경로 중 하나 아래에서 도는 세션 */
  async under(paths: string[]): Promise<BgSession[]> {
    const roots = paths.filter(Boolean).map((p) => p.replace(/\/$/, ''));
    return (await this.list()).filter((s) => roots.some((r) => s.cwd === r || s.cwd.startsWith(`${r}/`)));
  }

  /** 마지막 도구 사용 중 결과가 아직 없는 것 = 허락을 기다리는 명령 */
  pendingTool(sessionId: string): PendingTool | null {
    const file = this.transcriptOf(sessionId);
    if (!file) return null;
    const lines = tailLines(file, 400_000);
    const answered = new Set<string>();
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      let rec: { type?: string; message?: { content?: unknown } };
      try {
        rec = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const content = Array.isArray(rec.message?.content) ? (rec.message!.content as Array<Record<string, unknown>>) : [];
      for (const c of content) if (c.type === 'tool_result' && typeof c.tool_use_id === 'string') answered.add(c.tool_use_id);
      if (rec.type !== 'assistant') continue;
      const use = content.find((c) => c.type === 'tool_use');
      if (!use) continue;
      if (answered.has(String(use.id))) return null;
      const input = (use.input ?? {}) as Record<string, unknown>;
      const cmd = String(input.command ?? input.file_path ?? input.url ?? JSON.stringify(input)).slice(0, 300);
      return { tool: String(use.name), cmd };
    }
    return null;
  }

  /**
   * 원격 조종 링크. 세션 화면에 시작할 때 한 번 찍히므로 claude logs에서 찾아 기억해 둔다.
   * 오래돼 화면에서 밀려났으면 새 앱 시작 run이 저장해 둔 링크(saved)를 쓴다.
   */
  async remoteLink(id: string, saved?: string | null): Promise<string | null> {
    if (this.links.has(id)) return this.links.get(id)!;
    try {
      const link = extractRemoteLink(await run(this.config.runner.claudeBin, ['logs', id], this.config.hubHome, 15_000)) ?? saved ?? null;
      if (link) this.links.set(id, link);
      return link;
    } catch {
      return saved ?? null;
    }
  }

  /** ~/.claude/projects/<폴더>/<세션ID>.jsonl. worktree로 옮기면 폴더가 바뀌므로 세션 ID로 찾는다 */
  private transcriptOf(sessionId: string): string | null {
    const root = join(this.config.claudeHome, 'projects');
    if (!existsSync(root)) return null;
    let best: { path: string; mtime: number } | null = null;
    for (const dir of readdirSync(root)) {
      const p = join(root, dir, `${sessionId}.jsonl`);
      if (!existsSync(p)) continue;
      const mtime = statSync(p).mtimeMs;
      if (!best || mtime > best.mtime) best = { path: p, mtime };
    }
    return best?.path ?? null;
  }
}

/** 큰 파일의 끝부분만 읽어 줄로 나눈다 */
function tailLines(file: string, bytes: number): string[] {
  const size = statSync(file).size;
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift();
  return lines.filter(Boolean);
}
