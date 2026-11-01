import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/public.decorator';
import { tokenMatches } from '../../common/token.guard';
import { ZodPipe } from '../../common/zod.pipe';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AuthService, SESSION_COOKIE } from './auth.service';

const loginSchema = z.object({ password: z.string().min(1, '비밀번호를 입력하세요'), remember: z.boolean().default(true) });
const passwordSchema = z.object({ password: z.string().min(4, '비밀번호는 4자 이상') });

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
  ) {}

  /** 비밀번호를 아직 정하지 않았으면 Hub 토큰(~/.claude/hub-token)으로 들어온다 */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const { cookie, maxAge } = await this.auth.login(body.password, body.remember);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${cookie}; HttpOnly; SameSite=Strict; Path=/${maxAge ? `; Max-Age=${maxAge}` : ''}`);
    return { ok: true, remember: !!maxAge };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }

  @Public()
  @Get('me')
  me(@Req() req: Request) {
    const loggedIn = this.auth.verifyCookieHeader(req.headers.cookie) || tokenMatches(this.config.token, req.headers['x-hub-token']);
    return { loggedIn, passwordSet: this.auth.passwordSet };
  }

  /** 비밀번호 정하기·바꾸기. 바꾸면 모든 기기가 로그아웃된다 */
  @Put('password')
  @HttpCode(204)
  async setPassword(@Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    await this.auth.setPassword(body.password);
  }
}
