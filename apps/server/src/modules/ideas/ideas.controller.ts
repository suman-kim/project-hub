import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { IDEA_KINDS, IDEA_STATUSES } from '@hub/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { RunnerService } from '../runner/runner.service';
import { toAppDto } from '../apps/apps.service';
import { toTaskDto } from '../tasks/tasks.service';
import { IdeasService, toIdeaDto } from './ideas.service';

const listQuerySchema = z.object({
  app: z.string().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(IDEA_STATUSES)).optional()),
  kind: z.enum(IDEA_KINDS).optional(),
});
const reviseSchema = z.object({ note: z.string().min(1) });
const rejectSchema = z.object({ reason: z.string().min(1) });
const conceptSchema = z.object({ note: z.string().optional() }).optional();
const developSchema = z.object({ index: z.number().int().min(0) });
/** 새 앱 기획 승인 때 기획이 제안한 앱 코드·이름·폴더를 바꾼다 */
const approveSchema = z
  .object({ app: z.object({ code: z.string(), name: z.string(), folder: z.string() }).partial().optional() })
  .optional();

/** 기획 입구. 생성·수정은 runner에 run을 맡기고, 승인·반려는 기획 서비스가 처리한다. */
@Controller('api')
export class IdeasController {
  constructor(
    private readonly ideas: IdeasService,
    private readonly runner: RunnerService,
  ) {}

  @Get('ideas')
  async list(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return (await this.ideas.list(q)).map((i) => toIdeaDto(i));
  }

  @Get('ideas/:id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const idea = await this.ideas.get(id);
    const versions = await this.ideas.listVersions(id);
    const current = versions.find((v) => v.version === idea.currentVersion);
    return { ...toIdeaDto(idea, versions), estimate: current ? await this.ideas.estimate(current.body) : undefined };
  }

  /** 아이디어 즉시 생성. 만들어진 run을 돌려주고, 기획은 run이 끝나면 pending으로 생긴다. */
  @Post('apps/:id/ideas/generate')
  generate(@Param('id', ParseIntPipe) appId: number) {
    return this.runner.startIdeaGen(appId);
  }

  /** 새 앱 기획 즉시 생성. note는 이번 생성에만 덧붙이는 요청 */
  @Post('concepts/generate')
  generateConcept(@Body(new ZodPipe(conceptSchema)) body: z.infer<typeof conceptSchema>) {
    return this.runner.startConceptGen({ note: body?.note });
  }

  /** 새 앱 기획의 다른 후보(alternatives[index])를 깊게 기획한다. 새 기획으로 생긴다. */
  @Post('ideas/:id/develop')
  async develop(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(developSchema)) body: z.infer<typeof developSchema>) {
    const idea = await this.ideas.get(id);
    const alt = (await this.ideas.currentVersion(idea)).body.concept?.alternatives[body.index];
    if (!alt) throw new NotFoundException(`기획 ${id}에 ${body.index}번 후보가 없다`);
    return this.runner.startConceptGen({ seed: { ...alt, fromIdeaId: idea.id } });
  }

  /**
   * 승인. 기능 기획은 task를 만든다.
   * 새 앱 기획은 앱을 등록하고 task를 만든 뒤, 폴더·GitHub 저장소·claude --rc 세션을 여는 run을 돌려준다.
   */
  @Post('ideas/:id/approve')
  async approve(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(approveSchema)) body: z.infer<typeof approveSchema>) {
    const target = await this.ideas.get(id);
    if (target.kind === 'app') {
      const { idea, app, tasks, run } = await this.runner.approveConcept(id, body?.app);
      return { idea: toIdeaDto(idea), app: toAppDto(app), tasks: tasks.map((t) => toTaskDto(t, app.code)), run };
    }
    const { idea, tasks } = await this.ideas.approve(id);
    return { idea: toIdeaDto(idea), tasks: tasks.map((t) => toTaskDto(t, idea.app.code)) };
  }

  /** 수정 요청: 다음 버전을 만드는 run을 돌려준다. */
  @Post('ideas/:id/revise')
  async revise(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(reviseSchema)) body: z.infer<typeof reviseSchema>) {
    const idea = await this.ideas.get(id);
    if (idea.kind === 'app') return this.runner.startConceptGen({ ideaId: id, note: body.note });
    return this.runner.startIdeaGen(idea.appId!, { ideaId: id, note: body.note });
  }

  /** 새 앱 시작 단계(폴더, 저장소, 세션)를 다시 돌린다. 이미 끝난 단계는 건너뛴다. */
  @Post('apps/:id/bootstrap')
  retryBootstrap(@Param('id', ParseIntPipe) appId: number) {
    return this.runner.retryBootstrap(appId);
  }

  @Post('ideas/:id/reject')
  async reject(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return toIdeaDto(await this.ideas.reject(id, body.reason));
  }
}
