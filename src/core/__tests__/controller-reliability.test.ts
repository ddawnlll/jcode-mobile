/**
 * Controller reliability regressions for issues #2, #3, #4, #5, #8, #9, #10.
 *
 * The transport is faked at the MobileClient boundary; transport framing and
 * handshake behavior have their own tests in connection/__tests__. Storage and
 * credentials are fakes. Time is fake where the regression depends on deadlines.
 */
import type { SessionInfo } from '../protocol/frames';
import { resetConversation, store } from '../state/store';
import { AppController } from '../app-controller';
import { TransportError } from '../connection/client';
import {
  clearServerCache,
  deleteServer,
  listServers,
  saveServer,
  updateSessionTitle,
  upsertSessions,
} from '../persistence/db';
import { deleteToken, loadToken, saveToken } from '../persistence/credentials';

interface FakeConfig {
  sessions?: SessionInfo[];
  session?: SessionInfo;
  connect?: (client: FakeClient) => Promise<void>;
  request?: (
    client: FakeClient,
    request: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<Record<string, unknown>>;
}

interface FakeClient {
  endpoint: { host: string; port: number; tls: boolean };
  token: string;
  events: { onEvent: (frame: Record<string, unknown>) => void; onState: (state: string) => void };
  isOpen: boolean;
  isTransportOpen: boolean;
  hello: Record<string, unknown> | null;
  lastReceived: number;
  requests: Array<Record<string, unknown>>;
  closed: boolean;
  connect(): Promise<void>;
  request(request: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  ping(timeoutMs?: number): Promise<void>;
  close(): void;
  drop(): void;
  handshake(): void;
  sendFireAndForget(): void;
  isHealthy(): boolean;
}

jest.mock('../connection/client', () => {
  class TransportError extends Error {
    readonly code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'TransportError';
      this.code = code;
    }
  }
  class FakeMobileClient {
    readonly endpoint: { host: string; port: number; tls: boolean };
    readonly token: string;
    readonly events: {
      onEvent: (frame: Record<string, unknown>) => void;
      onState: (state: string) => void;
    };
    isOpen = false;
    isTransportOpen = false;
    hello: Record<string, unknown> | null = null;
    lastReceived = 0;
    requests: Array<Record<string, unknown>> = [];
    closed = false;

    constructor(endpoint: { host: string; port: number; tls: boolean }, token: string, events: FakeClient['events']) {
      this.endpoint = endpoint;
      this.token = token;
      this.events = events;
      (globalThis as unknown as { __fakeClients: FakeClient[] }).__fakeClients.push(this);
    }

    handshake(): void {
      this.isOpen = true;
      this.isTransportOpen = true;
      this.lastReceived = Date.now();
      this.hello = {
        ev: 'hello_ok',
        version: 1,
        capabilities: ['mobile_continuation'],
        daemon_version: '0.99.1-test',
      };
    }

    async connect(): Promise<void> {
      const config = (globalThis as unknown as { __fakeConfig: FakeConfig }).__fakeConfig;
      if (config.connect) return config.connect(this);
      this.handshake();
    }

    request(request: Record<string, unknown>, timeoutMs = 15_000): Promise<Record<string, unknown>> {
      this.requests.push(request);
      const config = (globalThis as unknown as { __fakeConfig: FakeConfig }).__fakeConfig;
      if (config.request) return config.request(this, request, timeoutMs);
      if (request.req === 'list_sessions') {
        return Promise.resolve({
          ev: 'sessions',
          sessions: config.sessions ?? [],
          partial: false,
        });
      }
      if (request.req === 'attach_session') {
        const session = config.session ?? {
          session_id: String(request.session_id),
          title: 'Session',
          working_dir: '/test',
        };
        const attachmentId = 'att_test';
        Promise.resolve().then(() => {
          this.events.onEvent({
            ev: 'attached',
            session,
            attachment_id: attachmentId,
            capabilities: ['mobile_continuation'],
            continuation: true,
          });
          this.events.onEvent({
            ev: 'history',
            attachment_id: attachmentId,
            messages: [],
            total_messages: 0,
            base_index: 0,
            accepted_client_ids: [],
          });
        });
        return Promise.resolve({
          ev: 'attached',
          session,
          attachment_id: attachmentId,
          capabilities: ['mobile_continuation'],
          continuation: true,
        });
      }
      if (request.req === 'get_server_info') {
        return Promise.resolve({
          ev: 'server_info',
          server: 'fake',
          capabilities: ['mobile_continuation'],
          daemon_version: '0.99.1-test',
          observed_at_ms: Date.now(),
        });
      }
      if (request.req === 'ping') return Promise.resolve({ ev: 'ok' });
      return Promise.resolve({ ev: 'ok' });
    }

    async ping(timeoutMs = 5_000): Promise<void> {
      await this.request({ req: 'ping' }, timeoutMs);
    }

    close(): void {
      this.closed = true;
      this.isOpen = false;
      this.isTransportOpen = false;
      this.hello = null;
    }

    drop(): void {
      this.isOpen = false;
      this.isTransportOpen = false;
      this.hello = null;
      this.events.onState('closed');
    }

    sendFireAndForget(): void {}

    isHealthy(): boolean {
      return this.isOpen;
    }
  }

  return {
    MobileClient: FakeMobileClient,
    TransportError,
    httpBase: (endpoint: { host: string; port: number; tls: boolean }) =>
      `${endpoint.tls ? 'https' : 'http'}://${endpoint.host}:${endpoint.port}`,
    parseServerAddress: (input: string) => {
      const cleaned = input.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
      const [host, port] = cleaned.split(':');
      return {
        ok: true as const,
        endpoint: { host, port: Number(port ?? 7643), tls: true },
        display: cleaned,
      };
    },
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: { isConnected: boolean }) => void) => {
      (globalThis as unknown as { __netListener: typeof listener }).__netListener = listener;
      return () => undefined;
    },
  },
}));

