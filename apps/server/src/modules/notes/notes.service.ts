import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { AppNoteDto, NoteFileDto, NoteUploadDto } from '@hub/shared';
import { AppsService } from '../apps/apps.service';
import { AppNote } from './app-note.entity';
import { NoteFilesService } from './note-files.service';

/** 노트 한 줄의 글자 수 제한. 본문은 노션처럼 길게 쓸 수 있게 넉넉히 둔다 */
export const NOTE_LIMITS = { folder: 100, title: 300, body: 200_000 } as const;

/**
 * @param n 노트
 * @param files 그 노트의 첨부 목록 (NoteFilesService.byOwner)
 */
export function toNoteDto(n: AppNote, files: NoteFileDto[] = []): AppNoteDto {
  return {
    id: n.id,
    appId: n.appId,
    folder: n.folder,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    files,
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

/**
 * 노트가 어디에 속하는지: 앱 id, 또는 null(앱에 묶이지 않은 내 업무 공통 노트).
 * 목록·만들기만 이 값으로 고르고, 고치기·지우기는 노트 id로 한다.
 */
export type NoteOwner = number | null;

/** 노트: 앱 노트와 내 업무 공통 노트. 목록은 고정 먼저, 그다음 최근 수정순 */
@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(AppNote) private readonly repo: Repository<AppNote>,
    private readonly apps: AppsService,
    private readonly files: NoteFilesService,
  ) {}

  /**
   * @param owner 앱 id(없는 앱이면 404) 또는 null(내 업무 공통 노트)
   */
  async list(owner: NoteOwner): Promise<AppNoteDto[]> {
    await this.checkOwner(owner);
    const rows = await this.repo.find({ where: { appId: owner ?? IsNull() }, order: { pinned: 'DESC', updatedAt: 'DESC', id: 'DESC' } });
    const files = rows.length ? await this.files.byOwner(rows.map((n) => n.id)) : new Map<number, NoteFileDto[]>();
    return rows.map((n) => toNoteDto(n, files.get(n.id)));
  }

  /**
   * @param owner 앱 id 또는 null(내 업무 공통 노트)
   * @param patch 처음 값 (폴더·제목·본문)
   */
  async create(owner: NoteOwner, patch: NotePatch): Promise<AppNoteDto> {
    await this.checkOwner(owner);
    const n = this.repo.create({ appId: owner, folder: patch.folder?.trim() ?? '', title: patch.title ?? '', body: patch.body ?? '', pinned: patch.pinned ?? false });
    return toNoteDto(await this.repo.save(n));
  }

  /** 앱 노트면 그 앱이 있는지 본다(없으면 404). 공통 노트는 볼 것이 없다 */
  private async checkOwner(owner: NoteOwner): Promise<void> {
    if (owner !== null) await this.apps.get(owner);
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
    return this.withFiles(await this.repo.save(n));
  }

  /** 첨부 목록은 CASCADE로 지워지고, 첨부 내용 파일은 노트를 지운 뒤에 지운다 */
  async remove(id: number): Promise<void> {
    const n = await this.one(id);
    const stored = await this.files.storedNamesOf(id);
    await this.repo.remove(n);
    this.files.unlink(stored);
  }

  /**
   * 첨부 목록까지 담은 노트 하나. 노트를 바꾸는 응답은 모두 이걸 돌려줘 화면 캐시에서 첨부가 빠지지 않게 한다.
   * @param id 노트 id
   */
  async dto(id: number): Promise<AppNoteDto> {
    return this.withFiles(await this.one(id));
  }

  /**
   * 파일을 붙이고, 첨부 목록이 담긴 노트와 방금 올린 파일을 돌려준다(그림 블록에 주소를 넣을 수 있게).
   * @param id 노트 id
   * @param name 브라우저가 보낸 파일 이름
   * @param body 파일 내용
   */
  async addFile(id: number, name: string, body: Buffer): Promise<NoteUploadDto> {
    const f = await this.files.add(id, name, body);
    return { note: await this.dto(id), file: this.files.toDto(f) };
  }

  /**
   * 첨부 하나를 지우고 그 노트를 돌려준다. 본문의 그림 블록은 그대로 두고, 화면이 "지운 그림"으로 보여 준다.
   * @param fileId 첨부 파일 id
   */
  async removeFile(fileId: number): Promise<AppNoteDto> {
    return this.dto(await this.files.remove(fileId));
  }

  private async withFiles(n: AppNote): Promise<AppNoteDto> {
    return toNoteDto(n, (await this.files.byOwner([n.id])).get(n.id));
  }

  private async one(id: number): Promise<AppNote> {
    const n = await this.repo.findOneBy({ id });
    if (!n) throw new NotFoundException(`노트 ${id}가 없다`);
    return n;
  }
}
