import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import type { MyDocFileDto } from '@hub/shared';
import { AttachmentFiles } from '../../common/attachment-files';
import { DiskFileStore } from '../../common/stored-files';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { MyDoc } from './my-doc.entity';
import { MyDocFile } from './my-doc-file.entity';

export function toFileDto(f: MyDocFile): MyDocFileDto {
  return { id: f.id, docId: f.docId, name: f.name, kind: f.kind, size: f.size, url: `/api/mine/files/${f.id}`, createdAt: f.createdAt.toISOString() };
}

/** 보관함 문서의 첨부 파일: 목록은 DB(my_doc_files), 내용은 Hub 폴더(~/.hub/files/). 순서는 AttachmentFiles가 정한다 */
@Injectable()
export class DocFilesService extends AttachmentFiles<MyDocFile, MyDocFileDto> {
  protected readonly ownerKey = 'docId' as const;
  protected readonly ownerLabel = '문서';

  constructor(
    @Inject(HUB_CONFIG) config: HubConfig,
    @InjectRepository(MyDocFile) files: Repository<MyDocFile>,
    @InjectRepository(MyDoc) private readonly docs: Repository<MyDoc>,
  ) {
    super(files, new DiskFileStore(join(config.hubHome, 'files')));
  }

  protected ownerExists(docId: number): Promise<boolean> {
    return this.docs.existsBy({ id: docId });
  }

  protected async touchOwner(docId: number): Promise<void> {
    await this.docs.update(docId, { updatedAt: new Date() });
  }

  toDto(f: MyDocFile): MyDocFileDto {
    return toFileDto(f);
  }
}
