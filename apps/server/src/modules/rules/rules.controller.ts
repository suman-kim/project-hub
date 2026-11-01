import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { ClaudeMdService } from './claude-md.service';
import { RulesService, toRuleDto } from './rules.service';

const putRulesSchema = z.object({
  rules: z.array(
    z.object({
      /** 생략하면 전역 규칙 */
      app: z.string().regex(/^[A-Z]{2,4}$/).nullable().optional(),
      body: z.string().trim().min(1),
    }),
  ),
});

const putClaudeMdSchema = z.object({ text: z.string().max(200_000), version: z.string().min(1) });

@Controller('api/rules')
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly claudeMd: ClaudeMdService,
  ) {}

  /** 규칙 화면의 CLAUDE.md 칸: 전역과 앱·저장소 폴더의 CLAUDE.md */
  @Get('claude-md')
  claudeMdList() {
    return this.claudeMd.list();
  }

  @Get('claude-md/:key')
  claudeMdRead(@Param('key') key: string) {
    return this.claudeMd.read(key);
  }

  /** 파일이 원본이다. 읽을 때 받은 version과 지금 내용이 다르면 409 */
  @Put('claude-md/:key')
  claudeMdWrite(@Param('key') key: string, @Body(new ZodPipe(putClaudeMdSchema)) body: z.infer<typeof putClaudeMdSchema>) {
    return this.claudeMd.write(key, body.text, body.version);
  }

  @Get()
  async list() {
    return { file: this.rules.filePath, rules: (await this.rules.list()).map(toRuleDto) };
  }

  /** 규칙 전체를 바꾸고 ~/.claude/rules/hub-rules.md로 내보낸다. 새 세션부터 적용된다. */
  @Put()
  async replace(@Body(new ZodPipe(putRulesSchema)) body: z.infer<typeof putRulesSchema>) {
    const saved = await this.rules.replaceAll(body.rules.map((r) => ({ appCode: r.app ?? null, body: r.body })));
    return { file: this.rules.filePath, rules: saved.map(toRuleDto) };
  }
}
