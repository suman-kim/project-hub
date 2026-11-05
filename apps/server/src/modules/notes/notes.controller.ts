import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { NOTE_LIMITS, NotesService } from './notes.service';

const patchSchema = z.object({
  folder: z.string().max(NOTE_LIMITS.folder).optional(),
  title: z.string().max(NOTE_LIMITS.title).optional(),
  body: z.string().max(NOTE_LIMITS.body).optional(),
  pinned: z.boolean().optional(),
});
type NoteBody = z.infer<typeof patchSchema>;

/** 노트: 목록·만들기는 앱 아래(앱 노트)나 내 업무 아래(공통 노트), 고치기·지우기는 노트 id로 */
@Controller('api')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

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
}
