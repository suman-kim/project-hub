import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Run } from '../runner/run.entity';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Run])],
  controllers: [CostsController],
  providers: [CostsService],
})
export class CostsModule {}
