import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { HUB_CONFIG, HubConfig } from '../config/hub-config';
import { AuthService } from '../modules/auth/auth.service';
import { IS_PUBLIC } from './public.decorator';

export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Origin이 없거나(같은 출처 요청) 요청을 받은 Hub 주소와 같으면 통과 */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  return !!host && origin === `http://${host}`;
}

@Injectable()
export class TokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly auth: AuthService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (tokenMatches(this.config.token, req.headers['x-hub-token'])) return true;
    if (this.auth.verifyCookieHeader(req.headers.cookie)) {
      // 쿠키는 브라우저가 알아서 붙이므로, 데이터를 바꾸는 요청은 Hub 화면에서 온 것인지 확인한다.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req.headers.origin, req.headers.host)) {
        throw new ForbiddenException('다른 사이트에서 온 요청이라 막았다');
      }
      return true;
    }
    throw new UnauthorizedException('로그인하거나 X-Hub-Token을 보내야 한다');
  }
}
