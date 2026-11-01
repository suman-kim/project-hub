import { HttpException, HttpStatus, Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { tokenMatches } from '../../common/token.guard';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { HubSetting } from '../settings/hub-setting.entity';

export const SESSION_COOKIE = 'hub_session';
const KEY = 'auth';
const MAX_TRIES = 5;
const LOCK_MS = 10 * 60_000;
export const REMEMBER_SECONDS = 30 * 86_400;

interface AuthState {
  /** scrypt(비밀번호, salt) hex. 아직 정하지 않았으면 null이고, 그동안은 Hub 토큰으로 들어온다 */
  passwordHash: string | null;
  salt: string;
  /** 세션 쿠키 서명 키. 비밀번호를 바꾸면 새로 만들어 모든 기기를 로그아웃시킨다 */
  secret: string;
  failed: number;
  lockedUntil: string | null;
}

/** 대시보드 로그인. hook·MCP·스크립트는 지금처럼 X-Hub-Token을 쓴다 */
@Injectable()
export class AuthService implements OnModuleInit {
  private state: AuthState;

  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    @InjectRepository(HubSetting) private readonly settings: Repository<HubSetting>,
  ) {}

  async onModuleInit(): Promise<void> {
    const row = await this.settings.findOneBy({ key: KEY });
    this.state = (row?.value as AuthState | undefined) ?? { passwordHash: null, salt: randomBytes(16).toString('hex'), secret: randomBytes(32).toString('hex'), failed: 0, lockedUntil: null };
    if (!row) await this.save();
  }

  get passwordSet(): boolean {
    return !!this.state.passwordHash;
  }

  /** 맞으면 쿠키 값을 돌려준다. 5번 틀리면 10분 잠근다 */
  async login(password: string, remember: boolean): Promise<{ cookie: string; maxAge: number | null }> {
    const lockedUntil = this.state.lockedUntil ? new Date(this.state.lockedUntil).getTime() : 0;
    if (lockedUntil > Date.now()) {
      const min = Math.ceil((lockedUntil - Date.now()) / 60_000);
      throw new HttpException(`5번 틀려서 로그인할 수 없어요 · ${min}분 뒤에 다시 시도하세요`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = this.state.passwordHash ? this.matches(password) : tokenMatches(this.config.token, password);
    if (!ok) {
      this.state.failed += 1;
      if (this.state.failed >= MAX_TRIES) {
        this.state.failed = 0;
        this.state.lockedUntil = new Date(Date.now() + LOCK_MS).toISOString();
        await this.save();
        throw new HttpException('5번 틀려서 10분 동안 로그인할 수 없어요', HttpStatus.TOO_MANY_REQUESTS);
      }
      await this.save();
      throw new UnauthorizedException(`비밀번호가 맞지 않아요 · ${MAX_TRIES - this.state.failed}번 남았어요`);
    }
    this.state.failed = 0;
    this.state.lockedUntil = null;
    await this.save();
    const maxAge = remember ? REMEMBER_SECONDS : null;
    // 쿠키를 저장하지 않는 세션 쿠키여도 서버 쪽 만료는 하루로 둔다.
    return { cookie: this.sign(Date.now() + (maxAge ?? 86_400) * 1000), maxAge };
  }

  async setPassword(password: string): Promise<void> {
    this.state.salt = randomBytes(16).toString('hex');
    this.state.passwordHash = scryptSync(password, this.state.salt, 32).toString('hex');
    this.state.secret = randomBytes(32).toString('hex');
    this.state.failed = 0;
    this.state.lockedUntil = null;
    await this.save();
  }

  /** Cookie 헤더에서 세션을 확인한다 */
  verifyCookieHeader(header: string | undefined): boolean {
    const value = header
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (!value) return false;
    const [payload, sig] = value.split('.');
    if (!payload || !sig) return false;
    const expected = this.hmac(payload);
    if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
    try {
      return (JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number }).exp > Date.now();
    } catch {
      return false;
    }
  }

  private matches(password: string): boolean {
    const given = scryptSync(password, this.state.salt, 32);
    const stored = Buffer.from(this.state.passwordHash!, 'hex');
    return given.length === stored.length && timingSafeEqual(given, stored);
  }

  private sign(exp: number): string {
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    return `${payload}.${this.hmac(payload)}`;
  }

  private hmac(payload: string): string {
    return createHmac('sha256', this.state.secret).update(payload).digest('base64url');
  }

  private async save(): Promise<void> {
    await this.settings.save({ key: KEY, value: this.state });
  }
}
