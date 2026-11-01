import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AppsModule } from '../apps/apps.module';
import { IdeasModule } from '../ideas/ideas.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ReposModule } from '../repos/repos.module';
import { SettingsModule } from '../settings/settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { BootstrapService } from './bootstrap.service';
import { CLAUDE_EXECUTOR, CliClaudeExecutor } from './claude-executor';
import { RunLog } from './run-log.entity';
import { RunQueueService } from './run-queue.service';
import { Run } from './run.entity';
import { RunnerService } from './runner.service';
import { RunsController } from './runs.controller';
import { WorktreeService } from './worktree.service';

@Module({
  imports: [TypeOrmModule.forFeature([Run, RunLog]), AppsModule, TasksModule, KnowledgeModule, IdeasModule, SessionsModule, SettingsModule, ReposModule],
  controllers: [RunsController],
  providers: [
    RunnerService,
    BootstrapService,
    RunQueueService,
    WorktreeService,
    {
      provide: CLAUDE_EXECUTOR,
      inject: [HUB_CONFIG],
      useFactory: (config: HubConfig) =>
        new CliClaudeExecutor({ claudeBin: config.runner.claudeBin, caffeinate: config.runner.caffeinate }),
    },
  ],
  exports: [RunnerService, RunQueueService],
})
export class RunnerModule {}
