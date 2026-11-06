import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DeepPartial, FindOptionsWhere, In, Repository } from 'typeorm';
import type { MyFileKind } from '@hub/shared';
import { cleanFileName, DiskFileStore, fileKindOf, MAX_FILES_PER_OWNER } from './stored-files';

/** 첨부 파일 행이 공통으로 갖는 칸 (my_doc_files, app_note_files) */
export interface StoredFileRow {
  /** 첨부 파일 id */
  id: number;
  /** 올린 파일 이름 (화면 표시와 내려받기 이름) */
  name: string;
  /** 보기 방식: pdf, md, text, image, other */
  kind: MyFileKind;
  /** 바이트 */
  size: number;
  /** 저장 폴더 안의 이름: <uuid><확장자> */
  storedName: string;
  /** 올린 시각 */
  createdAt: Date;
}

/**
 * 첨부 파일 다루기의 공통 틀(템플릿 메서드). 목록은 DB, 내용은 DiskFileStore(~/.hub/files/).
 * 붙이기·열기·지우기 순서는 여기서 정하고, 주인(보관함 문서, 노트)마다 다른 것만 하위 클래스가 채운다:
 * 주인 칸 이름, 주인이 있는지, 주인의 수정 시각 올리기, 화면에 줄 값.
 * 새 주인(예: 기획)에 첨부를 붙일 때는 이 클래스를 이어받고 위 넷만 채우면 된다.
 *
 * @typeParam F 첨부 파일 엔티티
 * @typeParam D 화면에 주는 첨부 파일 값
 */
export abstract class AttachmentFiles<F extends StoredFileRow, D> {
  protected readonly logger: Logger;

  /** 주인 id를 담는 엔티티 칸 이름 (예: docId, noteId) */
  protected abstract readonly ownerKey: keyof F & string;
  /** 오류 문구에 쓰는 주인 이름 (예: 문서, 노트) */
  protected abstract readonly ownerLabel: string;
  /**
   * 주인이 있는지
   * @param ownerId 주인 id
   */
  protected abstract ownerExists(ownerId: number): Promise<boolean>;
  /**
   * 첨부가 바뀌면 주인의 마지막 수정 시각을 올린다
   * @param ownerId 주인 id
   */
  protected abstract touchOwner(ownerId: number): Promise<void>;
  /**
   * 화면에 줄 값
   * @param f 첨부 파일 행
   */
  abstract toDto(f: F): D;

  /**
   * @param files 첨부 파일 목록 저장소
   * @param store 내용을 두는 곳
   */
  constructor(
    protected readonly files: Repository<F>,
    readonly store: DiskFileStore,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  private ownerOf(f: F): number {
    return f[this.ownerKey] as unknown as number;
  }

  private byOwnerWhere(owner: number | ReturnType<typeof In<number>>): FindOptionsWhere<F> {
    return { [this.ownerKey]: owner } as FindOptionsWhere<F>;
  }

  /**
   * 주인별 첨부 목록, 올린 순.
   * @param ownerIds 이 주인들만. 생략하면 모두
   */
  async byOwner(ownerIds?: number[]): Promise<Map<number, D[]>> {
    const rows = await this.files.find({ where: ownerIds ? this.byOwnerWhere(In(ownerIds)) : {}, order: { id: 'ASC' } as never });
    const out = new Map<number, D[]>();
    for (const f of rows) out.set(this.ownerOf(f), [...(out.get(this.ownerOf(f)) ?? []), this.toDto(f)]);
    return out;
  }

  /**
   * 파일을 붙이고 그 행을 돌려준다. 크기는 readUpload가 이미 막았다. 주인의 마지막 수정 시각도 올린다.
   * @param ownerId 붙일 주인
   * @param rawName 브라우저가 보낸 파일 이름
   * @param body 파일 내용
   */
  async add(ownerId: number, rawName: string, body: Buffer): Promise<F> {
    if (!(await this.ownerExists(ownerId))) throw new NotFoundException(`${this.ownerLabel} ${ownerId}가 없다`);
    const name = cleanFileName(rawName);
    if (!name) throw new BadRequestException('파일 이름이 비었다');
    if ((await this.files.countBy(this.byOwnerWhere(ownerId))) >= MAX_FILES_PER_OWNER) throw new ConflictException(`${this.ownerLabel} 하나에는 파일을 ${MAX_FILES_PER_OWNER}개까지 붙일 수 있다`);
    const stored = this.store.put(body, name);
    try {
      const row = await this.files.save(this.files.create({ [this.ownerKey]: ownerId, name, kind: fileKindOf(name), size: body.length, storedName: stored } as DeepPartial<F>));
      await this.touchOwner(ownerId);
      return row;
    } catch (e) {
      this.store.remove(stored);
      throw e;
    }
  }

  /**
   * 내보낼 파일과 그 폴더. 목록에는 있는데 내용이 없으면 404.
   * @param id 첨부 파일 id
   */
  async open(id: number): Promise<{ file: F; root: string }> {
    const file = await this.files.findOneBy({ id } as FindOptionsWhere<F>);
    if (!file || !existsSync(join(this.store.dir, file.storedName))) throw new NotFoundException(`첨부 파일 ${id}가 없다`);
    return { file, root: this.store.dir };
  }

  /**
   * 첨부 하나를 지우고 그 주인 id를 돌려준다.
   * @param id 첨부 파일 id
   */
  async remove(id: number): Promise<number> {
    const file = await this.files.findOneBy({ id } as FindOptionsWhere<F>);
    if (!file) throw new NotFoundException(`첨부 파일 ${id}가 없다`);
    const owner = this.ownerOf(file);
    await this.files.remove(file);
    await this.touchOwner(owner);
    this.unlink([file.storedName]);
    return owner;
  }

  /**
   * 주인을 지우기 전에 부른다. 저장 이름을 받아 두었다가 주인을 지운 뒤 unlink로 내용을 지운다(행은 CASCADE).
   * @param ownerId 지울 주인
   */
  async storedNamesOf(ownerId: number): Promise<string[]> {
    return (await this.files.find({ select: { storedName: true } as never, where: this.byOwnerWhere(ownerId) })).map((f) => f.storedName);
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
