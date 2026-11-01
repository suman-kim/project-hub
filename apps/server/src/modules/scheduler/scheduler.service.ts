import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { AppDto } from '@hub/shared';
import { AppsService, toAppDto } from '../apps/apps.service';
import { HubEventsService } from '../realtime/hub-events.service';
import { RunQueueService } from '../runner/run-queue.service';
import { RunnerService } from '../runner/runner.service';
import { IDEATION_KEY, SettingsService } from '../settings/settings.service';

const PREFIX = 'idea-cron-';
/** 새 앱 기획 자동 생성 (설정 ideation.cron) */
export const CONCEPT_CRON = 'concept-cron';

export function cronQueueName(appCode: string): string {
  return `${PREFIX}${appCode.toLowerCase()}`;
}

/** 앱별 아이디어 생성 주기(apps.idea_cron)와 새 앱 기획 주기(설정)를 pg-boss schedule로 등록한다. */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Scheduler');

  constructor(
    private readonly apps: AppsService,
    private readonly queue: RunQueueService,
    private readonly runner: RunnerService,
    private readonly settings: SettingsService,
    events: HubEventsService,
  ) {
    // 앱 설정이 바뀌면 그 앱의 schedule만 다시 맞춘다.
    events.on('app.updated', ({ app }) => void this.sync(app));
    events.on('settings.updated', ({ key }) => {
      if (key === IDEATION_KEY) void this.syncConcept();
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    const apps = (await this.apps.list()).map(toAppDto);
    for (const app of apps) await this.sync(app);
    // 지워진 앱이나 코드가 바뀐 앱의 schedule은 내린다.
    const wanted = new Set(apps.filter((a) => a.ideaCron).map((a) => cronQueueName(a.code)));
    for (const name of await this.queue.scheduledNames()) {
      if (name.startsWith(PREFIX) && !wanted.has(name)) await this.queue.unschedule(name);
    }
    await this.syncConcept();
  }

  async syncConcept(): Promise<void> {
    const { cron } = await this.settings.ideation();
    try {
      if (cron) {
        await this.queue.schedule(CONCEPT_CRON, cron, {}, async () => {
          await this.fireConcept();
        });
        this.logger.log(`새 앱 기획 생성 주기: ${cron}`);
      } else if ((await this.queue.scheduledNames()).includes(CONCEPT_CRON)) {
        await this.queue.unschedule(CONCEPT_CRON);
        this.logger.log('새 앱 기획 생성 주기 해제');
      }
    } catch (e) {
      this.logger.error(`새 앱 기획 schedule 등록 실패 (${cron}): ${(e as Error).message}`);
    }
  }

  /** 새 앱 기획 cron. 앱 기획과 같은 사용량 기준으로 건너뛴다. */
  async fireConcept(): Promise<'started' | 'skipped_usage' | 'skipped_busy'> {
    if (await this.runner.usageHigh()) {
      this.logger.warn('새 앱 기획 자동 생성 건너뜀: 사용량이 한도의 80%를 넘었다');
      return 'skipped_usage';
    }
    try {
      await this.runner.startConceptGen({ auto: true });
      return 'started';
    } catch (e) {
      this.logger.warn(`새 앱 기획 자동 생성 건너뜀: ${(e as Error).message}`);
      return 'skipped_busy';
    }
  }

  async sync(app: AppDto): Promise<void> {
    const name = cronQueueName(app.code);
    try {
      if (app.ideaCron) {
        await this.queue.schedule(name, app.ideaCron, { appId: app.id }, async (data) => {
          await this.fire(data.appId);
        });
        this.logger.log(`${app.code} 아이디어 생성 주기: ${app.ideaCron}`);
      } else if ((await this.queue.scheduledNames()).includes(name)) {
        await this.queue.unschedule(name);
        this.logger.log(`${app.code} 아이디어 생성 주기 해제`);
      }
    } catch (e) {
      this.logger.error(`${app.code} schedule 등록 실패 (${app.ideaCron}): ${(e as Error).message}`);
    }
  }

  /** cron이 울리면 부른다. 사용량이 한도의 80%를 넘었거나 이미 생성 중이면 건너뛴다. */
  async fire(appId: number): Promise<'started' | 'skipped_usage' | 'skipped_busy'> {
    if (await this.runner.usageHigh()) {
      this.logger.warn(`앱 ${appId} 자동 생성 건너뜀: 사용량이 한도의 80%를 넘었다`);
      return 'skipped_usage';
    }
    try {
      await this.runner.startIdeaGen(appId, { auto: true });
      return 'started';
    } catch (e) {
      this.logger.warn(`앱 ${appId} 자동 생성 건너뜀: ${(e as Error).message}`);
      return 'skipped_busy';
    }
  }
}
