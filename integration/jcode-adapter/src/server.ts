/**
 * Authenticated mobile transport: HTTP pairing/health plus a WebSocket carrying
 * the v1 adapter protocol. Tokens come from JCode's own device registry; the
 * socket never accepts a token in the query string.
 */
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import type { AdapterConfig } from './config.ts';
import { log } from './config.ts';
import { ControlBridge } from './bridge.ts';
import { DeviceRegistry } from './registry.ts';
import { Attachment } from './attachment.ts';
import { newId, nowMs, readJson, writeJsonAtomic } from './util.ts';

interface ClientState {
  id: string;
  deviceId: string;
  token: string;
  socket: WebSocket;
  attachments: Map<string, Attachment>;
  greeted: boolean;
  requestCount: number;
  windowStarted: number;
}

type ClientFrame = {
  v?: unknown;
  id?: unknown;
  req?: unknown;
  [key: string]: unknown;
};

const MAX_CLIENTS = 8;
const MAX_REQUESTS_PER_WINDOW = 120;
const RATE_WINDOW_MS = 10_000;
const MAX_CONTENT_BYTES = 32 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const CREATE_CACHE_TTL_MS = 10 * 60_000;
const LEDGER_RETENTION_MS = 7 * 24 * 60 * 60_000;

const ADAPTER_CAPABILITIES = [
  'mobile_continuation',
  'bounded_history',
  'identity_fencing',
  'delivery_receipts',
  'soft_interrupt_ids',
  'todo_state',
  'file_read',
  'archive_restore',
  'models',
];

export class MobileAdapter {
  private readonly config: AdapterConfig;
  private readonly registry: DeviceRegistry;
  private readonly bridge: ControlBridge;
  private readonly clients = new Set<ClientState>();
  private readonly inventory = new Map<string, Record<string, unknown>>();
  private readonly ledger = new Map<string, Map<string, number>>();
  private readonly createCache = new Map<string, { sessionId: string; at: number; promise?: Promise<string> }>();
  private readonly createCachePath: string;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private ledgerTimer: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(config: AdapterConfig) {
    this.config = config;
    this.registry = new DeviceRegistry(config);
    this.bridge = new ControlBridge(config);
    this.createCachePath = join(config.stateDir, 'create-cache.json');
  }

