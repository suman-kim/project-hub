import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { SessionsService } from './sessions.service';
import { TranscriptService } from './transcript.service';

const chatQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(2000).default(300) });
/** task 정보 글(최대 8000자)에 덧붙여 쓸 여유를 둔다 */
const messageSchema = z.object({ text: z.string().trim().min(1).max(10000) });

@Controller('api/sessions')
export class SessionsController {
  constructor(
    private readonly transcripts: TranscriptService,
    private readonly sessions: SessionsService,
  ) {}

  /** 세션 메뉴: 모든 앱(앱이 없는 폴더 포함)의 세션 중 7일 안에 활동한 것. 앱 거르기는 화면에서 한다 */
  @Get()
  list() {
    return this.sessions.views({ limit: 300 });
  }

  /**
   * 일하는 중인 세션에 보낼 메시지. 다음 hook(도구 사용 뒤, 턴 끝, 다음 입력)에 실려 전달된다.
   * 끝난 세션에는 전달할 hook이 오지 않으므로 거부한다(이어서 하기를 쓴다).
   */
  @Post(':id/messages')
  async message(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(messageSchema)) body: z.infer<typeof messageSchema>) {
    const [view] = await this.sessions.views({ sessionId: id });
    if (!view) throw new NotFoundException(`세션 ${id}이 없다`);
    if (!view.open) throw new ConflictException('끝난 세션이라 메시지를 전달할 수 없다. 이어서 하기를 쓴다');
    const session = (await this.sessions.findById(id))!;
    const m = await this.sessions.addMessage(session, body.text, view.appCode);
    return { id: m.id, createdAt: m.createdAt.toISOString() };
  }

  /** 전달 대기 중인 메시지 보내기 취소. 이미 전달된 메시지는 409 */
  @Delete(':id/messages/:mid')
  @HttpCode(204)
  async cancel(@Param('id', ParseIntPipe) id: number, @Param('mid', ParseIntPipe) mid: number) {
    if (!(await this.sessions.cancelMessage(id, mid))) throw new ConflictException('이미 전달됐거나 없는 메시지다');
  }

  /** 세션 탭의 대화 보기: 대화 기록을 대화 화면 줄로. 긴 대화는 뒤에서부터 limit개 */
  @Get(':id/chat')
  chat(@Param('id', ParseIntPipe) id: number, @Query(new ZodPipe(chatQuerySchema)) q: z.infer<typeof chatQuerySchema>) {
    return this.transcripts.chat(id, q.limit);
  }
}
