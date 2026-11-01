import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppsModule } from '../apps/apps.module';
import { ReposModule } from '../repos/repos.module';
import { ClaudeMdService } from './claude-md.service';
import { Rule } from './rule.entity';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  imports: [TypeOrmModule.forFeature([Rule]), AppsModule, ReposModule],
  controllers: [RulesController],
  providers: [RulesService, ClaudeMdService],
  exports: [RulesService],
})
export class RulesModule {}
