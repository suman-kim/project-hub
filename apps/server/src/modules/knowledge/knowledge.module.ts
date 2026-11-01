import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { ReposModule } from '../repos/repos.module';
import { TasksModule } from '../tasks/tasks.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { Mistake } from './mistake.entity';
import { Spec } from './spec.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Mistake, Spec]), AppsModule, TasksModule, ReposModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
