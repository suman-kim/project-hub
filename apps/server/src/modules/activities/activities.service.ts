import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { ActivityActor, ActivityDto } from '@hub/shared';
import { Repository } from 'typeorm';
import { HubEventsService } from '../realtime/hub-events.service';
import { Activity } from './activity.entity';

export interface ActivityInput {
  appId: number | null;
  kind: string;
  actor: ActivityActor;
  summary: string;
  refType?: string | null;
  refId?: string | null;
  data?: Record<string, unknown>;
  at?: Date;
}

export function toActivityDto(a: Activity, appCode: string | null): ActivityDto {
  return {
    id: Number(a.id),
    appCode,
    at: a.at.toISOString(),
    kind: a.kind,
    actor: a.actor,
    refType: a.refType,
    refId: a.refId,
    summary: a.summary,
    data: a.data,
  };
}

/** 앱 히스토리. 각 서비스가 일을 끝낸 뒤 부른다. 기록에 실패해도 본래 일은 막지 않는다. */
@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger('Activities');

  constructor(
    @InjectRepository(Activity) private readonly repo: Repository<Activity>,
    private readonly events: HubEventsService,
  ) {}

  async record(input: ActivityInput): Promise<void> {
    try {
      const saved = await this.repo.save(
        this.repo.create({
          appId: input.appId,
          kind: input.kind,
          actor: input.actor,
          summary: input.summary.slice(0, 2000),
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          data: input.data ?? {},
          ...(input.at ? { at: input.at } : {}),
        }),
      );
      const withApp = await this.repo.findOne({ where: { id: saved.id }, relations: { app: true } });
      this.events.emit('activity.created', { activity: toActivityDto(withApp ?? saved, withApp?.app?.code ?? null) });
    } catch (e) {
      this.logger.warn(`히스토리 기록 실패 (${input.kind}): ${(e as Error).message}`);
    }
  }

  /** 앱 서비스를 쓰지 않고 앱을 찾는다. 앱 서비스가 이 서비스를 쓰므로 반대로 의존하지 않기 위해서다 */
  async appIdOf(ref: string | number): Promise<number> {
    const rows: Array<{ id: number }> =
      typeof ref === 'number'
        ? await this.repo.manager.query('SELECT id FROM apps WHERE id = $1', [ref])
        : await this.repo.manager.query('SELECT id FROM apps WHERE code = $1', [ref.toUpperCase()]);
    if (!rows.length) throw new NotFoundException(`앱 ${ref}가 없다`);
    return rows[0].id;
  }

  /** 최근 것부터. before(id)보다 오래된 것을 limit개 */
  async list(q: { appId?: number; kinds?: string[]; before?: number; limit: number }): Promise<ActivityDto[]> {
    const qb = this.repo.createQueryBuilder('a').leftJoinAndSelect('a.app', 'app').orderBy('a.at', 'DESC').addOrderBy('a.id', 'DESC');
    if (q.appId) qb.andWhere('a.app_id = :appId', { appId: q.appId });
    if (q.kinds?.length) qb.andWhere(`(split_part(a.kind, '.', 1) IN (:...kinds) OR a.kind IN (:...kinds))`, { kinds: q.kinds });
    if (q.before) qb.andWhere('a.id < :before', { before: q.before });
    const rows = await qb.limit(q.limit).getMany();
    return rows.map((a) => toActivityDto(a, a.app?.code ?? null));
  }
}
