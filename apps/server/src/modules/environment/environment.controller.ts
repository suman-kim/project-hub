import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { EnvironmentService } from './environment.service';

/** 환경 화면: 이 맥북에 설치된 스킬·플러그인과 연결된 커넥터·MCP 서버 */
@Controller('api/environment')
export class EnvironmentController {
  constructor(private readonly env: EnvironmentService) {}

  @Get()
  scan() {
    return this.env.scan();
  }

  /** 마지막 연결 확인 결과. 처음 부르면 확인을 시작하고 running: true를 돌려준다 */
  @Get('mcp')
  mcp() {
    return this.env.mcpState();
  }

  /** 한국어 요약 만들기 진행 상황. 만드는 일은 GET /api/environment가 시작한다 */
  @Get('ko')
  ko() {
    return this.env.koState();
  }

  /** 연결 상태를 다시 확인한다(30초쯤). 끝날 때까지 기다리지 않고 running 상태를 돌려준다 */
  @Post('mcp/check')
  @HttpCode(202)
  check() {
    void this.env.checkMcp();
    return this.env.mcpState();
  }
}
