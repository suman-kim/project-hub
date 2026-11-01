import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { ReposModule } from '../repos/repos.module';
import { EnvironmentController } from './environment.controller';
import { EnvironmentService } from './environment.service';
import { KoSummaries } from './ko-summaries';

@Module({
  imports: [AppsModule, ReposModule],
  controllers: [EnvironmentController],
  providers: [EnvironmentService, KoSummaries],
})
export class EnvironmentModule {}
