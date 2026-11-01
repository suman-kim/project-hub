import { Module } from '@nestjs/common';
import { RunnerModule } from '../runner/runner.module';
import { IdeasController } from './ideas.controller';
import { IdeasModule } from './ideas.module';

/** 기획 REST 입구. runner가 기획 서비스를 쓰므로 순환을 피하려고 입구만 따로 둔다. */
@Module({
  imports: [IdeasModule, RunnerModule],
  controllers: [IdeasController],
})
export class IdeasApiModule {}
