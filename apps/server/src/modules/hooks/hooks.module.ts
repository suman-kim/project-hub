import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { ContextModule } from '../context/context.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SettingsModule } from '../settings/settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { HooksController } from './hooks.controller';

@Module({
  imports: [AppsModule, TasksModule, SessionsModule, ContextModule, SettingsModule],
  controllers: [HooksController],
})
export class HooksModule {}
