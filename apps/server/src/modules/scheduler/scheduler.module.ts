import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { RunnerModule } from '../runner/runner.module';
import { SettingsModule } from '../settings/settings.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AppsModule, RunnerModule, SettingsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
