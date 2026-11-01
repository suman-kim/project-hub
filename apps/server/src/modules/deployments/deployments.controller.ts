import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DEPLOY_ENVS, DEPLOY_STATUSES } from '@hub/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AppsService } from '../apps/apps.service';
import { DeploymentsService, toDeploymentDto } from './deployments.service';
import { GithubSyncService } from './github-sync.service';

const listSchema = z.object({
  env: z.enum(DEPLOY_ENVS).optional(),
  repoId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const inputSchema = z.object({
  env: z.enum(DEPLOY_ENVS),
  status: z.enum(DEPLOY_STATUSES),
  environment: z.string().min(1).optional(),
  version: z.string().nullable().optional(),
  sha: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  repoId: z.number().int().nullable().optional(),
});

@Controller('api')
export class DeploymentsController {
  constructor(
    private readonly deployments: DeploymentsService,
    private readonly apps: AppsService,
    private readonly github: GithubSyncService,
  ) {}

  /** GitHub에서 지금 바로 가져온다 (평소에는 5분마다) */
  @Post('deployments/sync')
  sync() {
    return this.github.syncAll();
  }

  @Get('apps/:id/deployments')
  async list(@Param('id', ParseIntPipe) id: number, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const app = await this.apps.get(id);
    return (await this.deployments.list(app.id, q)).map((d) => toDeploymentDto(d, app.code));
  }

  /** 직접 남기는 배포. GitHub에 남지 않는 스토어 제출 같은 것 */
  @Post('apps/:id/deployments')
  async record(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(inputSchema)) body: z.infer<typeof inputSchema>) {
    const app = await this.apps.get(id);
    return toDeploymentDto(await this.deployments.record(app, body, 'me'), app.code);
  }

  @Patch('deployments/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(inputSchema.partial())) body: Partial<z.infer<typeof inputSchema>>) {
    const d = await this.deployments.get(id);
    const app = await this.apps.get(d.appId);
    return toDeploymentDto(await this.deployments.update(id, app.code, body, 'me'), app.code);
  }
}
