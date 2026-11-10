/**
 * Transport for the mobile adapter protocol. One authenticated WebSocket, one
 * in-flight reconnection attempt, correlated requests, and no automatic
 * mutation retries.
 *
 * Transport-open and protocol-ready are separate. `isOpen` is only true after a
 * validated `hello_ok`; a failed handshake closes and retires its socket so a
 * later `connect()` must establish a fresh one.
 */
import { Platform } from 'react-native';

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
  /** A server frame the app could not decode; never silently ignored. */
  onDecodeError?: (reason: string, detail?: string) => void;
}

interface PendingRequest {
  resolve: (frame: ServerEvent & { reply_to?: number }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  suppressEvent?: boolean;
}

/** A handshake/transport failure that keeps its protocol classification. */
export class TransportError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
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
  private lastReceivedAt = 0;
  /** Every socket incarnation gets an epoch; late callbacks are ignored. */
  private socketEpoch = 0;

  constructor(endpoint: ServerEndpoint, token: string, events: MobileClientEvents) {
    this.endpoint = endpoint;
    this.token = token;
    this.events = events;
  }

  /** Protocol-ready, not merely transport-open. */
  get isOpen(): boolean {
    return this.state === 'open' && this.greeted && this.helloFrame !== null;
  }

  get isTransportOpen(): boolean {
    return this.state === 'open';
  }

  get hello(): (ServerEvent & { reply_to?: number }) | null {
    return this.helloFrame;
  }

  get lastReceived(): number {
    return this.lastReceivedAt;
  }

  isHealthy(maxSilenceMs: number): boolean {
    return this.isOpen && Date.now() - this.lastReceivedAt <= maxSilenceMs;
  }

  private setState(next: TransportState, detail?: string): void {
    this.state = next;
    this.events.onState(next, detail);
  }

