import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { Task } from './task.entity';
import { TaskmasterImportService } from './taskmaster-import.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), AppsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskmasterImportService],
  exports: [TasksService],
})
export class TasksModule {}
