import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { MAX_FILE_BYTES, readUpload, sendStoredFile } from '../../common/stored-files';
import { ZodPipe } from '../../common/zod.pipe';
import { NoteFilesService } from './note-files.service';
import { NOTE_LIMITS, NotesService } from './notes.service';

const patchSchema = z.object({
  folder: z.string().max(NOTE_LIMITS.folder).optional(),
  title: z.string().max(NOTE_LIMITS.title).optional(),
  body: z.string().max(NOTE_LIMITS.body).optional(),
  pinned: z.boolean().optional(),
});
type NoteBody = z.infer<typeof patchSchema>;
const fileNameSchema = z.string().trim().min(1, '파일 이름(name)이 필요하다').max(1000);

/** 노트: 목록·만들기는 앱 아래(앱 노트)나 내 업무 아래(공통 노트), 고치기·지우기는 노트 id로 */
@Controller('api')
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly files: NoteFilesService,
  ) {}

  /** @param id 앱 id */
  @Get('apps/:id/notes')
  list(@Param('id', ParseIntPipe) id: number) {
    return this.notes.list(id);
  }

  /** @param id 앱 id */
  @Post('apps/:id/notes')
  create(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(patchSchema)) body: NoteBody) {
    return this.notes.create(id, body);
  }

  /** 내 업무 공통 노트 (앱에 묶이지 않음) */
  @Get('mine/notes')
  listMine() {
    return this.notes.list(null);
  }

  @Post('mine/notes')
  createMine(@Body(new ZodPipe(patchSchema)) body: NoteBody) {
    return this.notes.create(null, body);
  }

  /** @param id 노트 id */
  @Patch('notes/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(patchSchema)) body: NoteBody) {
    return this.notes.update(id, body);
  }

  /** @param id 노트 id */
  @Delete('notes/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.notes.remove(id);
  }

  /**
   * 노트에 파일 붙이기. 본문은 파일 바이트 그대로(Content-Type 상관없음), 이름은 ?name=으로 받는다.
   * 첨부 목록이 담긴 노트와 방금 올린 파일을 돌려준다.
   * @param id 노트 id
   */
  @Post('notes/:id/files')
  async addFile(@Param('id', ParseIntPipe) id: number, @Query('name', new ZodPipe(fileNameSchema)) name: string, @Req() req: Request) {
    return this.notes.addFile(id, name, await readUpload(req, MAX_FILE_BYTES));
  }

  /**
   * 첨부 파일 내용. 그림 블록과 화면 안 보기(PDF·md·텍스트·그림)는 inline, ?download=1이면 내려받기.
   * @param fileId 첨부 파일 id
   */
  @Get('notes/files/:fileId')
  async file(@Param('fileId', ParseIntPipe) fileId: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const { file, root } = await this.files.open(fileId);
    sendStoredFile(res, file, root, !!download);
  }

  /**
   * 첨부 하나 지우기. 첨부 목록을 담은 노트를 돌려준다.
   * @param fileId 첨부 파일 id
   */
  @Delete('notes/files/:fileId')
  removeFile(@Param('fileId', ParseIntPipe) fileId: number) {
    return this.notes.removeFile(fileId);
  }
}