jest.mock('../persistence/credentials', () => ({
  loadToken: jest.fn(async () => 'a'.repeat(64)),
  saveToken: jest.fn(async () => undefined),
  deleteToken: jest.fn(async () => undefined),
}));

jest.mock('../persistence/db', () => ({
  initDatabase: jest.fn(async () => undefined),
  listServers: jest.fn(async () => []),
  saveServer: jest.fn(async () => undefined),
  deleteServer: jest.fn(async () => undefined),
  loadCachedSessions: jest.fn(async () => []),
  upsertSessions: jest.fn(async () => undefined),
  updateSessionLiveState: jest.fn(async () => undefined),
  updateSessionTitle: jest.fn(async () => undefined),
  loadCachedMessages: jest.fn(async () => ({ messages: [], total: 0 })),
  upsertMessages: jest.fn(async () => undefined),
  clearCachedConversation: jest.fn(async () => undefined),
  clearServerCache: jest.fn(async () => undefined),
  getDraft: jest.fn(async () => ''),
  setDraft: jest.fn(async () => undefined),
  getBookmark: jest.fn(async () => null),
  setBookmark: jest.fn(async () => undefined),
  listPendingSends: jest.fn(async () => []),
  savePendingSend: jest.fn(async () => undefined),
  deletePendingSend: jest.fn(async () => undefined),
  getPref: jest.fn(async () => null),
  setPref: jest.fn(async () => undefined),
  cacheStats: jest.fn(async () => ({ bytes: 0, sessions: 0 })),
}));

jest.mock('../dev/pairing-import', () => ({ importDevPairingFile: jest.fn(async () => false) }));
jest.mock('../dev/e2e-seed', () => ({ importE2ECredentials: jest.fn(async () => false) }));

const fakeClients = (globalThis as unknown as { __fakeClients: FakeClient[] }).__fakeClients ?? [];
(globalThis as unknown as { __fakeClients: FakeClient[] }).__fakeClients = fakeClients;
const fakeConfig = (globalThis as unknown as { __fakeConfig: FakeConfig }).__fakeConfig ?? {};
(globalThis as unknown as { __fakeConfig: FakeConfig }).__fakeConfig = fakeConfig;

const A = {
  id: 'A',
  label: 'A',
  host: 'a.example.test',
  port: 443,
  tls: 1,
  device_id: 'device-a',
  created_at: 1,
  last_connected_at: 1,
  daemon_version: null,
  capabilities_json: null,
};

const B = { ...A, id: 'B', label: 'B', host: 'b.example.test' };

