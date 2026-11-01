import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { ReposModule } from '../repos/repos.module';
import { RunnerModule } from '../runner/runner.module';
import { TasksModule } from '../tasks/tasks.module';
import { Deployment } from './deployment.entity';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { GithubSyncService } from './github-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deployment]), AppsModule, ReposModule, TasksModule, RunnerModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService, GithubSyncService],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
