import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppNoteDto } from '@hub/shared';
import { AppsService } from '../apps/apps.service';
import { AppNote } from './app-note.entity';

/** 노트 한 줄의 글자 수 제한. 본문은 노션처럼 길게 쓸 수 있게 넉넉히 둔다 */
export const NOTE_LIMITS = { folder: 100, title: 300, body: 200_000 } as const;

export function toNoteDto(n: AppNote): AppNoteDto {
  return {
    id: n.id,
    appId: n.appId,
    folder: n.folder,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/** 노트를 만들거나 고칠 때 받는 값. 모두 선택이고, 없는 필드는 그대로 둔다 */
export interface NotePatch {
  /** 폴더 이름. 앞뒤 공백은 지운다 */
  folder?: string;
  /** 제목 */
  title?: string;
  /** 본문 markdown */
  body?: string;
  /** 고정 여부 */
  pinned?: boolean;
}

/** 앱별 노트: 목록은 고정 먼저, 그다음 최근 수정순 */
@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(AppNote) private readonly repo: Repository<AppNote>,
    private readonly apps: AppsService,
  ) {}

  /**
   * @param appId 앱 id. 없는 앱이면 404
   */
  async list(appId: number): Promise<AppNoteDto[]> {
    await this.apps.get(appId);
    const rows = await this.repo.find({ where: { appId }, order: { pinned: 'DESC', updatedAt: 'DESC', id: 'DESC' } });
    return rows.map(toNoteDto);
  }

  /**
   * @param appId 앱 id
   * @param patch 처음 값 (폴더·제목·본문)
   */
  async create(appId: number, patch: NotePatch): Promise<AppNoteDto> {
    await this.apps.get(appId);
    const n = this.repo.create({ appId, folder: patch.folder?.trim() ?? '', title: patch.title ?? '', body: patch.body ?? '', pinned: patch.pinned ?? false });
    return toNoteDto(await this.repo.save(n));
  }

  /**
   * @param id 노트 id
   * @param patch 바꿀 값. 없는 필드는 그대로 둔다
   */
  async update(id: number, patch: NotePatch): Promise<AppNoteDto> {
    const n = await this.one(id);
    if (patch.folder !== undefined) n.folder = patch.folder.trim();
    if (patch.title !== undefined) n.title = patch.title;
    if (patch.body !== undefined) n.body = patch.body;
    if (patch.pinned !== undefined) n.pinned = patch.pinned;
    return toNoteDto(await this.repo.save(n));
  }

  async remove(id: number): Promise<void> {
    await this.repo.remove(await this.one(id));
  }

  private async one(id: number): Promise<AppNote> {
    const n = await this.repo.findOneBy({ id });
    if (!n) throw new NotFoundException(`노트 ${id}가 없다`);
    return n;
  }
}