function deferred<T>() {
  let resolve!: (value: T | Promise<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

function resetStore(): void {
  store.setState({
    profileId: null,
    bootstrap: 'ready',
    connection: {
      state: 'cached',
      lastCheckedAt: null,
      lastContactAt: null,
      serverLabel: '',
      host: '',
      daemonVersion: null,
      serverName: null,
      capabilities: [],
      error: null,
      attempt: 0,
    },
    inventory: {
      sessions: [],
      fetchedAt: null,
      loading: false,
      error: null,
      partial: false,
      limit: 50,
      includeArchived: false,
      pinnedSessionIds: [],
      projects: [],
      pendingRestore: null,
    },
    conversation: resetConversation(),
  });
}

function makeController(profile = A): AppController {
  const controller = new AppController();
  (controller as unknown as { profile: typeof A }).profile = profile;
  (controller as unknown as { token: string }).token = 'a'.repeat(64);
  (controller as unknown as { appState: string }).appState = 'active';
  (controller as unknown as { online: boolean }).online = true;
  store.setState({ profileId: profile.id });
  return controller;
}

async function connect(controller: AppController): Promise<void> {
  const promise = controller.connectNow();
  await flush();
  await promise;
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  fakeClients.length = 0;
  for (const key of Object.keys(fakeConfig)) delete (fakeConfig as Record<string, unknown>)[key];
  resetStore();
  jest.clearAllMocks();
  (listServers as jest.Mock).mockResolvedValue([]);
  (loadToken as jest.Mock).mockResolvedValue('a'.repeat(64));
  (saveToken as jest.Mock).mockResolvedValue(undefined);
  (deleteToken as jest.Mock).mockResolvedValue(undefined);
  (saveServer as jest.Mock).mockResolvedValue(undefined);
  (deleteServer as jest.Mock).mockResolvedValue(undefined);
  (clearServerCache as jest.Mock).mockResolvedValue(undefined);
  (upsertSessions as jest.Mock).mockResolvedValue(undefined);
  (updateSessionTitle as jest.Mock).mockResolvedValue(undefined);
  global.fetch = jest.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('connection ownership and recovery', () => {
  it('preserves retry intent when the deadline fires during an in-flight attempt', async () => {
    const saved = deferred<void>();
    (saveServer as jest.Mock).mockImplementationOnce(() => saved.promise);
    fakeConfig.session = { session_id: 'S', title: 'S', working_dir: '/test', live_state: 'ready' };
    const controller = makeController();
    store.setState({
      conversation: resetConversation({ sessionId: 'S', session: fakeConfig.session }),
    });

    const connecting = controller.connectNow();
    await flush();
    expect(fakeClients).toHaveLength(1);

    // The socket dies while the post-hello profile save is still pending.
    fakeClients[0].drop();
    await jest.advanceTimersByTimeAsync(1_300);
    expect(fakeClients).toHaveLength(1); // the retry joined the old attempt

    saved.resolve();
    await connecting;
    await flush();

    // Once the old attempt settles, recovery must still be scheduled.
    await jest.advanceTimersByTimeAsync(320_000);
    expect(fakeClients.length).toBeGreaterThan(1);
    expect(store.get().connection.state).toBe('current');
    expect((controller as unknown as { client: FakeClient | null }).client).not.toBeNull();
  });

  it('recovers when a retry deadline fires during inventory reconciliation', async () => {
    const inventory = deferred<Record<string, unknown>>();
    let firstInventory = true;
    fakeConfig.request = async (_client, request) => {
      if (request.req === 'list_sessions') {
        if (firstInventory) {
          firstInventory = false;
          return inventory.promise;
        }
        return { ev: 'sessions', sessions: [], partial: false };
      }
      return { ev: 'ok' };
    };
    const controller = makeController();
    const connecting = controller.connectNow();
    await flush();
    fakeClients[0].drop();
    await jest.advanceTimersByTimeAsync(1_300);
    inventory.resolve({ ev: 'sessions', sessions: [], partial: false });
    await connecting;
    await flush();

    await jest.advanceTimersByTimeAsync(320_000);
    expect(fakeClients.length).toBeGreaterThan(1);
    expect(store.get().connection.state).toBe('current');
  });

  it('bounds a stuck connection attempt and schedules recovery', async () => {
    const stuck = deferred<void>();
    (saveServer as jest.Mock).mockImplementationOnce(() => stuck.promise);
    const controller = makeController();
    void controller.connectNow();
    await flush();
    expect(fakeClients).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(45_100);
    await flush();
    expect((controller as unknown as { connectAttempt: unknown }).connectAttempt).toBeNull();
    expect((controller as unknown as { client: FakeClient | null }).client).toBeNull();
    expect(store.get().connection.state).not.toBe('current');

    stuck.resolve();
    await flush();
  });

  it('reconnect keeps the exact session and never replays an uncertain send', async () => {
    fakeConfig.session = { session_id: 'S', title: 'S', working_dir: '/test' };
    const controller = makeController();
    store.setState({
      conversation: resetConversation({
        serverId: 'A',
        sessionId: 'S',
        session: fakeConfig.session,
        delivery: [
          {
            clientMessageId: 'm1',
            content: 'hello',
            state: 'sent_to_server',
            createdAt: 1,
          },
        ],
      }),
    });
    await connect(controller);
    expect(store.get().connection.state).toBe('current');

    fakeClients[0].drop();
    await jest.advanceTimersByTimeAsync(300_000);
    await flush();

    expect(fakeClients.length).toBeGreaterThan(1);
    expect(store.get().connection.state).toBe('current');
    expect(store.get().conversation.sessionId).toBe('S');
    expect(store.get().conversation.delivery[0].state).toBe('unconfirmed');
    const requests = fakeClients.flatMap((client) => client.requests);
    expect(requests.filter((request) => request.req === 'send_message')).toHaveLength(0);
    expect(requests.filter((request) => request.req === 'attach_session').length).toBeGreaterThanOrEqual(2);
  });

  it('classifies an unsupported protocol handshake without scheduling a retry', async () => {
    fakeConfig.connect = async () => {
      throw new TransportError('No shared protocol version.', 'unsupported_version');
    };
    const controller = makeController();
    await controller.connectNow();
    await flush();
    expect(store.get().connection.state).toBe('incompatible');
    expect((controller as unknown as { reconnectTimer: unknown }).reconnectTimer).toBeNull();
  });

  it('does not let a stale A failure change the replacement B authorization state', async () => {
    const who = deferred<{ status: number; ok: boolean }>();
    global.fetch = jest.fn(() => who.promise) as unknown as typeof fetch;
    fakeConfig.connect = async (client) => {
      if (client.endpoint.host === 'a.example.test') throw new Error('A is down');
      client.handshake();
    };
    (listServers as jest.Mock).mockResolvedValue([A, B]);

    const controller = makeController(A);
    const old = controller.connectNow();
    await flush();
    expect(store.get().connection.state).not.toBe('current');

    await controller.activateProfile(B, { restore: false });
    await flush();
    expect(store.get().profileId).toBe('B');
    expect(store.get().connection.state).toBe('current');

    who.resolve({ status: 401, ok: false });
    await old;
    await flush();
    expect(store.get().profileId).toBe('B');
    expect(store.get().connection.state).toBe('current');
  });

  it('does not publish Current when required inventory reconciliation fails', async () => {
    fakeConfig.request = async (_client, request) => {
      if (request.req === 'list_sessions') throw new Error('The server did not answer in time.');
      return { ev: 'ok' };
    };
    const controller = makeController();
    await controller.connectNow();
    await flush();
    expect(store.get().connection.state).not.toBe('current');
    expect((controller as unknown as { client: FakeClient | null }).client).toBeNull();
  });

  it('health probe retires a half-open socket and schedules recovery', async () => {
    fakeConfig.request = async (_client, request) => {
      if (request.req === 'list_sessions') return { ev: 'sessions', sessions: [], partial: false };
      if (request.req === 'ping') throw new Error('The server did not answer in time.');
      return { ev: 'ok' };
    };
    const controller = makeController();
    await connect(controller);
    expect(store.get().connection.state).toBe('current');

    await jest.advanceTimersByTimeAsync(15_100);
    await flush();
    expect(store.get().connection.state).not.toBe('current');
    expect((controller as unknown as { client: FakeClient | null }).client).toBeNull();
  });

  it('restores inventory polling after background/resume while Sessions stays focused', async () => {
    const controller = makeController();
    await connect(controller);
    controller.startInventoryPolling();
    expect((controller as unknown as { inventoryTimer: unknown }).inventoryTimer).not.toBeNull();
    const before = fakeClients[0].requests.filter((request) => request.req === 'list_sessions').length;

    (controller as unknown as { onBackground: () => void }).onBackground();
    expect((controller as unknown as { inventoryTimer: unknown }).inventoryTimer).toBeNull();
    expect((controller as unknown as { inventoryRequested: boolean }).inventoryRequested).toBe(true);

    (controller as unknown as { onForeground: () => Promise<void> }).onForeground();
    await flush();
    expect((controller as unknown as { inventoryTimer: unknown }).inventoryTimer).not.toBeNull();
    await jest.advanceTimersByTimeAsync(30_100);
    const after = fakeClients
      .flatMap((client) => client.requests)
      .filter((request) => request.req === 'list_sessions').length;
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});

describe('pairing cancellation', () => {
  it('aborts a response body that outlives the deadline and never activates after forget', async () => {
    let signal: AbortSignal | undefined;
    const body = deferred<{ ok: true; token: string }>();
    global.fetch = jest.fn(async (_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return { status: 200, ok: true, json: () => body.promise };
    }) as unknown as typeof fetch;
    (listServers as jest.Mock).mockResolvedValue([]);

    const controller = makeController(A);
    const pairing = controller.pair({
      address: 'https://a.example.test',
      code: '123456',
      label: 'A',
      deviceName: 'Test phone',
    });
    await flush();
    await jest.advanceTimersByTimeAsync(12_100);
    expect(signal?.aborted).toBe(true);
    body.reject(new Error('aborted'));
    await expect(pairing).resolves.toMatchObject({ ok: false, code: 'PAIR_TIMEOUT' });

    await controller.forgetServer();
    await flush();
    expect(store.get().profileId).toBeNull();
  });

  it('ignores a late successful pairing body after forget', async () => {
    const body = deferred<{ ok: true; token: string }>();
    global.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: () => body.promise,
    })) as unknown as typeof fetch;
    (listServers as jest.Mock).mockResolvedValue([]);

    const controller = makeController(A);
    const pairing = controller.pair({
      address: 'https://b.example.test',
      code: '654321',
      label: 'B',
      deviceName: 'Test phone',
    });
    await flush();
    await controller.forgetServer();
    await flush();
    body.resolve({ ok: true, token: 'b'.repeat(64) });

    await expect(pairing).resolves.toMatchObject({ ok: false, code: 'PAIR_CANCELLED' });
    expect(saveToken).not.toHaveBeenCalled();
    expect(store.get().profileId).toBeNull();
  });
});

describe('authoritative rename and title fencing', () => {
  it('applies a rename only to its exact session and persists it', async () => {
    const controller = makeController();
    store.setState({
      conversation: resetConversation({
        serverId: 'A',
        sessionId: 'B',
        session: { session_id: 'B', title: 'B title' },
        title: 'B title',
      }),
      inventory: {
        ...store.get().inventory,
        sessions: [
          { session_id: 'A', title: 'A title' },
          { session_id: 'B', title: 'B title' },
        ],
      },
    });

    (controller as unknown as { onFrame: (frame: unknown) => void }).onFrame({
      ev: 'session_renamed',
      session_id: 'A',
      title: 'A renamed',
      display_title: 'A renamed',
    });
    store.setState((state) => ({ conversation: { ...state.conversation } }));
    expect(store.get().conversation.sessionId).toBe('B');
    expect(store.get().conversation.title).toBe('B title');
    expect(store.get().inventory.sessions.find((session) => session.session_id === 'A')?.title).toBe(
      'A renamed',
    );
    expect(updateSessionTitle).toHaveBeenCalledWith('A', 'A', 'A renamed');

    (controller as unknown as { onFrame: (frame: unknown) => void }).onFrame({
      ev: 'session_renamed',
      session_id: 'B',
      title: null,
      display_title: 'Derived B',
    });
    expect(store.get().conversation.title).toBe('Derived B');
    expect(store.get().conversation.session?.title).toBe('Derived B');
  });

  it('keeps a confirmed title over an inventory reply that started before it', () => {
    const controller = makeController();
    (controller as unknown as { applyConfirmedTitle: (...args: unknown[]) => void }).applyConfirmedTitle(
      'A',
      'S',
      'Confirmed',
      'Confirmed',
      2_000,
    );
    const merged = (
      controller as unknown as {
        mergeConfirmedTitle: (serverId: string, session: SessionInfo, revisionAtStart: number) => SessionInfo;
      }
    ).mergeConfirmedTitle('A', { session_id: 'S', title: 'Old' }, 0);
    expect(merged.title).toBe('Confirmed');
    const later = (
      controller as unknown as {
        mergeConfirmedTitle: (serverId: string, session: SessionInfo, revisionAtStart: number) => SessionInfo;
      }
    ).mergeConfirmedTitle('A', { session_id: 'S', title: 'Server title' }, 1);
    expect(later.title).toBe('Server title');
  });

  it('reports a rename only after the adapter confirms it', async () => {
    fakeConfig.session = { session_id: 'S', title: 'Old', working_dir: '/test' };
    const controller = makeController();
    fakeConfig.request = async (_client, request) => {
      if (request.req === 'list_sessions') return { ev: 'sessions', sessions: [], partial: false };
      if (request.req === 'attach_session') {
        return { ev: 'attached', session: fakeConfig.session, attachment_id: 'att', capabilities: [] };
      }
      if (request.req === 'rename_session') {
        return { ev: 'error', code: 'internal', message: 'Rename rejected by the daemon.' };
      }
      return { ev: 'ok' };
    };
    store.setState({
      conversation: resetConversation({ serverId: 'A', sessionId: 'S', title: 'Old' }),
    });
    await connect(controller);
    (controller as unknown as { attachedSessionId: string }).attachedSessionId = 'S';

    const rejected = await controller.renameSession('S', 'New');
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/rejected/);
    expect(store.get().conversation.title).toBe('Old');
  });
});

describe('review race regressions', () => {
  it('does not publish a losing activation token over the winner', async () => {
    const lateToken = deferred<string>();
    (loadToken as jest.Mock).mockImplementation(async (id: string) =>
      id === 'A' ? lateToken.promise : 'b'.repeat(64),
    );
    const controller = makeController(B);
    (controller as unknown as { token: string }).token = 'b'.repeat(64);

    const losing = controller.activateProfile(A, { restore: false, deferConnect: true });
    await flush();
    await controller.activateProfile(B, { restore: false, deferConnect: true });
    await flush();

    lateToken.resolve('a'.repeat(64));
    await losing;
    await flush();

    expect((controller as unknown as { profile: { id: string } }).profile.id).toBe('B');
    expect((controller as unknown as { token: string }).token).toBe('b'.repeat(64));
    expect(fakeClients.every((client) => client.token === 'b'.repeat(64))).toBe(true);
    expect(store.get().profileId).toBe('B');
  });

  it('blocks reconnect while the winning credential is still loading', async () => {
    const bToken = deferred<string>();
    (loadToken as jest.Mock).mockImplementation(async (id: string) =>
      id === 'A' ? 'a'.repeat(64) : bToken.promise,
    );
    const controller = makeController(A);
    (controller as unknown as { installListeners: () => void }).installListeners();
    const network = (globalThis as unknown as {
      __netListener: (state: { isConnected: boolean }) => void;
    }).__netListener;

    const activating = controller.activateProfile(B, { restore: false, deferConnect: true });
    await flush();
    network({ isConnected: false });
    network({ isConnected: true });
    await flush();
    expect(fakeClients).toHaveLength(0);

    bToken.resolve('b'.repeat(64));
    await activating;
    await flush();
    expect(fakeClients.length).toBeGreaterThan(0);
    expect(fakeClients.every((client) => client.token === 'b'.repeat(64))).toBe(true);
    expect(store.get().connection.state).toBe('current');
  });

  it('resumes an activation interrupted by background on foreground', async () => {
    const firstRead = deferred<string>();
    let bReads = 0;
    (loadToken as jest.Mock).mockImplementation(async (id: string) => {
      if (id === 'A') return 'a'.repeat(64);
      bReads += 1;
      return bReads === 1 ? firstRead.promise : 'b'.repeat(64);
    });
    const controller = makeController(A);

    const activating = controller.activateProfile(B, { restore: false, deferConnect: true });
    await flush();
    expect((controller as unknown as { profile: unknown }).profile).toBeNull();

    (controller as unknown as { onBackground: () => void }).onBackground();
    expect(
      (controller as unknown as { pendingActivation: { profile: { id: string } } }).pendingActivation
        .profile.id,
    ).toBe('B');

    firstRead.resolve('b'.repeat(64));
    await activating;
    await flush();
    expect((controller as unknown as { profile: unknown }).profile).toBeNull();

    (controller as unknown as { onForeground: () => Promise<void> }).onForeground();
    await flush();
    await flush();

    expect((controller as unknown as { profile: { id: string } }).profile.id).toBe('B');
    expect((controller as unknown as { token: string }).token).toBe('b'.repeat(64));
    expect(fakeClients.every((client) => client.token === 'b'.repeat(64))).toBe(true);
    expect(store.get().connection.state).toBe('current');
  });

  it('does not let a cancelled pair delete a newer overlapping pair', async () => {
    const tokens = new Map<string, string>();
    const servers = new Map<string, typeof A>();
    servers.set(A.id, A);
    const firstSave = deferred<void>();
    let writes = 0;
    const t1 = '1'.repeat(64);
    const t2 = '2'.repeat(64);

    (loadToken as jest.Mock).mockImplementation(async (id: string) => tokens.get(id) ?? null);
    (saveToken as jest.Mock).mockImplementation(async (id: string, token: string) => {
      writes += 1;
      if (writes === 1) await firstSave.promise;
      tokens.set(id, token);
    });
    (deleteToken as jest.Mock).mockImplementation(async (id: string) => {
      tokens.delete(id);
    });
    (saveServer as jest.Mock).mockImplementation(async (profile: typeof A) => {
      servers.set(profile.id, profile);
    });
    (deleteServer as jest.Mock).mockImplementation(async (id: string) => {
      servers.delete(id);
    });
    (listServers as jest.Mock).mockImplementation(async () => [...servers.values()]);

    let fetchCalls = 0;
    global.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, token: fetchCalls++ === 0 ? t1 : t2 }),
    })) as unknown as typeof fetch;

    const controller = makeController(A);
    const first = controller.pair({
      address: 'https://a.example.test:443',
      code: '123456',
      label: 'A',
      deviceName: 'Phone',
    });
    await flush();
    expect(writes).toBe(1);

    const second = controller.pair({
      address: 'https://a.example.test:443',
      code: '654321',
      label: 'A',
      deviceName: 'Phone',
    });
    await flush();
    // The second attempt is queued behind the paused first save.
    expect(writes).toBe(1);

    firstSave.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await flush();

    expect(firstResult).toMatchObject({ ok: false, code: 'PAIR_CANCELLED' });
    expect(secondResult).toMatchObject({ ok: true });
    expect(tokens.get(A.id)).toBe(t2);
    expect(servers.has(A.id)).toBe(true);
    expect(await loadToken(A.id)).toBe(t2);
  });

  it('serializes cleanup reads with a newer pair write', async () => {
    const tokens = new Map<string, string>();
    const servers = new Map<string, typeof A>();
    servers.set(A.id, A);
    const serverSave = deferred<void>();
    const cleanupRead = deferred<string | null>();
    let serverWrites = 0;
    let tokenReads = 0;
    const t1 = '3'.repeat(64);
    const t2 = '4'.repeat(64);

    (loadToken as jest.Mock).mockImplementation(async (id: string) => {
      tokenReads += 1;
      if (tokenReads === 1) return cleanupRead.promise;
      return tokens.get(id) ?? null;
    });
    (saveToken as jest.Mock).mockImplementation(async (id: string, token: string) => {
      tokens.set(id, token);
    });
    (deleteToken as jest.Mock).mockImplementation(async (id: string) => {
      tokens.delete(id);
    });
    (saveServer as jest.Mock).mockImplementation(async (profile: typeof A) => {
      serverWrites += 1;
      if (serverWrites === 1) await serverSave.promise;
      servers.set(profile.id, profile);
    });
    (deleteServer as jest.Mock).mockImplementation(async (id: string) => {
      servers.delete(id);
    });
    (listServers as jest.Mock).mockImplementation(async () => [...servers.values()]);

    let fetchCalls = 0;
    global.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, token: fetchCalls++ === 0 ? t1 : t2 }),
    })) as unknown as typeof fetch;

    const controller = makeController(A);
    const first = controller.pair({
      address: 'https://a.example.test:443',
      code: '111111',
      label: 'A',
      deviceName: 'Phone',
    });
    await flush();
    expect(tokens.get(A.id)).toBe(t1);

    const second = controller.pair({
      address: 'https://a.example.test:443',
      code: '222222',
      label: 'A',
      deviceName: 'Phone',
    });
    await flush();
    serverSave.resolve();
    await flush();

    // Cleanup is paused on its token read; the newer write is queued behind it.
    expect(tokens.get(A.id)).toBe(t1);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await flush();
    expect(secondSettled).toBe(false);

    cleanupRead.resolve(t1);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await flush();

    expect(firstResult).toMatchObject({ ok: false, code: 'PAIR_CANCELLED' });
    expect(secondResult).toMatchObject({ ok: true });
    expect(tokens.get(A.id)).toBe(t2);
    expect(servers.has(A.id)).toBe(true);
  });

  it('retires a forgotten profile before cleanup and ignores network restoration', async () => {
    const cleanup = deferred<void>();
    (clearServerCache as jest.Mock).mockImplementation(() => cleanup.promise);
    (listServers as jest.Mock).mockResolvedValue([]);
    const controller = makeController(A);
    (controller as unknown as { installListeners: () => void }).installListeners();
    const network = (globalThis as unknown as {
      __netListener: (state: { isConnected: boolean }) => void;
    }).__netListener;

    const forgetting = controller.forgetServer();
    await flush();
    expect((controller as unknown as { profile: unknown }).profile).toBeNull();

    network({ isConnected: false });
    network({ isConnected: true });
    await flush();
    expect(fakeClients).toHaveLength(0);
    expect(saveServer).not.toHaveBeenCalled();

    cleanup.resolve();
    await forgetting;
    await flush();
    expect(store.get().profileId).toBeNull();
    expect((controller as unknown as { token: string | null }).token).toBeNull();
  });

  it('fences a delayed 401 from an old attempt after the same profile reconnects', async () => {
    const who = deferred<{ status: number; ok: boolean }>();
    global.fetch = jest.fn(() => who.promise) as unknown as typeof fetch;
    fakeConfig.request = async (_client, request) => {
      if (request.req === 'list_sessions') {
        return { ev: 'sessions', sessions: [], partial: false };
      }
      if (request.req === 'ping') throw new Error('The server did not answer in time.');
      return { ev: 'ok' };
    };
    const controller = makeController(A);
    await connect(controller);
    expect(store.get().connection.state).toBe('current');

    await jest.advanceTimersByTimeAsync(15_100);
    await flush();
    expect((controller as unknown as { client: unknown }).client).toBeNull();

    await controller.connectNow({ force: true });
    await flush();
    expect(store.get().connection.state).toBe('current');

    who.resolve({ status: 401, ok: false });
    await flush();
    expect(store.get().connection.state).toBe('current');
  });

  it('keeps the newest title when a second rename lands during the correction write', async () => {
    const upsertGate = deferred<void>();
    const correctionGate = deferred<void>();
    const cachedTitles = new Map<string, string | null>();
    let firstTitleWrites = 0;
    (updateSessionTitle as jest.Mock).mockImplementation(async (_profileId, sessionId, title) => {
      if (title === 'First') {
        firstTitleWrites += 1;
        if (firstTitleWrites === 2) await correctionGate.promise;
      }
      cachedTitles.set(sessionId, title);
    });
    const controller = makeController(A);
    await connect(controller);
    (upsertSessions as jest.Mock).mockImplementation(async (_profileId, sessions) => {
      await upsertGate.promise;
      for (const session of sessions) cachedTitles.set(session.session_id, session.title ?? null);
    });
    fakeConfig.request = async (_client, request) => {
      if (request.req === 'list_sessions') {
        return {
          ev: 'sessions',
          sessions: [{ session_id: 'S', title: 'Old', working_dir: '/test' }],
          partial: false,
        };
      }
      return { ev: 'ok' };
    };
    store.setState({
      conversation: resetConversation({ serverId: 'A', sessionId: 'S', title: 'Old' }),
    });

    const refreshing = controller.refreshSessions({ force: true });
    await flush();
    (controller as unknown as { onFrame: (frame: unknown) => void }).onFrame({
      ev: 'session_renamed',
      session_id: 'S',
      title: 'First',
      display_title: 'First',
    });
    await flush();
    expect(cachedTitles.get('S')).toBe('First');

    upsertGate.resolve();
    await flush();
    // The post-inventory correction is now paused on the first title.
    (controller as unknown as { onFrame: (frame: unknown) => void }).onFrame({
      ev: 'session_renamed',
      session_id: 'S',
      title: 'Second',
      display_title: 'Second',
    });
    await flush();
    expect(store.get().conversation.title).toBe('Second');

    correctionGate.resolve();
    await refreshing;
    await flush();

    expect(cachedTitles.get('S')).toBe('Second');
    expect(store.get().conversation.title).toBe('Second');
    expect(
      store.get().inventory.sessions.find((session) => session.session_id === 'S')?.title,
    ).toBe('Second');
  });

  it('reapplies a confirmed title after an older inventory write lands', async () => {
    const write = deferred<void>();
    const cachedTitles = new Map<string, string | null>();
    (updateSessionTitle as jest.Mock).mockImplementation(async (_profileId, sessionId, title) => {
      cachedTitles.set(sessionId, title);
    });

    const controller = makeController(A);
    await connect(controller);
    (upsertSessions as jest.Mock).mockImplementation(async (_profileId, sessions) => {
      await write.promise;
      for (const session of sessions) cachedTitles.set(session.session_id, session.title ?? null);
    });
    fakeConfig.request = async (_client, request) => {
      if (request.req === 'list_sessions') {
        return {
          ev: 'sessions',
          sessions: [{ session_id: 'S', title: 'Old', working_dir: '/test' }],
          partial: false,
        };
      }
      return { ev: 'ok' };
    };
    store.setState({
      conversation: resetConversation({ serverId: 'A', sessionId: 'S', title: 'Old' }),
    });

    const refreshing = controller.refreshSessions({ force: true });
    await flush();
    (controller as unknown as { onFrame: (frame: unknown) => void }).onFrame({
      ev: 'session_renamed',
      session_id: 'S',
      title: 'New',
      display_title: 'New',
    });
    await flush();
    expect(cachedTitles.get('S')).toBe('New');

    write.resolve();
    await refreshing;
    await flush();

    expect(cachedTitles.get('S')).toBe('New');
    expect(store.get().conversation.title).toBe('New');
    expect(
      store.get().inventory.sessions.find((session) => session.session_id === 'S')?.title,
    ).toBe('New');
  });
});
