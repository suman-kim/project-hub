import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { AppNote } from './app-note.entity';
import { AppNoteFile } from './app-note-file.entity';
import { NoteFilesService } from './note-files.service';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

/** 노트 (노션처럼 쓰는 글): 앱 노트와 내 업무 공통 노트, 그리고 첨부 파일 */
@Module({
  imports: [TypeOrmModule.forFeature([AppNote, AppNoteFile]), AppsModule],
  controllers: [NotesController],
  providers: [NotesService, NoteFilesService],
  exports: [NotesService],
})
export class NotesModule {}
