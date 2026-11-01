import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { ReposModule } from '../repos/repos.module';
import { ProjectFilesController, ProjectViewController } from './project-files.controller';
import { ProjectFilesService } from './project-files.service';

@Module({
  imports: [AppsModule, ReposModule],
  controllers: [ProjectFilesController, ProjectViewController],
  providers: [ProjectFilesService],
})
export class FilesModule {}
