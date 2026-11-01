import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { IdeasModule } from '../ideas/ideas.module';
import { ReposModule } from '../repos/repos.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { TasksModule } from '../tasks/tasks.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [TasksModule, KnowledgeModule, IdeasModule, AppsModule, DeploymentsModule, ReposModule],
  controllers: [McpController],
})
export class McpModule {}
