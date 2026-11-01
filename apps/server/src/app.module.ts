import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TokenGuard } from './common/token.guard';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AppsModule } from './modules/apps/apps.module';
import { AuthModule } from './modules/auth/auth.module';
import { CostsModule } from './modules/costs/costs.module';
import { DeploymentsModule } from './modules/deployments/deployments.module';
import { EnvironmentModule } from './modules/environment/environment.module';
import { FilesModule } from './modules/files/files.module';
import { HooksModule } from './modules/hooks/hooks.module';
import { IdeasApiModule } from './modules/ideas/ideas-api.module';
import { McpModule } from './modules/mcp/mcp.module';
import { MineModule } from './modules/mine/mine.module';
import { OverviewModule } from './modules/overview/overview.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ReposModule } from './modules/repos/repos.module';
import { RulesModule } from './modules/rules/rules.module';
import { RunnerModule } from './modules/runner/runner.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TasksModule } from './modules/tasks/tasks.module';

@Module({
  imports: [ConfigModule, DbModule, RealtimeModule, AppsModule, TasksModule, HooksModule, McpModule, RunnerModule, IdeasApiModule, SchedulerModule, RulesModule, CostsModule, SettingsModule, ActivitiesModule, ReposModule, DeploymentsModule, OverviewModule, AuthModule, FilesModule, EnvironmentModule, MineModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: TokenGuard }],
})
export class AppModule {}
