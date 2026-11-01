import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { In, Repository } from 'typeorm';
import type { MyDocFileDto } from '@hub/shared';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { cleanFileName, DiskFileStore, fileKindOf, MAX_FILES_PER_DOC } from './doc-files';
import { MyDoc } from './my-doc.entity';
import { MyDocFile } from './my-doc-file.entity';

export function toFileDto(f: MyDocFile): MyDocFileDto {
  return { id: f.id, docId: f.docId, name: f.name, kind: f.kind, size: f.size, url: `/api/mine/files/${f.id}`, createdAt: f.createdAt.toISOString() };
}

/** 내 업무 문서의 첨부 파일: 목록은 DB(my_doc_files), 내용은 Hub 폴더(~/.hub/files/) */
@Injectable()
export class DocFilesService {
  private readonly logger = new Logger('DocFiles');
  private readonly store: DiskFileStore;

  constructor(
    @Inject(HUB_CONFIG) config: HubConfig,
    @InjectRepository(MyDocFile) private readonly files: Repository<MyDocFile>,
    @InjectRepository(MyDoc) private readonly docs: Repository<MyDoc>,
  ) {
    this.store = new DiskFileStore(join(config.hubHome, 'files'));
  }

  /**
   * 문서별 첨부 목록, 올린 순.
   * @param docIds 이 문서들만. 생략하면 모든 문서
   */
  async byDoc(docIds?: number[]): Promise<Map<number, MyDocFileDto[]>> {
    const rows = await this.files.find({ where: docIds ? { docId: In(docIds) } : {}, order: { id: 'ASC' } });
    const out = new Map<number, MyDocFileDto[]>();
    for (const f of rows) out.set(f.docId, [...(out.get(f.docId) ?? []), toFileDto(f)]);
    return out;
  }

  /**
   * 파일을 붙인다. 크기는 readUpload가 이미 막았다. 문서의 마지막 수정 시각도 올린다.
   * @param docId 붙일 문서
   * @param rawName 브라우저가 보낸 파일 이름
   * @param body 파일 내용
   */
  async add(docId: number, rawName: string, body: Buffer): Promise<void> {
    if (!(await this.docs.existsBy({ id: docId }))) throw new NotFoundException(`문서 ${docId}가 없다`);
    const name = cleanFileName(rawName);
    if (!name) throw new BadRequestException('파일 이름이 비었다');
    if ((await this.files.countBy({ docId })) >= MAX_FILES_PER_DOC) throw new ConflictException(`문서 하나에는 파일을 ${MAX_FILES_PER_DOC}개까지 붙일 수 있다`);
    const stored = this.store.put(body, name);
    try {
      await this.files.save(this.files.create({ docId, name, kind: fileKindOf(name), size: body.length, storedName: stored }));
      await this.docs.update(docId, { updatedAt: new Date() });
    } catch (e) {
      this.store.remove(stored);
      throw e;
    }
  }

  /**
   * 내보낼 파일과 그 폴더. 목록에는 있는데 내용이 없으면 404.
   * @param id 첨부 파일 id
   */
  async open(id: number): Promise<{ file: MyDocFile; root: string }> {
    const file = await this.files.findOneBy({ id });
    if (!file || !existsSync(join(this.store.dir, file.storedName))) throw new NotFoundException(`첨부 파일 ${id}가 없다`);
    return { file, root: this.store.dir };
  }

  /**
   * 첨부 하나를 지우고 그 문서 id를 돌려준다.
   * @param id 첨부 파일 id
   */
  async remove(id: number): Promise<number> {
    const file = await this.files.findOneBy({ id });
    if (!file) throw new NotFoundException(`첨부 파일 ${id}가 없다`);
    await this.files.remove(file);
    await this.docs.update(file.docId, { updatedAt: new Date() });
    this.unlink([file.storedName]);
    return file.docId;
  }

  /**
   * 문서를 지우기 전에 부른다. 저장 이름을 받아 두었다가 문서를 지운 뒤 unlink로 내용을 지운다(행은 CASCADE).
   * @param docId 지울 문서
   */
  async storedNamesOf(docId: number): Promise<string[]> {
    return (await this.files.find({ select: { storedName: true }, where: { docId } })).map((f) => f.storedName);
  }

  /**
   * 내용 파일을 지운다. 실패해도 목록은 이미 지웠으니 기록만 남긴다.
   * @param stored 저장 이름들
   */
  unlink(stored: string[]): void {
    for (const s of stored) {
      try {
        this.store.remove(s);
      } catch (e) {
        this.logger.warn(`첨부 파일 ${s}를 지우지 못했다: ${(e as Error).message}`);
      }
    }
  }
}
