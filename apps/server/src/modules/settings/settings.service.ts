import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { HubDefaultsDto, IdeationSettingsDto } from '@hub/shared';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { HubEventsService } from '../realtime/hub-events.service';
import { HubSetting } from './hub-setting.entity';

export const IDEATION_KEY = 'ideation';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    @InjectRepository(HubSetting) private readonly settings: Repository<HubSetting>,
    private readonly events: HubEventsService,
  ) {}

  /** 앱에 값이 없을 때 쓰는 Hub 기본값 */
  defaults(): HubDefaultsDto {
    return { allowedTools: this.config.runner.allowedTools, worktreeRoot: join(this.config.hubHome, 'worktrees') };
  }

  /** 새 앱 기획 설정. 저장된 값이 없는 항목은 기본값으로 채운다. */
  async ideation(): Promise<IdeationSettingsDto> {
    const row = await this.settings.findOneBy({ key: IDEATION_KEY });
    return {
      directionNote: null,
      cron: null,
      projectRoot: this.config.projectRoot,
      githubOwner: null,
      sessionPermissionMode: 'auto',
      ...((row?.value as Partial<IdeationSettingsDto>) ?? {}),
    };
  }

  async updateIdeation(patch: Partial<IdeationSettingsDto>): Promise<IdeationSettingsDto> {
    const next = { ...(await this.ideation()), ...patch };
    await this.settings.save({ key: IDEATION_KEY, value: next });
    this.events.emit('settings.updated', { key: IDEATION_KEY });
    return next;
  }
}