  connect(timeoutMs = 12_000): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.closedByUser = false;
    this.greeted = false;
    this.helloFrame = null;
    const epoch = ++this.socketEpoch;
    this.connecting = new Promise<void>((resolve, reject) => {
      const SocketCtor = WebSocket as unknown as new (
        url: string,
        protocols?: string | string[] | null,
        options?: { headers?: Record<string, string> },
      ) => WebSocket;
      // Browsers cannot set Authorization on a WebSocket. The adapter accepts
      // `jcode-v1` plus `token.<bearer>` as an offered subprotocol instead.
      const socket =
        Platform.OS === 'web'
          ? new SocketCtor(wsUrl(this.endpoint), ['jcode-v1', `token.${this.token}`])
          : new SocketCtor(wsUrl(this.endpoint), undefined, {
              headers: { Authorization: `Bearer ${this.token}` },
            });
      this.socket = socket;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const retire = (error: Error, emitClosed: boolean) => {
        if (this.socket !== socket || epoch !== this.socketEpoch) return;
        this.socket = null;
        this.greeted = false;
        this.helloFrame = null;
        this.state = 'idle';
        this.failPending(error);
        try {
          socket.close();
        } catch {
          // Already gone.
        }
        if (emitClosed) this.setState('closed', error.message);
      };

      const failHandshake = (error: Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        // The caller still owns this client and classifies the failure.
        // Emitting `closed` here would make the controller drop the reference
        // before it can distinguish unsupported_version from a network drop.
        retire(error, false);
        reject(error);
      };

      timer = setTimeout(() => {
        failHandshake(new TransportError('The server did not answer in time.', 'handshake_timeout'));
      }, timeoutMs);

      socket.onopen = () => {
        if (this.socket !== socket || epoch !== this.socketEpoch) return;
        // Transport is open; protocol readiness waits for hello_ok.
        this.setState('open');
        this.requestInternal(
          {
            req: 'hello',
            min_version: 1,
            max_version: 1,
            client: 'jcode-mobile/0.2.2',
            max_frame_bytes: budgets.maxFrameBytes,
          },
          timeoutMs,
          {},
          true,
        )
          .then((frame) => {
            if (settled) return;
            if (this.socket !== socket || epoch !== this.socketEpoch) {
              failHandshake(new TransportError('The connection changed during the handshake.', 'handshake_stale'));
              return;
            }
            if (frame.ev !== 'hello_ok') {
              const code = frame.ev === 'error' ? frame.code : 'handshake_rejected';
              const message =
                frame.ev === 'error' ? frame.message : 'The server rejected the protocol handshake.';
              failHandshake(new TransportError(message, code));
              return;
            }
            this.greeted = true;
            this.helloFrame = frame;
            this.lastReceivedAt = Date.now();
            settled = true;
            if (timer) clearTimeout(timer);
            resolve();
          })
          .catch((error: Error) => failHandshake(error));
      };

      socket.onmessage = (message) => {
        if (this.socket !== socket || epoch !== this.socketEpoch) return;
        this.lastReceivedAt = Date.now();
        const result = decodeFrame(String(message.data));
        if (!result.ok) {
          // A dropped reconciliation frame must be visible: reporting a
          // healthy socket while discarding history is dishonest (HIST-1).
          this.events.onDecodeError?.(result.reason, result.detail);
          return;
        }
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
        if (this.socket !== socket || epoch !== this.socketEpoch) return;
        const error = new TransportError('Cannot reach the server.', 'network');
        if (!settled) {
          failHandshake(error);
        } else {
          retire(error, true);
        }
      };

      socket.onclose = (event) => {
        if (this.socket !== socket || epoch !== this.socketEpoch) return;
        this.socket = null;
        const wasReady = this.isOpen;
        this.greeted = false;
        this.helloFrame = null;
        this.state = 'idle';
        this.failPending(new Error('The connection closed.'));
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          reject(
            new TransportError(
              event.code === 1006
                ? 'Cannot reach the server. Check the address and network.'
                : `The server closed the connection (${event.code}).`,
              event.code === 1006 ? 'network' : 'closed',
            ),
          );
        }
        if (!this.closedByUser) this.setState('closed', `socket ${event.code}`);
        this.closedByUser = false;
        if (wasReady) this.helloFrame = null;
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
    return this.requestInternal(request, timeoutMs, options, false);
  }

  private requestInternal(
    request: Record<string, unknown>,
    timeoutMs: number,
    options: { suppressEvent?: boolean },
    allowBeforeHello: boolean,
  ): Promise<ServerEvent & { reply_to?: number }> {
    if (!this.socket || this.state !== 'open') {
      return Promise.reject(new TransportError('The connection is not open.', 'not_open'));
    }
    if (!allowBeforeHello && !this.isOpen) {
      return Promise.reject(new TransportError('The connection is not ready.', 'not_ready'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TransportError('The server did not answer in time.', 'request_timeout'));
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

  /** Foreground liveness probe. A rejection means the transport is suspect. */
  ping(timeoutMs: number = budgets.healthTimeoutMs): Promise<void> {
    return this.request({ req: 'ping' }, timeoutMs).then(() => undefined);
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
    this.socketEpoch += 1;
    this.failPending(new Error('Disconnected by the user.'));
    try {
      this.socket?.close();
    } catch {
      // Already gone.
    }
    this.socket = null;
    this.state = 'idle';
    this.greeted = false;
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
  let explicitScheme = false;
  if (/^wss?:\/\//i.test(value)) {
    explicitScheme = true;
    tls = value.toLowerCase().startsWith('wss://');
    value = value.replace(/^wss?:\/\//i, '');
  } else if (/^https?:\/\//i.test(value)) {
    explicitScheme = true;
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
  // An explicit https:// or wss:// URL without a port means the standard TLS
  // port. A bare host keeps the adapter's 7643 default, which is what native
  // pairing documentation shows.
  const port = match[2] ? Number(match[2]) : explicitScheme && tls ? 443 : defaultPort;
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
