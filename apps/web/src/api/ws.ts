import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { HubEventName, HubEvents, RunLogDto } from '@hub/shared';
import { keys } from './queries';

/** idle: 아직 붙지 않음(로그인 전), open: 연결됨, down: 끊겨서 다시 붙는 중 */
export type WsState = 'idle' | 'open' | 'down';

type AnyListener = (name: HubEventName, data: unknown) => void;

/**
 * /ws 하나를 화면 전체가 같이 쓴다. 쿠키로 인증하고, 끊기면 점점 늦춰 가며 다시 붙는다.
 * 다시 붙으면 그사이 놓친 이벤트가 있을 수 있어 reconnect 리스너가 데이터를 새로 읽는다.
 */
class HubSocket {
  private ws: WebSocket | null = null;
  private state: WsState = 'idle';
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private everOpened = false;
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<AnyListener>();
  private readonly reconnectListeners = new Set<() => void>();

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.connect();
  }

  stop(): void {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.everOpened = false;
    this.setState('idle');
  }

  getState = (): WsState => this.state;

  subscribeState = (fn: () => void): (() => void) => {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  };

  onEvent(fn: AnyListener): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onReconnect(fn: () => void): () => void {
    this.reconnectListeners.add(fn);
    return () => this.reconnectListeners.delete(fn);
  }

  private connect(): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      const again = this.everOpened;
      this.everOpened = true;
      this.retry = 0;
      this.setState('open');
      if (again) this.reconnectListeners.forEach((fn) => fn());
    };
    ws.onmessage = (msg) => {
      let parsed: { event: HubEventName; data: HubEvents[HubEventName] };
      try {
        parsed = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      this.eventListeners.forEach((fn) => fn(parsed.event, parsed.data));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.wanted) return;
      // 처음 붙기 전에 실패해도 끊김으로 보여 준다(Hub가 꺼진 경우).
      this.setState('down');
      const delay = Math.min(15_000, 1000 * 2 ** this.retry);
      this.retry += 1;
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  private setState(next: WsState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((fn) => fn());
  }
}

export const hubSocket = new HubSocket();

export function useWsState(): WsState {
  return useSyncExternalStore(hubSocket.subscribeState, hubSocket.getState);
}

/** 특정 이벤트를 받는다. 실행 상세의 실시간 로그처럼 화면이 직접 처리할 때 쓴다 */
export function useHubEvent<K extends HubEventName>(name: K, fn: (data: HubEvents[K]) => void, deps: unknown[] = []): void {
  useEffect(
    () =>
      hubSocket.onEvent((n: HubEventName, data: unknown) => {
        if (n === name) fn(data as HubEvents[K]);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, ...deps],
  );
}

/** 이벤트가 오면 해당 항목만 다시 읽는다. 로그인한 동안 한 번만 건다 */
export function useLiveUpdates(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    hubSocket.start();
    const offEvent = hubSocket.onEvent((name, data) => applyEvent(qc, name, data));
    const offReconnect = hubSocket.onReconnect(() => void qc.invalidateQueries());
    return () => {
      offEvent();
      offReconnect();
      hubSocket.stop();
    };
  }, [enabled, qc]);
}

function applyEvent(qc: QueryClient, name: HubEventName, payload: unknown): void {
  const inv = (key: readonly unknown[]) => void qc.invalidateQueries({ queryKey: key });
  switch (name) {
    case 'run.log': {
      const d = payload as HubEvents['run.log'];
      // 보고 있는 run의 로그에만 이어 붙인다. 순서가 어긋나면 다시 읽는다.
      const entry: RunLogDto = { id: `ws-${d.runId}-${d.seq}`, runId: d.runId, seq: d.seq, ts: d.ts, kind: d.kind, text: d.text, raw: null };
      // 오늘 화면의 "마지막 로그 한 줄"
      qc.setQueryData<RunLogDto[]>(['runTail', d.runId], (old) => (old ? [entry] : old));
      qc.setQueryData<RunLogDto[]>(keys.runLogs(d.runId), (old) => {
        if (!old) return old;
        const last = old[old.length - 1]?.seq ?? 0;
        if (d.seq <= last) return old;
        if (d.seq !== last + 1) {
          inv(keys.runLogs(d.runId));
          return old;
        }
        return [...old, entry];
      });
      break;
    }
    case 'run.status': {
      const d = payload as HubEvents['run.status'];
      inv(['runs']);
      inv(keys.run(d.runId));
      inv(keys.appStatus);
      inv(['overview']);
      inv(['taskRuns']);
      inv(keys.usage);
      if (d.taskId) inv(keys.task(d.taskId));
      if (['done', 'failed', 'stopped'].includes(d.status)) inv(['costs']);
      break;
    }
    case 'task.updated': {
      const d = payload as HubEvents['task.updated'];
      qc.setQueryData(keys.task(d.task.id), d.task);
      inv(['tasks']);
      inv(keys.appStatus);
      inv(['overview']);
      break;
    }
    case 'idea.created':
    case 'idea.updated': {
      const d = payload as HubEvents['idea.updated'];
      inv(['ideas']);
      inv(keys.idea(d.ideaId));
      break;
    }
    case 'app.updated':
      inv(keys.apps);
      inv(keys.appStatus);
      inv(['overview']);
      inv(['repos']);
      break;
    case 'settings.updated':
      inv(['settings', (payload as HubEvents['settings.updated']).key]);
      break;
    case 'activity.created':
      inv(['activities']);
      inv(['overview']);
      inv(keys.appStatus);
      break;
    case 'deployment.updated':
      inv(['deployments']);
      inv(['overview']);
      inv(keys.appStatus);
      break;
    case 'session.event':
      inv(['sessions']);
      inv(keys.appStatus);
      break;
  }
}
