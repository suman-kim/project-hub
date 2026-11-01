import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { TasksModule } from '../tasks/tasks.module';
import { IdeaVersion } from './idea-version.entity';
import { Idea } from './idea.entity';
import { IdeasService } from './ideas.service';

@Module({
  imports: [TypeOrmModule.forFeature([Idea, IdeaVersion]), AppsModule, TasksModule, KnowledgeModule],
  providers: [IdeasService],
  exports: [IdeasService],
})
export class IdeasModule {}
