import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MineModule } from '../mine/mine.module';
import { TasksModule } from '../tasks/tasks.module';
import { ContextService } from './context.service';

@Module({
  imports: [TasksModule, KnowledgeModule, MineModule],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
