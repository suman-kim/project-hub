import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { ActivitiesService } from './activities.service';

const listSchema = z.object({
  app: z.string().optional(),
  /** task, run, idea, app, deploy, note처럼 앞부분이나 kind 전체. 쉼표로 여러 개 */
  kind: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined)),
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const noteSchema = z.object({ summary: z.string().trim().min(1) });

@Controller('api')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  /** 히스토리. app을 빼면 모든 앱 */
  @Get('activities')
  async list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const appId = q.app ? await this.activities.appIdOf(q.app) : undefined;
    return this.activities.list({ appId, kinds: q.kind, before: q.before, limit: q.limit });
  }

  /** 직접 남기는 메모 */
  @Post('apps/:id/activities')
  async note(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    const appId = await this.activities.appIdOf(id);
    await this.activities.record({ appId, kind: 'note', actor: 'me', summary: body.summary });
    return (await this.activities.list({ appId, limit: 1 }))[0];
  }
}
