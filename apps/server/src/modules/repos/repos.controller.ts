import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { DEPLOY_ENVS } from '@hub/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AppsService } from '../apps/apps.service';
import { SettingsService } from '../settings/settings.service';
import { run } from '../runner/git';
import { projectCandidates } from './detect';
import { ReposService, toRepoDto } from './repos.service';

const repoSchema = z.object({
  name: z.string().trim().min(1),
  path: z.string().startsWith('/', '절대 경로여야 합니다'),
  github: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/repo').nullable(),
  defaultBranch: z.string().min(1),
  setupCmd: z.string().nullable(),
  checkCmd: z.string().nullable(),
  deployRules: z.array(z.object({ workflow: z.string().min(1), env: z.enum(DEPLOY_ENVS) })),
});
const createSchema = repoSchema.partial().required({ path: true });
const updateSchema = repoSchema.omit({ path: true }).partial();

@Controller('api')
export class ReposController {
  constructor(
    private readonly repos: ReposService,
    private readonly apps: AppsService,
    private readonly settings: SettingsService,
  ) {}

  /** 앱 등록 창의 프로젝트 폴더 목록: 새 앱 폴더 위치 바로 아래의 git 프로젝트와 각 저장소의 GitHub·기본 브랜치 */
  @Get('project-candidates')
  async candidates() {
    const root = (await this.settings.ideation()).projectRoot;
    const apps = await this.apps.list();
    return projectCandidates(root, (args, cwd) => run('git', args, cwd, 10_000), (path) => apps.find((a) => a.repoPath?.replace(/\/$/, '') === path)?.code ?? null);
  }

  @Get('apps/:id/repos')
  async list(@Param('id', ParseIntPipe) id: number) {
    const app = await this.apps.get(id);
    return (await this.repos.list(app.id)).map((r) => toRepoDto(r, app.code));
  }

  /** 앱 폴더에서 git 저장소를 다시 찾아, 새로 생긴 것만 더한다 */
  @Post('apps/:id/repos/detect')
  async detect(@Param('id', ParseIntPipe) id: number) {
    const app = await this.apps.get(id);
    return (await this.repos.detect(app)).map((r) => toRepoDto(r, app.code));
  }

  @Post('apps/:id/repos')
  async create(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    const app = await this.apps.get(id);
    return toRepoDto(await this.repos.create(app, body), app.code);
  }

  @Patch('repos/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const r = await this.repos.update(id, body);
    return toRepoDto(r, (await this.apps.get(r.appId)).code);
  }

  @Delete('repos/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.repos.remove(id);
  }
}
