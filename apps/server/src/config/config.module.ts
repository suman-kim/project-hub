import { Global, Module } from '@nestjs/common';
import { HUB_CONFIG, loadHubConfig } from './hub-config';

@Global()
@Module({
  providers: [{ provide: HUB_CONFIG, useFactory: () => loadHubConfig() }],
  exports: [HUB_CONFIG],
})
export class ConfigModule {}
