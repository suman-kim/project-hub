import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { CostsService, currentMonth } from './costs.service';

const summarySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식이어야 합니다').optional() });
const monthlySchema = z.object({ limit: z.coerce.number().int().min(1).max(60).default(12) });

@Controller('api/costs')
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  /** 한 달 비용 합계와 앱·종류·날짜별 내역. month를 빼면 이번 달 */
  @Get()
  summary(@Query(new ZodPipe(summarySchema)) q: z.infer<typeof summarySchema>) {
    return this.costs.summary(q.month ?? currentMonth());
  }

  @Get('monthly')
  monthly(@Query(new ZodPipe(monthlySchema)) q: z.infer<typeof monthlySchema>) {
    return this.costs.monthly(q.limit);
  }
}
