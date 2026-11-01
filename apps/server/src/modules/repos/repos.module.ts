import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { SettingsModule } from '../settings/settings.module';
import { AppRepo } from './app-repo.entity';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppRepo]), AppsModule, SettingsModule],
  controllers: [ReposController],
  providers: [ReposService],
  exports: [ReposService],
})
export class ReposModule {}
