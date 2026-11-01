import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ChatItem, SessionChatDto } from '@hub/shared';
import { Repository } from 'typeorm';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { Session } from './session.entity';
import { SessionEvent } from './session-event.entity';
import { SessionsService } from './sessions.service';
import { TranscriptChat } from './transcript';

interface Cached {
  /** 여기까지 읽었다(바이트) */
  offset: number;
  /** 아직 줄바꿈이 오지 않은 마지막 줄 */
  partial: Buffer;
  chat: TranscriptChat;
}

/** 대화 기록을 읽어 둔 파일 수. 많으면 오래 안 본 것부터 버린다 */
const CACHE_MAX = 20;

/**
 * 세션 대화 보기. hook이 알려 준 대화 기록 파일(transcript_path)을 읽어 대화 화면 줄로 바꾼다.
 * 파일은 끝에 줄만 붙으므로 읽은 위치를 기억해 두고 새로 붙은 부분만 읽는다.
 * ~/.claude/projects 밖의 파일은 읽지 않는다.
 */
@Injectable()
export class TranscriptService {
  private readonly cache = new Map<string, Cached>();

  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(SessionEvent) private readonly events: Repository<SessionEvent>,
    private readonly views: SessionsService,
  ) {}

  async chat(sessionId: number, limit: number): Promise<SessionChatDto> {
    const session = await this.sessions.findOneBy({ id: sessionId });
    const [view] = session ? await this.views.views({ sessionId }) : [];
    if (!session || !view) throw new NotFoundException(`세션 ${sessionId}이 없다`);
    const path = await this.pathOf(session);
    const sent = (await this.views.messagesOf(session.id)).map(
      (m): ChatItem => ({ kind: 'user', id: `hm${m.id}`, at: m.createdAt.toISOString(), text: m.text, from: 'me', images: 0, delivery: m.deliveredAt ? 'delivered' : 'pending' }),
    );
    if (!path) return { session: view, items: sent.slice(-limit), total: sent.length, missing: sent.length ? null : '이 세션의 대화 기록 파일을 찾지 못했어요' };
    // Hub가 띄운 세션에서 사람 쪽 메시지는 Hub가 보낸 지시다.
    const fromLog = this.read(path).chat.items.map((i): ChatItem => (session.origin === 'hub' && i.kind === 'user' ? { ...i, from: 'hub' } : i));
    const all = mergeByTime(fromLog, sent);
    return { session: view, items: all.slice(-limit), total: all.length, missing: null };
  }

  /** hook 입력의 transcript_path를 쓰고, 없으면 projects 폴더에서 세션 id로 찾는다 */
  private async pathOf(s: Session): Promise<string | null> {
    const root = join(this.config.claudeHome, 'projects');
    if (!existsSync(root)) return null;
    const [row] = await this.events.query(
      `SELECT payload->>'transcript_path' AS path FROM session_events WHERE session_id = $1 AND payload ? 'transcript_path' ORDER BY id DESC LIMIT 1`,
      [s.id],
    );
    const candidates = [row?.path as string | undefined, ...readdirSync(root).map((d) => join(root, d, `${s.claudeSessionId}.jsonl`))];
    const realRoot = realpathSync(root) + sep;
    for (const c of candidates) {
      if (!c || !c.endsWith('.jsonl') || !existsSync(c)) continue;
      const real = realpathSync(c);
      if (real.startsWith(realRoot)) return real;
    }
    return null;
  }

  private read(path: string): Cached {
    const size = statSync(path).size;
    let c = this.cache.get(path);
    // 파일이 줄었으면(다시 쓴 경우) 처음부터 읽는다.
    if (!c || size < c.offset) c = { offset: 0, partial: Buffer.alloc(0), chat: new TranscriptChat() };
    if (size > c.offset) {
      const buf = Buffer.alloc(size - c.offset);
      const fd = openSync(path, 'r');
      try {
        readSync(fd, buf, 0, buf.length, c.offset);
      } finally {
        closeSync(fd);
      }
      const data = Buffer.concat([c.partial, buf]);
      // 줄 경계에서만 자른다. 마지막 줄이 아직 쓰이는 중이면 다음에 이어 읽는다(한글이 바이트 중간에서 잘리지 않게 Buffer로 둔다).
      const end = data.lastIndexOf(0x0a);
      const complete = end >= 0 ? data.subarray(0, end) : Buffer.alloc(0);
      c.partial = Buffer.from(end >= 0 ? data.subarray(end + 1) : data);
      for (const line of complete.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          c.chat.add(JSON.parse(line));
        } catch {
          // 깨진 줄은 건너뛴다.
        }
      }
      c.offset = size;
    }
    this.cache.delete(path);
    this.cache.set(path, c);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return c;
  }
}

/** 대화 기록 줄 사이에 대시보드에서 보낸 메시지를 보낸 시각 자리에 끼운다 */
function mergeByTime(items: ChatItem[], extra: ChatItem[]): ChatItem[] {
  if (!extra.length) return items;
  const out = [...items];
  for (const e of extra) {
    const t = Date.parse(e.at ?? '');
    const idx = out.findIndex((i) => i.at && Date.parse(i.at) > t);
    if (idx < 0) out.push(e);
    else out.splice(idx, 0, e);
  }
  return out;
}
