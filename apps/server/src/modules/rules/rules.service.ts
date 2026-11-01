import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import type { RuleDto } from '@hub/shared';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AppsService } from '../apps/apps.service';
import { Rule } from './rule.entity';
import { parseRulesFile, renderRulesFile, RuleItem } from './rules-file';

export function toRuleDto(r: Rule): RuleDto {
  return { id: r.id, scope: r.scope, appCode: r.app?.code ?? null, position: r.position, body: r.body };
}

@Injectable()
export class RulesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Rules');

  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    @InjectRepository(Rule) private readonly rules: Repository<Rule>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly apps: AppsService,
  ) {}

  get filePath(): string {
    return join(this.config.claudeHome, 'rules', 'hub-rules.md');
  }

  /** 처음 뜰 때 DB가 비어 있으면 기존 파일의 규칙을 가져온다. 파일은 건드리지 않는다. */
  async onApplicationBootstrap(): Promise<void> {
    if ((await this.rules.count()) > 0 || !existsSync(this.filePath)) return;
    const items = parseRulesFile(readFileSync(this.filePath, 'utf8'));
    if (!items.length) return;
    const known = new Set((await this.apps.list()).map((a) => a.code));
    await this.save(items.filter((i) => !i.appCode || known.has(i.appCode)));
    this.logger.log(`기존 ${this.filePath}에서 규칙 ${items.length}개를 가져왔다`);
  }

  list(): Promise<Rule[]> {
    return this.rules.find({ relations: { app: true }, order: { scope: 'DESC', appId: 'ASC', position: 'ASC' } });
  }

  /** 규칙 전체를 바꾸고 파일로 내보낸다. */
  async replaceAll(items: RuleItem[]): Promise<Rule[]> {
    await this.save(items);
    await this.exportFile();
    return this.list();
  }

  /** 임시 파일에 쓴 뒤 rename해서, 세션이 읽는 도중에 반쯤 쓴 파일을 보지 않게 한다. */
  async exportFile(): Promise<string> {
    const rules = await this.list();
    const appNames = new Map((await this.apps.list()).map((a) => [a.code, a.name]));
    const text = renderRulesFile(
      rules.map((r) => ({ appCode: r.app?.code ?? null, body: r.body })),
      appNames,
    );
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, text, { mode: 0o644 });
    renameSync(tmp, this.filePath);
    return text;
  }

  private async save(items: RuleItem[]): Promise<void> {
    const apps = new Map((await this.apps.list()).map((a) => [a.code, a.id]));
    for (const i of items) {
      if (i.appCode && !apps.has(i.appCode)) throw new BadRequestException(`앱 ${i.appCode}가 없다`);
    }
    const position = new Map<string, number>();
    await this.ds.transaction(async (em) => {
      await em.clear(Rule);
      await em.save(
        Rule,
        items.map((i) => {
          const key = i.appCode ?? '';
          position.set(key, (position.get(key) ?? 0) + 1);
          return em.create(Rule, {
            scope: i.appCode ? 'app' : 'global',
            appId: i.appCode ? apps.get(i.appCode)! : null,
            position: position.get(key)!,
            body: i.body.trim(),
          });
        }),
      );
    });
  }
}
