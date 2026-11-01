import { Controller, Get } from '@nestjs/common';
import { Public } from './common/public.decorator';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }
}
