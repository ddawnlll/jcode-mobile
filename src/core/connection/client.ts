/**
 * Transport for the mobile adapter protocol. One authenticated WebSocket, one
 * in-flight reconnection attempt, correlated requests, and no automatic
 * mutation retries.
 */
import { budgets } from '../../design/tokens';
import { decodeFrame, encodeFrame } from '../protocol/decode';
import type { ServerEvent } from '../protocol/frames';

export interface ServerEndpoint {
  host: string;
  port: number;
  tls: boolean;
}

export type TransportState = 'idle' | 'connecting' | 'open' | 'closed';

export interface MobileClientEvents {
  onEvent: (event: ServerEvent & { reply_to?: number }) => void;
  onState: (state: TransportState, detail?: string) => void;
}

interface PendingRequest {
  resolve: (frame: ServerEvent & { reply_to?: number }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  suppressEvent?: boolean;
}

export function httpBase(endpoint: ServerEndpoint): string {
  return `${endpoint.tls ? 'https' : 'http'}://${formatHost(endpoint.host)}:${endpoint.port}`;
}

export function wsUrl(endpoint: ServerEndpoint): string {
  return `${endpoint.tls ? 'wss' : 'ws'}://${formatHost(endpoint.host)}:${endpoint.port}/ws`;
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export class MobileClient {
  private socket: WebSocket | null = null;
  private readonly endpoint: ServerEndpoint;
  private readonly token: string;
  private readonly events: MobileClientEvents;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private state: TransportState = 'idle';
  private greeted = false;
  private closedByUser = false;
  private connecting: Promise<void> | null = null;
  private helloFrame: (ServerEvent & { reply_to?: number }) | null = null;

  constructor(endpoint: ServerEndpoint, token: string, events: MobileClientEvents) {
    this.endpoint = endpoint;
    this.token = token;
    this.events = events;
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  get hello(): (ServerEvent & { reply_to?: number }) | null {
    return this.helloFrame;
  }

  private setState(next: TransportState, detail?: string): void {
    this.state = next;
    this.events.onState(next, detail);
  }

  connect(timeoutMs = 12_000): Promise<void> {
    if (this.socket && this.state === 'open') return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.closedByUser = false;
    this.connecting = new Promise<void>((resolve, reject) => {
      const SocketCtor = WebSocket as unknown as new (
        url: string,
        protocols?: string | string[] | null,
        options?: { headers?: Record<string, string> },
      ) => WebSocket;
      const socket = new SocketCtor(wsUrl(this.endpoint), undefined, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      this.socket = socket;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('The server did not answer in time.'));
      }, timeoutMs);

      socket.onopen = () => {
        this.setState('open');
        this.request({ req: 'hello', min_version: 1, max_version: 1, client: 'jcode-mobile/0.1.1' })
          .then((frame) => {
            if (settled) return;
            if (frame.ev !== 'hello_ok') {
              settled = true;
              clearTimeout(timer);
              reject(new Error('The server rejected the protocol handshake.'));
              return;
            }
            this.greeted = true;
            this.helloFrame = frame;
            settled = true;
            clearTimeout(timer);
            resolve();
          })
          .catch((error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          });
      };

      socket.onmessage = (message) => {
        const result = decodeFrame(String(message.data));
        if (!result.ok) return;
        const frame = result.frame;
        if (typeof frame.reply_to === 'number') {
          const pending = this.pending.get(frame.reply_to);
          if (pending) {
            this.pending.delete(frame.reply_to);
            clearTimeout(pending.timer);
            pending.resolve(frame);
            if (pending.suppressEvent) return;
          }
        }
        this.events.onEvent(frame);
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Cannot reach the server.'));
        }
      };

      socket.onclose = (event) => {
        const wasOpen = this.state === 'open';
        const userClosed = this.closedByUser;
        this.socket = null;
        if (!userClosed) this.setState('closed', `socket ${event.code}`);
        else this.state = 'idle';
        this.failPending(new Error('The connection closed.'));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              event.code === 1006
                ? 'Cannot reach the server. Check the address and network.'
                : `The server closed the connection (${event.code}).`,
            ),
          );
        } else if (wasOpen) {
          this.helloFrame = null;
        }
      };
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private failPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(
    request: Record<string, unknown>,
    timeoutMs = 15_000,
    options: { suppressEvent?: boolean } = {},
  ): Promise<ServerEvent & { reply_to?: number }> {
    if (!this.socket || this.state !== 'open') {
      return Promise.reject(new Error('The connection is not open.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The server did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, suppressEvent: options.suppressEvent });
      try {
        this.socket!.send(encodeFrame(id, request));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  /** Sends without awaiting a reply; used for detach on unmount. */
  sendFireAndForget(request: Record<string, unknown>): void {
    if (!this.socket || this.state !== 'open') return;
    try {
      this.socket.send(encodeFrame(this.nextId++, request));
    } catch {
      // Transport is gone; nothing to retry.
    }
  }

  close(): void {
    this.closedByUser = true;
    this.failPending(new Error('Disconnected by the user.'));
    this.socket?.close();
    this.socket = null;
    this.state = 'idle';
    this.helloFrame = null;
  }

  get maxFrameBytes(): number {
    return budgets.maxFrameBytes;
  }
}

/** Parse a user-entered address into host/port/tls. */
export function parseServerAddress(
  input: string,
  defaultPort = 7643,
): { ok: true; endpoint: ServerEndpoint; display: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter the server address.' };
  let value = trimmed;
  let tls = true;
  if (/^wss?:\/\//i.test(value)) {
    tls = value.toLowerCase().startsWith('wss://');
    value = value.replace(/^wss?:\/\//i, '');
  } else if (/^https?:\/\//i.test(value)) {
    tls = value.toLowerCase().startsWith('https://');
    value = value.replace(/^https?:\/\//i, '');
  }
  value = value.replace(/\/.*$/, '');
  if (value.includes('@') || value.includes(' ')) {
    return { ok: false, error: 'Enter a host name or IP address, not a URL with credentials.' };
  }
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(value);
  if (!match) return { ok: false, error: 'Enter an address like studio.example.net:7643.' };
  const host = match[1].replace(/^\[|\]$/g, '');
  const port = match[2] ? Number(match[2]) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'That port is not valid.' };
  }
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!tls && !loopback) {
    return {
      ok: false,
      error: 'Use a secure address (wss:// or https://) for a remote server.',
    };
  }
  return {
    ok: true,
    endpoint: { host, port, tls },
    display: `${host}:${port}`,
  };
}
