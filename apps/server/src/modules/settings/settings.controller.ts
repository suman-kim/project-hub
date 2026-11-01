import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { SESSION_PERMISSION_MODES } from '@hub/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { SettingsService } from './settings.service';

const ideationSchema = z
  .object({
    directionNote: z.string().nullable(),
    cron: z
      .string()
      .regex(/^\S+(\s+\S+){4}$/, 'cron은 "분 시 일 월 요일" 5필드')
      .nullable(),
    projectRoot: z.string().startsWith('/', '절대 경로여야 합니다'),
    githubOwner: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, 'GitHub 사용자나 조직 이름')
      .nullable(),
    sessionPermissionMode: z.enum(SESSION_PERMISSION_MODES),
  })
  .partial();

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** 허용 도구 기본 목록, worktree 기본 위치 */
  @Get('defaults')
  defaults() {
    return this.settings.defaults();
  }

  @Get('ideation')
  ideation() {
    return this.settings.ideation();
  }

  /** 새 앱 기획의 방향 메모, 자동 생성 주기, 폴더 위치, GitHub 소유자, 시작 세션 권한 모드 */
  @Patch('ideation')
  updateIdeation(@Body(new ZodPipe(ideationSchema)) body: z.infer<typeof ideationSchema>) {
    return this.settings.updateIdeation(body);
  }
}
