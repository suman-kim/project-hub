import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { MY_DOC_KINDS, MY_DOC_RENEWS, MY_SECRET_MODES } from '@hub/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { contentDisposition, contentTypeOf, MAX_FILE_BYTES, readUpload } from './doc-files';
import { DocFilesService } from './doc-files.service';
import { MineService } from './mine.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const addTodoSchema = z.object({ title: z.string().trim().min(1).max(500), parentId: z.number().int().nullable().optional() });
const todoPatchSchema = z.object({
  title: z.string().max(500).optional(),
  dueDate: date.optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  done: z.boolean().optional(),
  docId: z.number().int().nullable().optional(),
});
const addDocSchema = z.object({ kind: z.enum(MY_DOC_KINDS), title: z.string().trim().min(1).max(300) });
const docPatchSchema = z.object({
  kind: z.enum(MY_DOC_KINDS).optional(),
  title: z.string().max(300).optional(),
  fields: z.array(z.tuple([z.string().max(200), z.string().max(2000)])).max(50).optional(),
  secretMode: z.enum(MY_SECRET_MODES).optional(),
  secretRef: z.string().max(1000).optional(),
  expiresOn: date.optional(),
  renewLabel: z.enum(MY_DOC_RENEWS).optional(),
  memo: z.string().max(20000).optional(),
});
const secretSchema = z.object({ value: z.string().max(10000) });
const fileNameSchema = z.string().trim().min(1, '파일 이름(name)이 필요하다').max(1000);

/** 내 업무 화면: 앱에 묶이지 않는 내 할 일과 문서. 키 값 원문은 secret 엔드포인트로만 오간다 */
@Controller('api/mine')
export class MineController {
  constructor(
    private readonly mine: MineService,
    private readonly files: DocFilesService,
  ) {}

  @Get()
  all() {
    return this.mine.all();
  }

  @Post('todos')
  addTodo(@Body(new ZodPipe(addTodoSchema)) body: z.infer<typeof addTodoSchema>) {
    return this.mine.addTodo(body.title, body.parentId ?? null);
  }

  @Patch('todos/:id')
  updateTodo(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(todoPatchSchema)) body: z.infer<typeof todoPatchSchema>) {
    return this.mine.updateTodo(id, body);
  }

  @Delete('todos/:id')
  @HttpCode(204)
  async deleteTodo(@Param('id', ParseIntPipe) id: number) {
    await this.mine.deleteTodo(id);
  }

  @Post('docs')
  addDoc(@Body(new ZodPipe(addDocSchema)) body: z.infer<typeof addDocSchema>) {
    return this.mine.addDoc(body.kind, body.title);
  }

  @Patch('docs/:id')
  updateDoc(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(docPatchSchema)) body: z.infer<typeof docPatchSchema>) {
    return this.mine.updateDoc(id, body);
  }

  @Delete('docs/:id')
  @HttpCode(204)
  async deleteDoc(@Param('id', ParseIntPipe) id: number) {
    await this.mine.deleteDoc(id);
  }

  /** 보기·복사를 누를 때만 부른다 */
  @Get('docs/:id/secret')
  getSecret(@Param('id', ParseIntPipe) id: number) {
    return this.mine.getSecret(id);
  }

  @Put('docs/:id/secret')
  setSecret(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(secretSchema)) body: z.infer<typeof secretSchema>) {
    return this.mine.setSecret(id, body.value);
  }

  /**
   * 첨부 파일 올리기. 본문은 파일 바이트 그대로(Content-Type 상관없음), 이름은 ?name=으로 받는다.
   * 첨부 목록을 담은 문서를 돌려준다.
   */
  @Post('docs/:id/files')
  async addFile(@Param('id', ParseIntPipe) id: number, @Query('name', new ZodPipe(fileNameSchema)) name: string, @Req() req: Request) {
    await this.files.add(id, name, await readUpload(req, MAX_FILE_BYTES));
    return this.mine.docDto(id);
  }

  /**
   * 첨부 파일 내용. 화면 안 보기(PDF·md·텍스트·그림)는 inline, ?download=1이면 내려받기.
   * 대시보드와 같은 출처라서, 열리는 파일이 스크립트를 돌리지 못하게 PDF 밖에는 CSP sandbox를 건다.
   */
  @Get('files/:fileId')
  async file(@Param('fileId', ParseIntPipe) fileId: number, @Query('download') download: string | undefined, @Res() res: Response) {
    const { file, root } = await this.files.open(fileId);
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

  /** 첨부 하나 지우기. 첨부 목록을 담은 문서를 돌려준다 */
  @Delete('files/:fileId')
  async deleteFile(@Param('fileId', ParseIntPipe) fileId: number) {
    return this.mine.docDto(await this.files.remove(fileId));
  }
}
