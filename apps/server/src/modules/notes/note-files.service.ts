import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import type { NoteFileDto } from '@hub/shared';
import { AttachmentFiles } from '../../common/attachment-files';
import { DiskFileStore } from '../../common/stored-files';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AppNote } from './app-note.entity';
import { AppNoteFile } from './app-note-file.entity';

/** 노트 첨부 주소. 그림 블록의 src로도 쓴다 */
export const noteFileUrl = (id: number) => `/api/notes/files/${id}`;

export function toNoteFileDto(f: AppNoteFile): NoteFileDto {
  return { id: f.id, noteId: f.noteId, name: f.name, kind: f.kind, size: f.size, url: noteFileUrl(f.id), createdAt: f.createdAt.toISOString() };
}

/** 노트의 첨부 파일: 목록은 DB(app_note_files), 내용은 Hub 폴더(~/.hub/files/). 순서는 AttachmentFiles가 정한다 */
@Injectable()
export class NoteFilesService extends AttachmentFiles<AppNoteFile, NoteFileDto> {
  protected readonly ownerKey = 'noteId' as const;
  protected readonly ownerLabel = '노트';

  constructor(
    @Inject(HUB_CONFIG) config: HubConfig,
    @InjectRepository(AppNoteFile) files: Repository<AppNoteFile>,
    @InjectRepository(AppNote) private readonly notes: Repository<AppNote>,
  ) {
    super(files, new DiskFileStore(join(config.hubHome, 'files')));
  }

  protected ownerExists(noteId: number): Promise<boolean> {
    return this.notes.existsBy({ id: noteId });
  }

  protected async touchOwner(noteId: number): Promise<void> {
    await this.notes.update(noteId, { updatedAt: new Date() });
  }

  toDto(f: AppNoteFile): NoteFileDto {
    return toNoteFileDto(f);
  }
}