  async start(): Promise<{ host: string; port: number }> {
    await Promise.all([this.loadLedger(), this.loadCreateCache()]);
    const handler = (request: IncomingMessage, response: ServerResponse) => {
      this.handleHttp(request, response).catch((error: Error) => {
        log(this.config, 'warn', `http handler failed: ${error.message}`);
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    };
    if (this.config.tlsCert && this.config.tlsKey) {
      this.server = createHttpsServer(
        {
          cert: await readFile(this.config.tlsCert),
          key: await readFile(this.config.tlsKey),
          minVersion: 'TLSv1.2',
        },
        handler,
      );
    } else {
      this.server = createHttpServer(handler);
    }
    this.wss = new WebSocketServer({ noServer: true, maxPayload: this.config.maxFrameBytes });
    this.server.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket as never, head);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.port, this.config.host, () => resolve());
    });
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.config.port;
    log(this.config, 'info', `listening`, { host: this.config.host, port });
    return { host: this.config.host, port };
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: import('node:net').Socket,
    head: Buffer,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+([0-9a-f]{64})$/i.exec(header.trim()) : null;
    if (!match) {
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{"error":"missing_token"}',
      );
      socket.destroy();
      return;
    }
    const device = await this.registry.validateTokenAsync(match[1]);
    if (!device) {
      log(this.config, 'warn', 'rejected unknown or revoked device token');
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{"error":"revoked"}',
      );
      socket.destroy();
      return;
    }
    if (this.clients.size >= MAX_CLIENTS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss!.handleUpgrade(request, socket, head, (ws) => {
      const client: ClientState = {
        id: newId('cli'),
        deviceId: device.id,
        token: match[1],
        socket: ws,
        attachments: new Map(),
        greeted: false,
        requestCount: 0,
        windowStarted: nowMs(),
      };
      this.clients.add(client);
      void this.registry.touch(device.id);
      log(this.config, 'info', 'client connected', { client: client.id, device: device.id });
      ws.on('message', (data) => {
        void this.onMessage(client, data.toString());
      });
      ws.on('close', () => this.onClientClose(client));
      ws.on('error', () => this.onClientClose(client));
    });
  }

  private onClientClose(client: ClientState): void {
    if (!this.clients.delete(client)) return;
    for (const attachment of client.attachments.values()) {
      // NOT cancellation: the daemon keeps the turn because the subscribe
      // opted into continuation.
      attachment.dispose();
    }
    client.attachments.clear();
    log(this.config, 'info', 'client disconnected', { client: client.id });
  }

  private send(client: ClientState, event: Record<string, unknown>, replyTo?: number): void {
    if (client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify({ v: 1, ...(replyTo !== undefined ? { reply_to: replyTo } : null), ...event }));
  }

  private reply(client: ClientState, id: number | undefined, event: Record<string, unknown>): void {
    this.send(client, event, id);
  }

  private error(client: ClientState, id: number | undefined, code: string, message: string): void {
    this.reply(client, id, { ev: 'error', code, message });
  }

  private async onMessage(client: ClientState, raw: string): Promise<void> {
    if (raw.length > this.config.maxFrameBytes) {
      this.error(client, undefined, 'invalid_request', 'Request frame is too large.');
      client.socket.close(1009);
      return;
    }
    let frame: ClientFrame;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
      frame = parsed as ClientFrame;
    } catch {
      this.error(client, undefined, 'invalid_request', 'Request is not a JSON object.');
      return;
    }
    const id = typeof frame.id === 'number' ? frame.id : undefined;
    const req = typeof frame.req === 'string' ? frame.req : '';

    const now = nowMs();
    if (now - client.windowStarted > RATE_WINDOW_MS) {
      client.windowStarted = now;
      client.requestCount = 0;
    }
    client.requestCount += 1;
    if (client.requestCount > MAX_REQUESTS_PER_WINDOW) {
      this.error(client, id, 'invalid_request', 'Too many requests.');
      return;
    }
    if (frame.v !== 1) {
      this.error(client, id, 'unsupported_version', 'This app needs adapter protocol v1.');
      return;
    }
    if (!client.greeted && req !== 'hello') {
      this.error(client, id, 'invalid_request', 'hello must be the first frame.');
      return;
    }
    if (req !== 'hello' && req !== 'ping') {
      // Revalidate the exact credential on every request. A socket opened
      // before a revoke or re-pair must lose mutation authority immediately.
      const current = await this.registry.validateTokenAsync(client.token);
      if (!current) {
        this.error(client, id, 'unauthorized', 'This device token is no longer authorized.');
        client.socket.close(4401, 'unauthorized');
        this.onClientClose(client);
        return;
      }
    }

    switch (req) {
      case 'hello': {
        const max = typeof frame.max_version === 'number' ? frame.max_version : 0;
        const min = typeof frame.min_version === 'number' ? frame.min_version : 0;
        if (max < 1 || min > 1) {
          this.error(client, id, 'unsupported_version', 'No shared protocol version.');
          return;
        }
        client.greeted = true;
        this.reply(client, id, {
          ev: 'hello_ok',
          version: 1,
          server: 'jcode-mobile-adapter/0.1.3',
          capabilities: ADAPTER_CAPABILITIES,
        });
        return;
      }
      case 'ping':
        this.reply(client, id, { ev: 'ok' });
        return;
      case 'get_server_info': {
        let daemonVersion = this.observedDaemonVersion() ?? undefined;
        try {
          await this.bridge.ensure();
        } catch (error) {
          log(this.config, 'warn', `server info: ${(error as Error).message}`);
        }
        daemonVersion = this.observedDaemonVersion() ?? daemonVersion;
        this.reply(client, id, {
          ev: 'server_info',
          server: 'jcode-mobile-adapter/0.1.3',
          daemon_version: daemonVersion,
          continuation: true,
          capabilities: ADAPTER_CAPABILITIES,
          observed_at_ms: nowMs(),
        });
        return;
      }
      case 'list_sessions': {
        await this.listSessions(client, id, frame);
        return;
      }
      case 'attach_session': {
        const sessionId = typeof frame.session_id === 'string' ? frame.session_id : '';
        if (!sessionId) {
          this.error(client, id, 'invalid_request', 'session_id is required.');
          return;
        }
        await this.attach(client, id, { sessionId });
        return;
      }
      case 'create_session': {
        await this.createSession(client, id, frame);
        return;
      }
      case 'detach_session': {
        const sessionId = typeof frame.session_id === 'string' ? frame.session_id : '';
        const attachment = client.attachments.get(sessionId);
        attachment?.dispose();
        client.attachments.delete(sessionId);
        this.reply(client, id, { ev: 'ok', session_id: sessionId });
        return;
      }
      case 'get_history': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        attachment.refreshHistory();
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'get_history_before': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        const before = typeof frame.before_index === 'number' ? frame.before_index : 0;
        const limit = Math.min(Math.max(typeof frame.limit === 'number' ? frame.limit : 40, 1), 200);
        this.reply(client, id, attachment.getHistoryBefore(before, limit));
        return;
      }
      case 'send_message': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        const content = typeof frame.content === 'string' ? frame.content : '';
        const clientMessageId = typeof frame.client_message_id === 'string' ? frame.client_message_id : '';
        if (!content.trim() || !clientMessageId) {
          this.error(client, id, 'invalid_request', 'content and client_message_id are required.');
          return;
        }
        if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
          this.error(client, id, 'invalid_request', 'Message is too long.');
          return;
        }
        const result = attachment.sendMessage(content, clientMessageId);
        if (!result.accepted) {
          this.error(client, id, 'daemon_unavailable', 'The session connection is not open.');
          return;
        }
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'soft_interrupt': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        const content = typeof frame.content === 'string' ? frame.content : '';
        const clientId = typeof frame.client_id === 'string' ? frame.client_id : '';
        if (!content.trim() || !clientId) {
          this.error(client, id, 'invalid_request', 'content and client_id are required.');
          return;
        }
        if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
          this.error(client, id, 'invalid_request', 'Message is too long.');
          return;
        }
        attachment.softInterrupt(content, clientId);
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'cancel_soft_interrupts': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        const ids = Array.isArray(frame.client_ids)
          ? frame.client_ids.filter((value): value is string => typeof value === 'string')
          : [];
        attachment.cancelSoftInterrupts(ids);
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'cancel': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        log(this.config, 'info', 'explicit stop requested', { session: attachment.sessionId });
        attachment.cancel();
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'archive_session':
      case 'restore_session': {
        const sessionId = typeof frame.session_id === 'string' ? frame.session_id : '';
        if (!sessionId) {
          this.error(client, id, 'invalid_request', 'session_id is required.');
          return;
        }
        try {
          await this.bridge.call({ req, session_id: sessionId }, 8000);
          this.reply(client, id, { ev: 'ok', session_id: sessionId });
        } catch (error) {
          this.error(client, id, 'internal', (error as Error).message);
        }
        return;
      }
      case 'rename_session': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        attachment.rename(typeof frame.title === 'string' ? frame.title : null);
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'set_session_saved': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        attachment.setSaved(frame.saved === true, typeof frame.label === 'string' ? frame.label : null);
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'get_todo_state': {
        const sessionId = typeof frame.session_id === 'string' ? frame.session_id : '';
        if (!sessionId) {
          this.error(client, id, 'invalid_request', 'session_id is required.');
          return;
        }
        try {
          const reply = await this.bridge.call({ req: 'get_todo_state', session_id: sessionId }, 8000);
          this.reply(client, id, {
            ev: 'todo_state',
            session_id: sessionId,
            state: reply.state ?? { todos: [] },
            observed_at_ms: nowMs(),
          });
        } catch (error) {
          this.error(client, id, 'internal', (error as Error).message);
        }
        return;
      }
      case 'list_models': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        const models = await attachment.models();
        this.reply(client, id, {
          ev: 'models',
          session_id: attachment.sessionId,
          models: models.models,
          current: models.current,
        });
        return;
      }
      case 'set_model': {
        const attachment = this.requireAttachment(client, id, frame);
        if (!attachment) return;
        const model = typeof frame.model === 'string' ? frame.model : '';
        if (!model) {
          this.error(client, id, 'invalid_request', 'model is required.');
          return;
        }
        attachment.setModel(model);
        this.reply(client, id, { ev: 'ok' });
        return;
      }
      case 'read_file': {
        const sessionId = typeof frame.session_id === 'string' ? frame.session_id : '';
        const path = typeof frame.path === 'string' ? frame.path : '';
        if (!sessionId || !path) {
          this.error(client, id, 'invalid_request', 'session_id and path are required.');
          return;
        }
        const max = Math.min(
          typeof frame.max_bytes === 'number' ? frame.max_bytes : MAX_FILE_BYTES,
          MAX_FILE_BYTES,
        );
        try {
          const reply = await this.bridge.call(
            { req: 'read_file', session_id: sessionId, path, max_bytes: max },
            8000,
          );
          this.reply(client, id, {
            ev: 'file_content',
            session_id: sessionId,
            path: typeof reply.path === 'string' ? reply.path : path,
            content: typeof reply.content === 'string' ? reply.content : '',
            size: typeof reply.size === 'number' ? reply.size : 0,
            truncated: reply.truncated === true,
          });
        } catch (error) {
          this.error(client, id, 'internal', (error as Error).message);
        }
        return;
      }
      default:
        this.error(client, id, 'unknown_request', `Unknown request: ${req}`);
    }
  }

  private requireAttachment(client: ClientState, id: number | undefined, frame: ClientFrame): Attachment | null {
    const sessionId = typeof frame.session_id === 'string' ? frame.session_id : '';
    const attachment = sessionId ? client.attachments.get(sessionId) : undefined;
    if (!attachment || attachment.isClosed) {
      this.error(client, id, 'unknown_session', 'Attach to this session first.');
      return null;
    }
    return attachment;
  }

  private async listSessions(client: ClientState, id: number | undefined, frame: ClientFrame): Promise<void> {
    const limit = Math.min(Math.max(typeof frame.limit === 'number' ? frame.limit : 50, 1), 200);
    try {
      const reply = await this.bridge.call(
        {
          req: 'list_sessions',
          include_archived: frame.include_archived === true,
          limit,
        },
        15_000,
      );
      const sessions = Array.isArray(reply.sessions) ? reply.sessions : [];
      this.inventory.clear();
      const live = this.liveStates();
      const enriched = sessions.map((session) => {
        if (!session || typeof session !== 'object') return session;
        const record = session as Record<string, unknown>;
        const sessionId = typeof record.session_id === 'string' ? record.session_id : '';
        const state = live.get(sessionId);
        const merged = { ...record, ...(state ? { live_state: state } : null) };
        this.inventory.set(sessionId, merged);
        return merged;
      });
      this.reply(client, id, {
        ev: 'sessions',
        sessions: enriched,
        partial: sessions.length >= limit,
      });
    } catch (error) {
      this.error(client, id, 'daemon_unavailable', (error as Error).message);
    }
  }

  private observedDaemonVersion(): string | null {
    for (const client of this.clients) {
      for (const attachment of client.attachments.values()) {
        const version = attachment.observedDaemonVersion;
        if (version) return version;
      }
    }
    return null;
  }

  private liveStates(): Map<string, 'working' | 'ready'> {
    const states = new Map<string, 'working' | 'ready'>();
    for (const client of this.clients) {
      for (const [sessionId, attachment] of client.attachments) {
        if (attachment.isClosed) continue;
        const observed = attachment.observedStatus;
        if (observed === 'unknown') continue;
        if (observed === 'working') states.set(sessionId, 'working');
        else if (!states.has(sessionId)) states.set(sessionId, 'ready');
      }
    }
    return states;
  }

  private async attach(client: ClientState, id: number | undefined, options: { sessionId: string; workingDir?: string }): Promise<void> {
    // One selected attachment per session per client; replace, never cancel.
    const previous = client.attachments.get(options.sessionId);
    previous?.dispose();
    client.attachments.delete(options.sessionId);

    const attachment = new Attachment({
      config: this.config,
      replyTo: id ?? 0,
      emit: (event) => this.send(client, event),
      sessionId: options.sessionId,
      workingDir: options.workingDir,
      lookupSession: (sessionId) => this.inventory.get(sessionId),
      acceptedClientIds: () => this.acceptedIds(options.sessionId),
      onAccepted: (clientMessageId) => this.recordAccepted(options.sessionId, clientMessageId),
      onClosed: () => {
        client.attachments.delete(options.sessionId);
      },
    });
    client.attachments.set(options.sessionId, attachment);
    try {
      await attachment.start();
      this.inventory.set(attachment.sessionId, {
        ...(this.inventory.get(attachment.sessionId) ?? {}),
        session_id: attachment.sessionId,
      });
    } catch (error) {
      client.attachments.delete(options.sessionId);
      attachment.dispose();
      this.error(client, id, 'daemon_unavailable', (error as Error).message);
    }
  }

  private async createSession(client: ClientState, id: number | undefined, frame: ClientFrame): Promise<void> {
    const workingDir = typeof frame.working_dir === 'string' ? frame.working_dir.trim() : '';
    const requestKey = typeof frame.client_request_id === 'string' ? frame.client_request_id : '';
    if (!requestKey) {
      this.error(client, id, 'invalid_request', 'client_request_id is required.');
      return;
    }
    if (!workingDir.startsWith('/') || workingDir.length < 2 || workingDir.includes('\u0000')) {
      this.error(client, id, 'invalid_request', 'Enter an absolute folder path on the server.');
      return;
    }
    const cached = this.createCache.get(requestKey);
    if (cached && nowMs() - cached.at < CREATE_CACHE_TTL_MS) {
      if (cached.promise) {
        try {
          const sessionId = await cached.promise;
          await this.attach(client, id, { sessionId });
          return;
        } catch (error) {
          this.error(client, id, 'daemon_unavailable', (error as Error).message);
          return;
        }
      }
      // The session was already created for this exact request: attach to the
      // returned identity instead of creating a duplicate.
      await this.attach(client, id, { sessionId: cached.sessionId });
      return;
    }

    let resolveCreated!: (sessionId: string) => void;
    let rejectCreated!: (error: Error) => void;
    const promise = new Promise<string>((resolve, reject) => {
      resolveCreated = resolve;
      rejectCreated = reject;
    });
    this.createCache.set(requestKey, { sessionId: '', at: nowMs(), promise });
    const placeholder = new Attachment({
      config: this.config,
      replyTo: id ?? 0,
      emit: (event) => {
        if (event.ev === 'attached') {
          const session = event.session as Record<string, unknown> | undefined;
          const sessionId = typeof session?.session_id === 'string' ? session.session_id : '';
          if (sessionId) {
            this.createCache.set(requestKey, { sessionId, at: nowMs() });
            void this.persistCreateCache();
            this.inventory.set(sessionId, session ?? { session_id: sessionId });
            client.attachments.set(sessionId, placeholder);
            resolveCreated(sessionId);
          }
        }
        this.send(client, event);
      },
      workingDir,
      lookupSession: () => undefined,
      acceptedClientIds: () => [],
      onClosed: () => undefined,
    });
    try {
      await placeholder.start();
      if (!placeholder.sessionId) throw new Error('The server did not return a session identity.');
      client.attachments.set(placeholder.sessionId, placeholder);
      this.inventory.set(placeholder.sessionId, {
        ...(this.inventory.get(placeholder.sessionId) ?? {}),
        session_id: placeholder.sessionId,
        working_dir: workingDir,
      });
    } catch (error) {
      placeholder.dispose();
      this.createCache.delete(requestKey);
      void this.persistCreateCache();
      rejectCreated!(error as Error);
      this.error(client, id, 'daemon_unavailable', (error as Error).message);
    }
  }

  private async loadCreateCache(): Promise<void> {
    const stored = await readJson<Record<string, { sessionId?: string; at?: number }>>(
      this.createCachePath,
      {},
    );
    const cutoff = nowMs() - CREATE_CACHE_TTL_MS;
    for (const [key, value] of Object.entries(stored)) {
      if (!value || typeof value.sessionId !== 'string' || typeof value.at !== 'number') continue;
      if (value.at < cutoff) continue;
      this.createCache.set(key, { sessionId: value.sessionId, at: value.at });
    }
  }

  private async persistCreateCache(): Promise<void> {
    const serializable: Record<string, { sessionId: string; at: number }> = {};
    const cutoff = nowMs() - CREATE_CACHE_TTL_MS;
    for (const [key, value] of this.createCache) {
      if (!value.sessionId || value.at < cutoff) continue;
      serializable[key] = { sessionId: value.sessionId, at: value.at };
    }
    await writeJsonAtomic(this.createCachePath, serializable).catch((error: Error) => {
      log(this.config, 'warn', `create cache write failed: ${error.message}`);
    });
  }

  private acceptedIds(sessionId: string): string[] {
    const entries = this.ledger.get(sessionId);
    if (!entries) return [];
    const cutoff = nowMs() - LEDGER_RETENTION_MS;
    return [...entries.entries()]
      .filter(([, at]) => at >= cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([clientMessageId]) => clientMessageId);
  }

  private recordAccepted(sessionId: string, clientMessageId: string): void {
    let entries = this.ledger.get(sessionId);
    if (!entries) {
      entries = new Map();
      this.ledger.set(sessionId, entries);
    }
    entries.set(clientMessageId, nowMs());
    if (entries.size > 200) {
      const oldest = [...entries.entries()].sort((a, b) => a[1] - b[1]).slice(0, entries.size - 200);
      for (const [key] of oldest) entries.delete(key);
    }
    this.scheduleLedgerWrite();
  }

  private scheduleLedgerWrite(): void {
    if (this.ledgerTimer) return;
    this.ledgerTimer = setTimeout(() => {
      this.ledgerTimer = null;
      void this.persistLedger();
    }, 500);
  }

  private async persistLedger(): Promise<void> {
    const serializable: Record<string, Record<string, number>> = {};
    const cutoff = nowMs() - LEDGER_RETENTION_MS;
    for (const [sessionId, entries] of this.ledger) {
      const recent = [...entries.entries()].filter(([, at]) => at >= cutoff);
      if (recent.length) serializable[sessionId] = Object.fromEntries(recent);
    }
    try {
      await writeJsonAtomic(this.config.ledgerPath, serializable);
    } catch (error) {
      log(this.config, 'warn', `cannot persist delivery ledger: ${(error as Error).message}`);
    }
  }

  private async loadLedger(): Promise<void> {
    const stored = await readJson<Record<string, Record<string, number>>>(this.config.ledgerPath, {});
    for (const [sessionId, entries] of Object.entries(stored)) {
      this.ledger.set(sessionId, new Map(Object.entries(entries)));
    }
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, service: 'jcode-mobile-adapter', version: 1 }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/whoami') {
      const header = request.headers.authorization;
      const match = typeof header === 'string' ? /^Bearer\s+([0-9a-f]{64})$/i.exec(header.trim()) : null;
      const device = match ? await this.registry.validateTokenAsync(match[1]) : null;
      if (!device) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'revoked' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, device: { id: device.id, name: device.name } }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/info') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          service: 'jcode-mobile-adapter',
          protocol: 1,
          capabilities: ADAPTER_CAPABILITIES,
          tls: Boolean(this.config.tlsCert),
        }),
      );
      return;
    }
    if (request.method === 'POST' && url.pathname === '/pair') {
      const body = await readBody(request, 8 * 1024);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'Invalid request.' }));
        return;
      }
      const code = typeof parsed.code === 'string' ? parsed.code : '';
      const deviceId = typeof parsed.device_id === 'string' ? parsed.device_id : '';
      const deviceName = typeof parsed.device_name === 'string' ? parsed.device_name : '';
      const result = await this.registry.pair({
        code,
        deviceId,
        deviceName,
        remoteAddress: request.socket.remoteAddress ?? 'unknown',
      });
      if (!result.ok) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: result.reason }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          token: result.token,
          device: { id: result.device.id, name: result.device.name },
          server: { name: 'JCode adapter', protocol: 1 },
        }),
      );
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'Not found' }));
  }

  async stop(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const client of this.clients) {
      for (const attachment of client.attachments.values()) attachment.dispose();
      client.socket.close();
    }
    this.clients.clear();
    if (this.ledgerTimer) clearTimeout(this.ledgerTimer);
    await this.persistLedger().catch(() => undefined);
    this.bridge.close();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
