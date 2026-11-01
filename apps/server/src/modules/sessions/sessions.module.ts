import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEvent } from './session-event.entity';
import { SessionMessage } from './session-message.entity';
import { Session } from './session.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { TranscriptService } from './transcript.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, SessionEvent, SessionMessage])],
  controllers: [SessionsController],
  providers: [SessionsService, TranscriptService],
  exports: [SessionsService],
})
export class SessionsModule {}
