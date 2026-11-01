import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { HubEventName, HubEvents } from '@hub/shared';

/** 모듈 사이의 알림과 WebSocket 방송이 같이 쓰는 프로세스 안 이벤트 버스 */
@Injectable()
export class HubEventsService {
  private readonly emitter = new EventEmitter().setMaxListeners(50);

  emit<K extends HubEventName>(name: K, payload: HubEvents[K]): void {
    this.emitter.emit(name, payload);
    this.emitter.emit('*', name, payload);
  }

  on<K extends HubEventName>(name: K, listener: (payload: HubEvents[K]) => void): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }

  onAny(listener: (name: HubEventName, payload: unknown) => void): () => void {
    this.emitter.on('*', listener);
    return () => this.emitter.off('*', listener);
  }
}
