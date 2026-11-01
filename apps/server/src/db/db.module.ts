import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HUB_CONFIG, HubConfig } from '../config/hub-config';
import { dataSourceOptions } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [HUB_CONFIG],
      useFactory: (config: HubConfig) => dataSourceOptions(config.databaseUrl),
    }),
  ],
})
export class DbModule {}
