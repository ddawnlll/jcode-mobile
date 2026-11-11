import {
  type DeviceInfo,
  type Envelope,
  type ErrorPayload,
  type PairRedeemResponse,
  type ServerHelloPayload,
  type ServerInfo,
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
} from './protocol';

export class AdapterRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.name = 'AdapterRequestError';
    this.code = payload.code;
    this.retryable = payload.retryable;
  }
}

export interface PairedCredential {
  baseUrl: string;
  token: string;
  device: DeviceInfo;
  serverId: string;
  savedAt: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: number;
  type: string;
}

type Listener = (payload: unknown) => void;

function id(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function isLoopbackHost(value: string): boolean {
  const host = value.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
}

export function normalizeServerUrl(input: string): string {
  let value = input.trim();
  if (!value) throw new Error('Enter the adapter address.');
  if (!/^https?:\/\//i.test(value)) {
    value = `${isLoopbackHost(value) ? 'http' : 'https'}://${value}`;
  }
  const url = new URL(value);
  if (url.pathname !== '/' && url.pathname !== '') {
    // A pasted app URL is acceptable; the adapter is mounted at the origin.
    url.pathname = '';
    url.search = '';
    url.hash = '';
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin;
}

export function wsUrlFor(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/v2/ws';
  return url.toString();
}

export async function pairDevice(
  baseUrl: string,
  code: string,
  deviceName: string,
): Promise<PairRedeemResponse> {
  const response = await fetch(`${normalizeServerUrl(baseUrl)}/v2/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.trim(), device_name: deviceName.trim() }),
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<PairRedeemResponse & ErrorPayload>;
  if (!response.ok) {
    throw new AdapterRequestError({
      code: payload.code ?? 'unauthorized',
      message: payload.message ?? 'Pairing was rejected.',
      retryable: payload.retryable ?? false,
    });
  }
  if (!payload.token || !payload.device || !payload.server) {
    throw new Error('The adapter returned an incomplete pairing response.');
  }
  return payload as PairRedeemResponse;
}

export async function fetchHealth(
  baseUrl: string,
): Promise<{ ok: boolean; server_id?: string; jcode_connected?: boolean; adapter_version?: string }> {
  const response = await fetch(`${normalizeServerUrl(baseUrl)}/health`);
  if (!response.ok) throw new Error(`Adapter health check failed (${response.status})`);
  return response.json();
}

export class AdapterClient {
  readonly baseUrl: string;
  readonly token: string;
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private openPromise: Promise<void> | null = null;
  private openResolve: (() => void) | null = null;
  private openReject: ((reason: unknown) => void) | null = null;
  status: ConnectionStatus = 'offline';
  server: ServerInfo | null = null;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = normalizeServerUrl(baseUrl);
    this.token = token;
  }

  on(type: string, listener: Listener): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
    return () => set.delete(listener);
  }

  private emit(type: string, payload: unknown) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // A listener must not tear down the socket loop.
      }
    }
  }

  private socketUrl(): string {
    // The browser cannot set Authorization on a WebSocket. The adapter accepts
    // the token as an offered subprotocol, which stays out of the URL.
    return wsUrlFor(this.baseUrl);
  }

  async connect(): Promise<ServerHelloPayload> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.request<ServerHelloPayload>('client.hello', {
        client_name: 'stillness-web',
        client_version: '0.3.0',
        min_version: PROTOCOL_VERSION,
        max_version: PROTOCOL_VERSION,
        supports: [WS_SUBPROTOCOL],
      });
    }
    this.manuallyClosed = false;
    this.openSocket();
    await this.waitForOpen();
    const hello = await this.request<ServerHelloPayload>(
      'client.hello',
      {
        client_name: 'stillness-web',
        client_version: '0.3.0',
        min_version: PROTOCOL_VERSION,
        max_version: PROTOCOL_VERSION,
        supports: [WS_SUBPROTOCOL],
      },
      15_000,
    );
    this.server = hello.server;
    return hello;
  }

  private openSocket() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.status = 'connecting';
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;
    });
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.socketUrl(), [WS_SUBPROTOCOL, `token.${this.token}`]);
    } catch (error) {
      this.openReject?.(error);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.status = 'connected';
      this.reconnectAttempt = 0;
      this.openResolve?.();
      this.openResolve = null;
      this.openReject = null;
      this.emit('connected', null);
    };
    socket.onmessage = (message) => this.handleFrame(message.data);
    socket.onerror = () => {
      // `onclose` is the reliable signal.
    };
    socket.onclose = (event) => {
      this.status = 'offline';
      const rejection = new Error(
        event.code === 1008 ? 'This device was revoked by the server.' : `Connection closed (${event.code}).`,
      );
      this.openReject?.(rejection);
      this.openResolve = null;
      this.openReject = null;
      for (const [requestId, request] of this.pending) {
        window.clearTimeout(request.timeout);
        request.reject(rejection);
        this.pending.delete(requestId);
      }
      this.socket = null;
      this.emit('disconnected', { code: event.code, reason: event.reason || rejection.message });
      if (!this.manuallyClosed) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer != null || this.manuallyClosed) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(12_000, 500 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.manuallyClosed) return;
      try {
        await this.connect();
        this.emit('reconnected', null);
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private waitForOpen(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (!this.openPromise) return Promise.reject(new Error('Adapter socket is not open.'));
    return this.openPromise;
  }

  private handleFrame(raw: unknown) {
    if (typeof raw !== 'string') return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.kind === 'response') {
      const pending = envelope.reply_to ? this.pending.get(envelope.reply_to) : undefined;
      if (!pending) {
        if (envelope.type !== 'error') this.emit(envelope.type, envelope.payload);
        return;
      }
      window.clearTimeout(pending.timeout);
      this.pending.delete(envelope.reply_to!);
      if (envelope.type === 'error') {
        pending.reject(new AdapterRequestError(envelope.payload as ErrorPayload));
      } else {
        pending.resolve(envelope.payload);
      }
      return;
    }
    if (envelope.kind === 'event') {
      this.emit(envelope.type, envelope);
    }
  }

  request<T = unknown>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = 30_000,
    scope: { sessionId?: string; operationId?: string } = {},
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Adapter is not connected.'));
    }
    const requestId = id('req');
    const envelope: Envelope = {
      v: PROTOCOL_VERSION,
      kind: 'request',
      id: requestId,
      type,
      payload,
      session_id: scope.sessionId,
      operation_id: scope.operationId,
    };
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${type} timed out.`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        type,
      });
      try {
        this.socket!.send(JSON.stringify(envelope));
      } catch (error) {
        window.clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  close() {
    this.manuallyClosed = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1000, 'client closed');
    this.socket = null;
    this.status = 'offline';
  }
}

/**
 * Where the pairing screen should start. A build served by the adapter uses
 * its own origin. Vite's dev port is not the adapter, so it falls back to the
 * documented local adapter port unless VITE_ADAPTER_URL overrides it.
 */
export function defaultAdapterBase(): string {
  const configured = import.meta.env.VITE_ADAPTER_URL as string | undefined;
  if (configured) return normalizeServerUrl(configured);
  if (typeof window !== 'undefined') {
    const { protocol, port, origin } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && port && port !== '5173' && port !== '4173') {
      return origin;
    }
  }
  return 'http://127.0.0.1:7646';
}
