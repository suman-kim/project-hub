/**
 * 첨부 파일을 디스크에 두고 내보내는 공통 도구. 보관함 문서 첨부와 노트 첨부가 같이 쓴다.
 * 목록(DB)은 AttachmentFiles(attachment-files.ts)가 다룬다.
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import type { Response } from 'express';
import type { MyFileKind } from '@hub/shared';

/** 한 파일 최대 크기 (바이트) */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** 주인(보관함 문서, 노트) 하나에 붙일 수 있는 파일 수 */
export const MAX_FILES_PER_OWNER = 50;
/** 올린 이름 최대 길이 */
const MAX_NAME = 200;

const KIND: Record<string, MyFileKind> = {
  '.pdf': 'pdf',
  '.md': 'md', '.markdown': 'md',
  '.txt': 'text', '.csv': 'text', '.json': 'text', '.log': 'text', '.yaml': 'text', '.yml': 'text',
  // svg는 스크립트를 품을 수 있어 그림으로 열지 않는다.
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
};
const IMAGE_TYPE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/** 확장자로 정하는 보기 방식. 모르는 확장자는 내려받기만(other) */
export const fileKindOf = (name: string): MyFileKind => KIND[extname(name).toLowerCase()] ?? 'other';

/**
 * 내보낼 Content-Type.
 * md·텍스트는 브라우저가 내려받거나 HTML로 읽지 않게 text/plain으로, 화면 안에서 보지 않는 파일은 octet-stream으로 보낸다.
 * @param name 올린 파일 이름 (확장자로 그림 형식을 고른다)
 * @param kind 저장할 때 정한 보기 방식
 */
export function contentTypeOf(name: string, kind: MyFileKind): string {
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'md' || kind === 'text') return 'text/plain; charset=utf-8';
  if (kind === 'image') return IMAGE_TYPE[extname(name).toLowerCase()] ?? 'application/octet-stream';
  return 'application/octet-stream';
}

/**
 * 올린 이름 정리: 폴더 경로와 제어 문자를 빼고, 맥에서 온 풀어 쓴 한글(NFD)을 모아 쓴 꼴(NFC)로 바꾼다.
 * 너무 길면 확장자는 남기고 앞부분을 자른다. 남는 글이 없으면 빈 문자열.
 * @param raw 브라우저가 보낸 파일 이름
 */
export function cleanFileName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name.length <= MAX_NAME) return name;
  const ext = extname(name).slice(0, 16);
  return name.slice(0, MAX_NAME - ext.length) + ext;
}

/**
 * Content-Disposition 값. 한글 이름은 filename*(UTF-8)로 주고, 옛 클라이언트용 filename은 ASCII만 남긴다.
 * @param name 올린 파일 이름
 * @param download true면 내려받기(attachment), 아니면 화면 안에서 열기(inline)
 */
export function contentDisposition(name: string, download: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // filename*에서 구분 기호로 읽힐 수 있는 ' ( ) *도 퍼센트로 바꾼다(RFC 5987).
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * 올린 파일 본문을 읽는다. multipart 대신 파일 바이트를 그대로 받는다(이름은 쿼리로 받는다).
 * 크기를 넘으면 남은 본문을 마저 읽어 버린 뒤 거절한다. 읽지 않고 답하면 브라우저는 413 대신 연결 끊김을 본다.
 * 다만 최대 크기의 4배를 넘으면 더 읽지 않고 끊는다.
 * @param req 요청 스트림
 * @param max 받을 최대 바이트
 */
export async function readUpload(req: Readable & { headers: Record<string, string | string[] | undefined> }, max: number): Promise<Buffer> {
  const tooLarge = () => new PayloadTooLargeException(`파일은 ${Math.round(max / 1024 / 1024)}MB까지 올릴 수 있다`);
  if (Number(req.headers['content-length']) > max * 4) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max * 4) break;
    if (size <= max) chunks.push(chunk as Buffer);
  }
  if (size > max) throw tooLarge();
  if (!size) throw new BadRequestException('빈 파일은 올릴 수 없다');
  return Buffer.concat(chunks);
}

/**
 * 첨부 파일 내용을 두는 곳. 지금은 Hub 폴더에 그대로 둔다(Finder에서 바로 열 수 있다).
 * 저장 이름은 <uuid><확장자>라 올린 이름이 경로에 끼어들지 않는다. 폴더는 0700, 파일은 0600.
 * 암호화 저장 등으로 바꿀 때는 이 클래스의 put·remove·dir만 맞추면 된다.
 */
export class DiskFileStore {
  /** @param dir 파일을 둘 폴더 (보통 ~/.hub/files) */
  constructor(readonly dir: string) {}

  /**
   * 새 이름으로 저장하고 그 이름을 돌려준다.
   * @param body 파일 내용
   * @param name 올린 파일 이름 (확장자만 쓴다)
   */
  put(body: Buffer, name: string): string {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const ext = extname(name).toLowerCase();
    const stored = `${randomUUID()}${/^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ''}`;
    writeFileSync(join(this.dir, stored), body, { flag: 'wx', mode: 0o600 });
    return stored;
  }

  /**
   * 지운다. 이미 없으면 그냥 넘어간다.
   * @param stored put이 돌려준 저장 이름
   */
  remove(stored: string): void {
    try {
      unlinkSync(join(this.dir, stored));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}

/**
 * 첨부 파일 내용을 응답으로 보낸다. 화면 안 보기(PDF·md·텍스트·그림)는 inline, download면 내려받기.
 * 대시보드와 같은 출처라서, 열리는 파일이 스크립트를 돌리지 못하게 PDF 밖에는 CSP sandbox를 건다.
 * @param res 응답
 * @param file 올린 이름·보기 방식·저장 이름
 * @param root 저장 폴더 (DiskFileStore.dir)
 * @param download true면 늘 내려받기
 */
export function sendStoredFile(res: Response, file: { name: string; kind: MyFileKind; storedName: string }, root: string, download: boolean): void {
  const inline = !download && file.kind !== 'other';
  res.setHeader('Content-Type', contentTypeOf(file.name, file.kind));
  res.setHeader('Content-Disposition', contentDisposition(file.name, !inline));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  // PDF는 sandbox에서 브라우저 보기 화면이 뜨지 않는다. PDF 보기에는 페이지 스크립트가 돌지 않으니 뺀다.
  if (file.kind !== 'pdf') res.setHeader('Content-Security-Policy', 'sandbox');
  // ~/.hub처럼 점으로 시작하는 폴더도 열리게 root를 따로 준다(저장 이름은 Hub가 만든 uuid다).
  res.sendFile(file.storedName, { root });
}
