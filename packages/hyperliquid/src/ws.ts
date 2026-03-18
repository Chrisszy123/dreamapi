import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

import type { WsAllMids, WsL2Book, WsUserFills } from './types.js';

const HYPERLIQUID_WS_URL = 'wss://api.hyperliquid.xyz/ws';

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const JITTER_FACTOR = 0.2;
const MAX_CONSECUTIVE_FAILURES = 10;

interface HyperliquidWsEvents {
  allMids: [data: WsAllMids];
  l2Book: [data: WsL2Book];
  userFills: [data: WsUserFills];
  connected: [];
  disconnected: [];
  fatal: [error: Error];
  error: [error: Error];
}

export class HyperliquidWsClient extends EventEmitter<HyperliquidWsEvents> {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private consecutiveFailures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSubscriptions: Array<Record<string, unknown>> = [];
  private isClosing = false;
  private lastHeartbeat: number = 0;

  constructor(url: string = HYPERLIQUID_WS_URL) {
    super();
    this.url = url;
  }

  get lastHeartbeatAt(): number {
    return this.lastHeartbeat;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.isClosing = false;
    this.createConnection();
  }

  disconnect(): void {
    this.isClosing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribeAllMids(): void {
    this.send({
      method: 'subscribe',
      subscription: { type: 'allMids' },
    });
  }

  subscribeL2Book(coin: string): void {
    this.send({
      method: 'subscribe',
      subscription: { type: 'l2Book', coin },
    });
  }

  subscribeUserEvents(user: string): void {
    this.send({
      method: 'subscribe',
      subscription: { type: 'userEvents', user },
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.pendingSubscriptions.push(msg);
    }
  }

  private createConnection(): void {
    if (this.isClosing) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch (error) {
      this.handleConnectionFailure(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }

    this.ws.on('open', () => {
      this.consecutiveFailures = 0;
      this.lastHeartbeat = Date.now();
      this.emit('connected');

      for (const sub of this.pendingSubscriptions) {
        this.ws?.send(JSON.stringify(sub));
      }
      this.pendingSubscriptions = [];
    });

    this.ws.on('message', (raw: Buffer) => {
      this.lastHeartbeat = Date.now();

      try {
        const msg = JSON.parse(raw.toString()) as {
          channel?: string;
          data?: unknown;
        };

        if (!msg.channel || !msg.data) return;

        switch (msg.channel) {
          case 'allMids':
            this.emit('allMids', msg.data as WsAllMids);
            break;
          case 'l2Book':
            this.emit('l2Book', msg.data as WsL2Book);
            break;
          case 'userFills':
            this.emit('userFills', msg.data as WsUserFills);
            break;
        }
      } catch {
        // Malformed message — ignore
      }
    });

    this.ws.on('close', () => {
      this.emit('disconnected');
      if (!this.isClosing) {
        this.handleConnectionFailure(new Error('WebSocket closed unexpectedly'));
      }
    });

    this.ws.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }

  private handleConnectionFailure(error: Error): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const fatalError = new Error(
        `Hyperliquid WebSocket: ${this.consecutiveFailures} consecutive connection failures. Last error: ${error.message}`,
      );
      this.emit('fatal', fatalError);
      return;
    }

    const baseDelay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this.consecutiveFailures - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
    const delay = Math.round(baseDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, delay);
  }
}
