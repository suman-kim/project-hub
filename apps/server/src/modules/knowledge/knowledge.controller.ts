import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { AppsService } from '../apps/apps.service';
import { ReposService } from '../repos/repos.service';
import { TasksService } from '../tasks/tasks.service';
import { KnowledgeService, toMistakeDto, toSpecDto } from './knowledge.service';
import { renderTaskBrief } from './task-brief';

const mistakesQuerySchema = z.object({ app: z.string().min(1) });
const mistakePatchSchema = z.object({ active: z.boolean() });
const specsQuerySchema = z.object({ task: z.string().optional(), idea: z.coerce.number().int().optional() });

/** 앱 설정의 실수 기록 칸과 task·기획 상세의 문서 칸 */
@Controller('api')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly apps: AppsService,
    private readonly tasks: TasksService,
    private readonly repos: ReposService,
  ) {}

  /** task 전체 정보 글: task 패널의 "task 정보 복사"와 "이 세션에서 진행하기"가 쓴다 */
  @Get('tasks/:id/brief')
  async brief(@Param('id') id: string) {
    const task = await this.tasks.get(id);
    const repos = task.repoId ? [await this.repos.get(task.repoId)] : await this.repos.list(task.appId);
    const deps = (await Promise.all(task.dependsOn.map((d) => this.tasks.find(d)))).filter((d) => !!d);
    const specs = await this.knowledge.specsFor({ taskId: task.id });
    const text = renderTaskBrief({
      task,
      repo: repos.length === 1 ? { name: repos[0].name, path: repos[0].path } : null,
      deps: deps.map((d) => ({ id: d.id, title: d.title, status: d.status })),
      specs,
    });
    return { taskId: task.id, text };
  }

  @Get('mistakes')
  async mistakes(@Query(new ZodPipe(mistakesQuerySchema)) q: z.infer<typeof mistakesQuerySchema>) {
    const app = await this.apps.getByCode(q.app);
    return (await this.knowledge.listMistakes(app.id)).map((m) => toMistakeDto(m, app.code));
  }

  @Patch('mistakes/:id')
  async setMistake(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(mistakePatchSchema)) body: z.infer<typeof mistakePatchSchema>) {
    const m = await this.knowledge.setMistakeActive(id, body.active);
    return toMistakeDto(m, m.app.code);
  }

  @Get('specs')
  async specs(@Query(new ZodPipe(specsQuerySchema)) q: z.infer<typeof specsQuerySchema>) {
    return (await this.knowledge.specsFor({ taskId: q.task, ideaId: q.idea })).map(toSpecDto);
  }

  @Get('specs/:id')
  async spec(@Param('id', ParseIntPipe) id: number) {
    return toSpecDto(await this.knowledge.getSpec(id));
  }
}
