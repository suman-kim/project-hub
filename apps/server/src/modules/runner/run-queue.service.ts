import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { HUB_CONFIG, HUB_TIMEZONE, HubConfig } from '../../config/hub-config';

export const RUN_QUEUE = 'run';

export interface RunJob {
  runId: number;
  /** start: 구현 시작, resume: 답변 받아 재개, idea: 기획 생성·수정, bootstrap: 새 앱 시작 */
  mode: 'start' | 'resume' | 'idea' | 'bootstrap';
  answer?: string;
}

/**
 * Postgres 위의 작업 큐 (pg-boss). Redis 없이 재시도, 동시 실행 제한, cron을 처리한다.
 * 다른 provider의 onApplicationBootstrap보다 먼저 준비되도록 onModuleInit에서 시작한다.
 */
@Injectable()
export class RunQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('RunQueue');
  private boss: PgBoss;
  private readonly queues = new Set<string>();

  constructor(@Inject(HUB_CONFIG) private readonly config: HubConfig) {}

  async onModuleInit(): Promise<void> {
    this.boss = new PgBoss({ connectionString: this.config.databaseUrl, schema: 'pgboss' });
    this.boss.on('error', (e) => this.logger.error(e));
    await this.boss.start();
    // 구현 run은 몇십 분이 걸릴 수 있다. 실패한 run을 큐가 다시 돌리지 않게 재시도는 끈다.
    await this.ensureQueue(RUN_QUEUE, 4 * 60 * 60);
  }

  /** run 큐 worker. pg-boss 10은 work()마다 batchSize개를 꺼내므로 worker를 concurrency개 띄운다. */
  async workRuns(handler: (job: RunJob) => Promise<void>): Promise<void> {
    for (let i = 0; i < this.config.runner.concurrency; i += 1) {
      await this.boss.work<RunJob>(RUN_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => handler(job.data));
    }
  }

  async send(job: RunJob): Promise<void> {
    await this.boss.send(RUN_QUEUE, job);
  }

  /**
   * cron 등록. pg-boss 10은 schedule을 큐 이름으로 구분하므로 대상마다 큐를 하나씩 둔다.
   * 같은 이름으로 다시 부르면 cron과 data를 바꾼다.
   */
  async schedule<T extends object>(name: string, cron: string, data: T, handler: (data: T) => Promise<void>): Promise<void> {
    if (!this.queues.has(name)) {
      await this.ensureQueue(name, 10 * 60);
      await this.boss.work<T>(name, { batchSize: 1, pollingIntervalSeconds: 10 }, async ([job]) => handler(job.data));
    }
    await this.boss.schedule(name, cron, data, { tz: HUB_TIMEZONE, retryLimit: 0 });
  }

  async unschedule(name: string): Promise<void> {
    await this.boss.unschedule(name);
  }

  async scheduledNames(): Promise<string[]> {
    return (await this.boss.getSchedules()).map((s) => s.name);
  }

  private async ensureQueue(name: string, expireInSeconds: number): Promise<void> {
    if (this.queues.has(name)) return;
    await this.boss.createQueue(name, { name, retryLimit: 0, expireInSeconds });
    this.queues.add(name);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: false, wait: false });
  }
}
