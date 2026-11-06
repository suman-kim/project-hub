import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { DocFilesService } from './doc-files.service';
import { MineController } from './mine.controller';
import { MineService } from './mine.service';
import { MyDoc } from './my-doc.entity';
import { MyDocFile } from './my-doc-file.entity';
import { MyTodo } from './my-todo.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MyTodo, MyDoc, MyDocFile]), AppsModule],
  controllers: [MineController],
  providers: [MineService, DocFilesService],
  exports: [MineService],
})
export class MineModule {}
