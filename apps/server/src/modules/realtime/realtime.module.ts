import { Global, Module } from '@nestjs/common';
import { HubEventsService } from './hub-events.service';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  providers: [HubEventsService, RealtimeGateway],
  exports: [HubEventsService],
})
export class RealtimeModule {}
