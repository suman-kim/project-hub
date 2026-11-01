import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { ReposModule } from '../repos/repos.module';
import { TasksModule } from '../tasks/tasks.module';
import { BgSessionsService } from './bg-sessions.service';
import { RulesModule } from '../rules/rules.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

@Module({
  imports: [AppsModule, TasksModule, ReposModule, DeploymentsModule, RulesModule, SessionsModule],
  controllers: [OverviewController],
  providers: [OverviewService, BgSessionsService],
  exports: [BgSessionsService],
})
export class OverviewModule {}
