import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer as WsServer } from 'ws';
import { tokenMatches } from '../../common/token.guard';
import { AuthService } from '../auth/auth.service';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { HubEventsService } from './hub-events.service';

/**
 * ws://127.0.0.1:2424/ws?token=... 로 붙으면 모든 Hub 이벤트를 { event, data } JSON으로 받는다.
 * 브라우저 WebSocket은 헤더를 못 넣어서 토큰은 X-Hub-Token 헤더나 token 쿼리로 받는다.
 */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private readonly off: () => void;

  @WebSocketServer()
  server: WsServer;

  constructor(
    events: HubEventsService,
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly auth: AuthService,
  ) {
    this.off = events.onAny((event, data) => this.broadcast(JSON.stringify({ event, data })));
  }

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = req.headers['x-hub-token'] ?? url.searchParams.get('token');
    if (!tokenMatches(this.config.token, token) && !this.auth.verifyCookieHeader(req.headers.cookie)) {
      client.close(4401, 'unauthorized');
      return;
    }
    this.logger.debug(`연결: ${this.server.clients.size}개`);
  }

  private broadcast(message: string): void {
    for (const client of this.server?.clients ?? []) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  }

  onModuleDestroy(): void {
    this.off();
  }
}
