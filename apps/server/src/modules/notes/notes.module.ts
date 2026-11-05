import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { AppNote } from './app-note.entity';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

/** 앱별 노트 (노션처럼 쓰는 글) */
@Module({
  imports: [TypeOrmModule.forFeature([AppNote]), AppsModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
