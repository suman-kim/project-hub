import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RUN_STATUSES } from '@hub/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { RunnerService } from './runner.service';

const answerSchema = z.object({ answer: z.string().min(1) });
const resumeSchema = z.object({ message: z.string().trim().min(1).max(8000), taskId: z.string().optional(), force: z.boolean().optional() });
const logsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  /** 마지막 N줄만 (오늘 화면의 "마지막 로그 한 줄") */
  tail: z.coerce.number().int().min(1).max(200).optional(),
});
const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(RUN_STATUSES)).optional()),
  app: z.string().optional(),
  kind: z.enum(['implement', 'idea_gen', 'bootstrap', 'session']).optional(),
  /** true면 task마다 가장 최근 run만 */
  latest: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@Controller('api')
export class RunsController {
  constructor(private readonly runner: RunnerService) {}

  /** run을 만들고 큐에 넣는다. worktree 생성부터 PR까지 큐 작업이 처리한다. */
  @Post('tasks/:id/run')
  startRun(@Param('id') id: string) {
    return this.runner.startTaskRun(id);
  }

  /** 세션 이어서 하기: 끝났거나 닫은 세션을 claude --resume으로 이어 받아 메시지를 처리하는 run */
  @Post('sessions/:id/resume')
  resumeSession(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(resumeSchema)) body: z.infer<typeof resumeSchema>) {
    return this.runner.startSessionRun(id, body);
  }

  /**
   * 세션 종료. Hub가 돌리는 run(구현·기획·이어서 하기)이면 run을 중지해 실제로 끝낸다.
   * 터미널에서 연 세션은 Hub가 프로세스를 끌 수 없으므로 끝난 것으로 표시만 한다(열린 목록에서 내린다).
   */
  @Post('sessions/:id/end')
  endSession(@Param('id', ParseIntPipe) id: number) {
    return this.runner.endSession(id);
  }

  @Get('tasks/:id/runs')
  listRuns(@Param('id') id: string) {
    return this.runner.listForTask(id);
  }

  /** 실행 기록 화면과 오늘 화면: 상태·앱·종류로 거른 전체 run */
  @Get('runs')
  list(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.runner.list(q);
  }

  /** 가장 최근 run이 받은 사용량 */
  @Get('usage')
  usage() {
    return this.runner.usage();
  }

  @Get('runs/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.runner.get(id);
  }

  @Get('runs/:id/logs')
  logs(@Param('id', ParseIntPipe) id: number, @Query(new ZodPipe(logsQuerySchema)) q: z.infer<typeof logsQuerySchema>) {
    return q.tail ? this.runner.logsTail(id, q.tail) : this.runner.logsAfter(id, q.after, q.limit);
  }

  @Post('runs/:id/answer')
  answer(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(answerSchema)) body: z.infer<typeof answerSchema>) {
    return this.runner.answer(id, body.answer);
  }

  @Post('runs/:id/stop')
  stop(@Param('id', ParseIntPipe) id: number) {
    return this.runner.stop(id);
  }
}
