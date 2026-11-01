import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HubSetting } from '../settings/hub-setting.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/** 토큰 가드와 WebSocket이 세션 쿠키를 확인하므로 전역으로 둔다 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([HubSetting])],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
