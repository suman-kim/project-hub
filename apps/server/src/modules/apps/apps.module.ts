import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { App } from './app.entity';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';

@Module({
  imports: [TypeOrmModule.forFeature([App])],
  controllers: [AppsController],
  providers: [AppsService],
  exports: [AppsService],
})
export class AppsModule {}
