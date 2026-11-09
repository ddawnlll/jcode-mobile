/**
 * Application controller: connection lifecycle, inventory, and the selected
 * conversation. It lives outside React so nothing it owns depends on a screen
 * staying mounted.
 */
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { budgets } from '../design/tokens';
import { MobileClient, httpBase, parseServerAddress, type ServerEndpoint } from './connection/client';
import { backoffDelay } from './connection/reconnect';
import type { HistoryMessage, ServerEvent, SessionInfo } from './protocol/frames';
import {
  clearCachedConversation,
  clearServerCache,
  deletePendingSend,
  deleteServer,
  getBookmark,
  getDraft,
  getPref,
  initDatabase,
  listPendingSends,
  listServers,
  loadCachedMessages,
  loadCachedSessions,
  savePendingSend,
  saveServer,
  setBookmark,
  setDraft,
  setPref,
  updateSessionLiveState,
  upsertMessages,
  upsertSessions,
  type ServerProfileRow,
} from './persistence/db';
import { deleteToken, loadToken, saveToken } from './persistence/credentials';
import { importDevPairingFile } from './dev/pairing-import';
import { importE2ECredentials } from './dev/e2e-seed';
import {
  deriveSeam,
  formatClock,
  messageFingerprint,
  newClientId,
} from './session/selectors';
import {
  resetConversation,
  store,
  type DeliveryRecord,
  type ExecutionState,
  type ToolRow,
} from './state/store';

const LAST_SERVER = 'lastServerId';
const LAST_SESSION = 'lastSessionId';
const APPEARANCE = 'appearance';
const PRIVACY = 'privacyPreview';
const DEVICE_ID = 'deviceId';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

class AppControllerImpl {
  private client: MobileClient | null = null;
  private profile: ServerProfileRow | null = null;
  private token: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private inventoryTimer: ReturnType<typeof setInterval> | null = null;
  private streamTimer: ReturnType<typeof setTimeout> | null = null;
  private streamText = '';
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDraft: string | null = null;
  private lastTurnId = 0;
  private attachedSessionId: string | null = null;
  private nearBottom = true;
  private appState: AppStateStatus = (AppState.currentState ?? 'active') as AppStateStatus;
  private online = true;
  private booted = false;
  private firstVisit = false;
  private creating: Promise<string> | null = null;
  private connectPromise: Promise<void> | null = null;
  private clientGeneration = 0;
  private expectedAttachSessionId: string | null = null;
  private openSequence = 0;
  private continuationConfirmed = false;
  private lastSessionRefresh = 0;
  private serverInfoObserved = false;

  /* ------------------------------------------------------------- bootstrap */

  async bootstrap(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    try {
      await initDatabase();
      await importE2ECredentials();
      await importDevPairingFile();
      const [appearance, privacy, deviceName] = await Promise.all([
        getPref(APPEARANCE),
        getPref(PRIVACY),
        this.ensureDeviceName(),
      ]);
      store.setState((state) => ({
        appearance:
          appearance === 'light' || appearance === 'night' || appearance === 'system'
            ? appearance
            : 'system',
        privacyPreview: privacy !== '0',
        deviceName,
      }));

      const servers = await listServers();
      const lastServerId = await getPref(LAST_SERVER);
      const profile = servers.find((server) => server.id === lastServerId) ?? servers[0] ?? null;
      if (profile) {
        await this.activateProfile(profile, { restore: true, deferConnect: true });
      } else {
        store.setState({ bootstrap: 'ready' });
      }
    } catch (error) {
      store.setState({ bootstrap: 'failed', bootstrapError: errorMessage(error) });
      return;
    }
    this.installListeners();
  }

  private async ensureDeviceName(): Promise<string> {
    const stored = await getPref(DEVICE_ID);
    if (stored) return getPref('deviceName').then((name) => name ?? 'JCode Mobile');
    const id = newClientId('device');
    await setPref(DEVICE_ID, id);
    const name = 'JCode Mobile';
    await setPref('deviceName', name);
    return name;
  }

  deviceId(): string {
    return store.get().deviceName ?? 'JCode Mobile';
  }

  private installListeners(): void {
    NetInfo.addEventListener((state: NetInfoState) => {
      // A VPS can be reachable over a LAN, VPN, or loopback with no internet
      // route, so only a confirmed transport disconnection is "offline".
      const online = state.isConnected !== false;
      const changed = online !== this.online;
      this.online = online;
      if (!online) {
        this.setConnectionState('offline');
        this.clearReconnect();
      } else if (changed && this.appState === 'active') {
        void this.connectNow({ immediate: true });
      }
    });
    AppState.addEventListener('change', (next) => {
      const previous = this.appState;
      this.appState = next;
      if (next === 'background') {
        this.onBackground();
      } else if (next === 'active' && previous !== 'active') {
        void this.onForeground();
      }
    });
  }

  private onBackground(): void {
    this.clearReconnect();
    this.stopInventoryPolling();
    this.flushStream();
    this.flushDraft();
    // No background keepalive: the daemon owns the turn, the phone releases
    // its socket, and reopening reconciles authoritative history.
    this.client?.close();
    this.client = null;
    this.attachedSessionId = null;
    store.setState((state) => ({ conversation: { ...state.conversation, attachmentId: null } }));
    if (store.get().conversation.sessionId) {
      store.setState((state) => ({
        connection: {
          ...state.connection,
          state: 'cached',
          lastCheckedAt: state.connection.lastCheckedAt ?? Date.now(),
        },
      }));
    }
  }

  private async onForeground(): Promise<void> {
    if (this.profile) {
      await this.connectNow({ immediate: true });
      void this.refreshSessions({ force: true });
      const sessionId = store.get().conversation.sessionId;
      if (sessionId) void this.attachSession(sessionId);
    }
  }

  /* ---------------------------------------------------------------- connect */

  private setConnectionState(
    state: ReturnType<typeof store.get>['connection']['state'],
    error: string | null = null,
  ): void {
    store.setState((current) => ({
      connection: { ...current.connection, state, error },
    }));
  }

  async pair(input: {
    address: string;
    code: string;
    label: string;
    deviceName: string;
  }): Promise<{ ok: true; profileId: string } | { ok: false; error: string; code: string; detail?: string }> {
    const parsed = parseServerAddress(input.address, this.defaultPort());
    if (!parsed.ok) return { ok: false, error: parsed.error, code: 'ADDRESS_INVALID' };
    const code = input.code.replace(/\D/g, '');
    if (code.length !== 6) {
      return { ok: false, error: 'Enter the six-digit pairing code from your server.', code: 'CODE_INVALID' };
    }
    const label = input.label.trim() || parsed.display;
    if (input.deviceName.trim().length === 0) {
      return { ok: false, error: 'Name this phone so you can recognize it later.', code: 'DEVICE_NAME_REQUIRED' };
    }
    const existing = (await listServers()).find(
      (server) =>
        server.host === parsed.endpoint.host &&
        server.port === parsed.endpoint.port &&
        (server.tls === 1) === parsed.endpoint.tls,
    );
    const profileId = existing?.id ?? newClientId('srv');
    const body = {
      code,
      device_id: (await getPref('deviceId')) ?? profileId,
      device_name: input.deviceName.trim(),
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(`${httpBase(parsed.endpoint)}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const timedOut = abort.signal.aborted;
      return {
        ok: false,
        code: timedOut ? 'PAIR_TIMEOUT' : 'PAIR_NETWORK',
        error: timedOut
          ? `Pairing timed out after 12s. ${parsed.display} did not answer /pair. Check DNS, port 7643, firewall, and TLS.`
          : `Cannot reach ${parsed.display}/pair. Check DNS, port 7643, firewall, and that the adapter is running.`,
        detail,
      };
    } finally {
      clearTimeout(timer);
    }
    let payload: { ok?: boolean; token?: string; error?: string };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      payload = { ok: false, error: `The server replied ${response.status} without JSON.` };
    }
    if (!response.ok || !payload.ok || !payload.token) {
      return {
        ok: false,
        code: `PAIR_HTTP_${response.status}`,
        error: payload.error ?? `Pairing failed with HTTP ${response.status}.`,
        detail: `POST ${httpBase(parsed.endpoint)}/pair returned ${response.status}.`,
      };
    }
    const profile: ServerProfileRow = {
      id: profileId,
      label,
      host: parsed.endpoint.host,
      port: parsed.endpoint.port,
      tls: parsed.endpoint.tls ? 1 : 0,
      device_id: body.device_id,
      created_at: existing?.created_at ?? Date.now(),
      last_connected_at: Date.now(),
      daemon_version: existing?.daemon_version ?? null,
      capabilities_json: existing?.capabilities_json ?? null,
    };
    await saveToken(profileId, payload.token);
    await saveServer(profile);
    await setPref(LAST_SERVER, profileId);
    // Pairing is complete once the token is stored. Connect in the background
    // so a slow or broken WebSocket cannot leave the Pair button spinning.
    await this.activateProfile(profile, { restore: false, deferConnect: true });
    return { ok: true, profileId };
  }

  private defaultPort(): number {
    return 7643;
  }

  async activateProfile(profile: ServerProfileRow, options: { restore: boolean; deferConnect?: boolean }): Promise<void> {
    this.clearReconnect();
    this.client?.close();
    this.client = null;
    this.profile = profile;
    this.token = await loadToken(profile.id);
    store.setState((state) => ({
      profileId: profile.id,
      connection: {
        ...state.connection,
        state: 'cached',
        serverLabel: profile.label,
        host: `${profile.host}:${profile.port}`,
        daemonVersion: profile.daemon_version,
        serverName: null,
        capabilities: profile.capabilities_json ? (JSON.parse(profile.capabilities_json) as string[]) : [],
        error: null,
        attempt: 0,
      },
      inventory: { ...state.inventory, sessions: [], fetchedAt: null, error: null },
      conversation: resetConversation({ serverId: profile.id }),
    }));
    const cached = await loadCachedSessions(profile.id);
    if (cached.length) {
      store.setState((state) => ({ inventory: { ...state.inventory, sessions: cached } }));
    }
    store.setState({ bootstrap: 'ready' });
    if (!this.token) {
      this.setConnectionState('pair_again', 'This phone is no longer authorized.');
      return;
    }
    if (options.deferConnect) {
      void this.connectNow({ immediate: true });
    } else {
      await this.connectNow({ immediate: true });
    }
    if (options.restore) {
      const lastSession = await getPref(LAST_SESSION);
      if (lastSession && cached.some((session) => session.session_id === lastSession)) {
        const session = cached.find((entry) => entry.session_id === lastSession)!;
        await this.openSession(session);
      }
    }
  }

  async connectNow(options: { immediate?: boolean; force?: boolean } = {}): Promise<void> {
    if (!this.profile) return;
    if (!this.token) {
      this.setConnectionState('pair_again', 'Pair this phone again.');
      return;
    }
    if (this.connectPromise) return this.connectPromise;
    if (this.appState !== 'active' && !options.force) return;
    if (!this.online && !options.force) {
      this.setConnectionState('offline');
      return;
    }
    this.clearReconnect();
    this.attachedSessionId = null;
    this.expectedAttachSessionId = null;
    this.continuationConfirmed = false;
    const generation = ++this.clientGeneration;
    this.client?.close();
    const hadContent = store.get().conversation.messages.length > 0;
    this.setConnectionState(hadContent ? 'reconnecting' : 'connecting');
    this.connectPromise = (async () => {
      try {
        const client = new MobileClient(
          { host: this.profile!.host, port: this.profile!.port, tls: this.profile!.tls === 1 },
          this.token!,
          {
            onEvent: (frame) => {
              if (generation !== this.clientGeneration) return;
              this.onFrame(frame);
            },
            onState: (state) => {
              if (generation !== this.clientGeneration) return;
              if (state === 'closed' && this.client === client) {
                this.client = null;
                this.onTransportClosed();
              }
            },
          },
        );
        this.client = client;
        await client.connect();
        if (generation !== this.clientGeneration || this.client !== client) {
          client.close();
          return;
        }
        this.reconnectAttempt = 0;
        const hello = client.hello;
        const capabilities = hello && hello.ev === 'hello_ok' ? hello.capabilities : [];
        const daemonVersion = hello && hello.ev === 'hello_ok' ? hello.daemon_version ?? null : null;
        this.serverInfoObserved = false;
        store.setState((state) => ({
          connection: {
            ...state.connection,
            state: 'reconciling',
            lastCheckedAt: Date.now(),
            capabilities,
            daemonVersion,
            error: null,
            attempt: 0,
          },
        }));
        if (this.profile) {
          await saveServer({
            ...this.profile,
            last_connected_at: Date.now(),
            daemon_version: daemonVersion,
            capabilities_json: JSON.stringify(capabilities),
          });
          this.profile = { ...this.profile, last_connected_at: Date.now(), daemon_version: daemonVersion };
        }
        await this.refreshSessions({ force: true });
        const sessionId = store.get().conversation.sessionId;
        if (sessionId) {
          await this.attachSession(sessionId);
        } else {
          this.setConnectionState('current');
        }
        void this.refreshServerInfo();
      } catch (error) {
        if (generation !== this.clientGeneration) return;
        this.client = null;
        await this.classifyFailure(errorMessage(error));
      } finally {
        this.connectPromise = null;
      }
    })();
    return this.connectPromise;
  }

  private async classifyFailure(message: string): Promise<void> {
    const endpoint = this.endpoint();
    if (endpoint && this.token) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4_000);
        let response: Response;
        try {
          response = await fetch(`${httpBase(endpoint)}/whoami`, {
            headers: { authorization: `Bearer ${this.token}` },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (response.status === 401) {
          this.setConnectionState('pair_again', 'This phone is no longer authorized.');
          return;
        }
      } catch {
        // Network-level failure: fall through to reconnect.
      }
    }
    const hadContent = store.get().conversation.messages.length > 0;
    const offline = !this.online || this.reconnectAttempt >= 4;
    this.setConnectionState(
      offline ? 'offline' : hadContent ? 'reconnecting' : 'connecting',
      message,
    );
    this.markDeliveriesUnconfirmed();
    this.scheduleReconnect();
  }

  private onTransportClosed(): void {
    this.attachedSessionId = null;
    store.setState((state) => ({
      conversation: { ...state.conversation, attachmentId: null },
    }));
    this.markDeliveriesUnconfirmed();
    const hadContent = store.get().conversation.messages.length > 0;
    this.setConnectionState(hadContent ? 'reconnecting' : 'offline');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.online || this.appState !== 'active') return;
    if (!this.profile || !this.token) return;
    const delay = backoffDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    store.setState((state) => ({
      connection: { ...state.connection, attempt: this.reconnectAttempt },
    }));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectNow({ immediate: true });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  endpoint(): ServerEndpoint | null {
    if (!this.profile) return null;
    return {
      host: this.profile.host,
      port: this.profile.port,
      tls: this.profile.tls === 1,
    };
  }

  async refreshServerInfo(): Promise<void> {
    if (!this.client?.isOpen) return;
    try {
      const frame = await this.client.request({ req: 'get_server_info' }, 8_000);
      if (frame.ev !== 'server_info') return;
      this.serverInfoObserved = true;
      store.setState((state) => ({
        connection: {
          ...state.connection,
          daemonVersion: frame.daemon_version ?? state.connection.daemonVersion,
          capabilities: frame.capabilities,
          lastCheckedAt: frame.observed_at_ms,
        },
      }));
      if (this.profile) {
        const updated = {
          ...this.profile,
          daemon_version: frame.daemon_version ?? this.profile.daemon_version,
          capabilities_json: JSON.stringify(frame.capabilities),
        };
        this.profile = updated;
        await saveServer(updated);
      }
    } catch {
      // Server info is advisory; the socket state already reports reachability.
    }
  }

  /* --------------------------------------------------------------- inventory */

  startInventoryPolling(): void {
    this.stopInventoryPolling();
    this.inventoryTimer = setInterval(() => {
      if (this.appState === 'active') void this.refreshSessions();
    }, budgets.inventoryRefreshMs);
  }

  stopInventoryPolling(): void {
    if (this.inventoryTimer) clearInterval(this.inventoryTimer);
    this.inventoryTimer = null;
  }

  async refreshSessions(options: { force?: boolean; includeArchived?: boolean } = {}): Promise<void> {
    if (!this.client?.isOpen) {
      const state = store.get();
      if (state.inventory.sessions.length === 0 && this.profile) {
        const cached = await loadCachedSessions(this.profile.id);
        if (cached.length) {
          store.setState((current) => ({ inventory: { ...current.inventory, sessions: cached } }));
        }
      }
      return;
    }
    if (!options.force && Date.now() - this.lastSessionRefresh < 5_000) return;
    const state = store.get();
    const limit = state.inventory.limit;
    const includeArchived = options.includeArchived ?? state.inventory.includeArchived;
    const client = this.client;
    const generation = this.clientGeneration;
    const profileId = this.profile?.id;
    store.setState((current) => ({ inventory: { ...current.inventory, loading: true, error: null } }));
    try {
      const frame = await client.request(
        { req: 'list_sessions', limit, include_archived: includeArchived },
        20_000,
      );
      if (generation !== this.clientGeneration || this.profile?.id !== profileId) return;
      if (frame.ev !== 'sessions') throw new Error('Unexpected inventory reply.');
      this.lastSessionRefresh = Date.now();
      store.setState((current) => ({
        inventory: {
          ...current.inventory,
          sessions: frame.sessions,
          fetchedAt: Date.now(),
          loading: false,
          error: null,
          partial: frame.partial,
          includeArchived,
        },
      }));
      if (this.profile) await upsertSessions(this.profile.id, frame.sessions);
      const currentConversation = store.get().conversation;
      const currentSession = frame.sessions.find(
        (entry) => entry.session_id === currentConversation.sessionId,
      );
      const authoritativeTitle = currentSession?.title ?? currentSession?.save_label ?? null;
      if (authoritativeTitle && authoritativeTitle !== currentConversation.title) {
        store.setState((current) => ({
          conversation: {
            ...current.conversation,
            title: authoritativeTitle,
            session: currentSession ?? current.conversation.session,
          },
        }));
      }
    } catch (error) {
      store.setState((current) => ({
        inventory: { ...current.inventory, loading: false, error: errorMessage(error) },
      }));
    }
  }

  async loadMoreSessions(): Promise<void> {
    store.setState((current) => ({
      inventory: { ...current.inventory, limit: Math.min(current.inventory.limit + 50, 200) },
    }));
    await this.refreshSessions({ force: true });
  }

  async archiveSession(session: SessionInfo): Promise<{ ok: boolean; error?: string }> {
    if (session.live_state === 'working') {
      return { ok: false, error: 'Stop or wait for this turn before archiving.' };
    }
    if (!this.client?.isOpen) return { ok: false, error: 'This action needs a connection.' };
    try {
      const frame = await this.client.request({ req: 'archive_session', session_id: session.session_id }, 15_000);
      if (frame.ev !== 'ok') throw new Error(frame.ev === 'error' ? frame.message : 'Archive failed.');
      store.setState((current) => ({
        inventory: {
          ...current.inventory,
          sessions: current.inventory.sessions.filter((item) => item.session_id !== session.session_id),
          pendingRestore: { session, at: Date.now() },
        },
      }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async restoreSession(session: SessionInfo): Promise<{ ok: boolean; error?: string }> {
    if (!this.client?.isOpen) return { ok: false, error: 'This action needs a connection.' };
    try {
      const frame = await this.client.request({ req: 'restore_session', session_id: session.session_id }, 15_000);
      if (frame.ev !== 'ok') throw new Error(frame.ev === 'error' ? frame.message : 'Restore failed.');
      store.setState((current) => ({
        inventory: {
          ...current.inventory,
          sessions: [session, ...current.inventory.sessions.filter((item) => item.session_id !== session.session_id)],
          pendingRestore: null,
        },
      }));
      await this.refreshSessions({ force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async setSessionSaved(
    sessionId: string,
    saved: boolean,
    label?: string | null,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.client?.isOpen || !this.attachedSessionId || sessionId !== this.attachedSessionId) {
      return { ok: false, error: 'Open the session before changing its saved state.' };
    }
    try {
      const frame = await this.client.request(
        { req: 'set_session_saved', session_id: sessionId, saved, label: label ?? null },
        10_000,
      );
      if (frame.ev !== 'ok') throw new Error(frame.ev === 'error' ? frame.message : 'Could not update the bookmark.');
      store.setState((state) => ({
        conversation: {
          ...state.conversation,
          session: state.conversation.session ? { ...state.conversation.session, saved, save_label: label ?? null } : state.conversation.session,
        },
        inventory: {
          ...state.inventory,
          sessions: state.inventory.sessions.map((session) =>
            session.session_id === sessionId ? { ...session, saved, save_label: label ?? null } : session,
          ),
        },
      }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async readCurrentFile(path: string, maxBytes = 256 * 1024): Promise<{ ok: true; content: string; truncated: boolean } | { ok: false; error: string }> {
    const conversation = store.get().conversation;
    if (!this.client?.isOpen || !conversation.sessionId) {
      return { ok: false, error: 'Reconnect to read the current file.' };
    }
    if (!store.get().connection.capabilities.includes('file_read')) {
      return { ok: false, error: 'This server does not support file reads.' };
    }
    try {
      const frame = await this.client.request(
        { req: 'read_file', session_id: conversation.sessionId, path, max_bytes: maxBytes },
        15_000,
      );
      if (frame.ev !== 'file_content') {
        throw new Error(frame.ev === 'error' ? frame.message : 'The server did not return the file.');
      }
      return { ok: true, content: frame.content, truncated: frame.truncated };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async renameSession(sessionId: string, title: string | null): Promise<{ ok: boolean; error?: string }> {
    if (!this.client?.isOpen || !this.attachedSessionId) {
      return { ok: false, error: 'Open the session before renaming it.' };
    }
    if (sessionId !== this.attachedSessionId) return { ok: false, error: 'Open the session before renaming it.' };
    const client = this.client;
    const generation = this.clientGeneration;
    try {
      const frame = await client.request({ req: 'rename_session', session_id: sessionId, title }, 10_000);
      if (generation !== this.clientGeneration) return { ok: false, error: 'The server changed.' };
      if (frame.ev !== 'ok') throw new Error(frame.ev === 'error' ? frame.message : 'Rename failed.');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  /* ------------------------------------------------------------- conversation */

  async openSession(session: SessionInfo): Promise<void> {
    if (!this.profile) return;
    const serverId = this.profile.id;
    const sequence = ++this.openSequence;
    const previousSession = store.get().conversation.sessionId;
    if (previousSession && previousSession !== session.session_id && this.client?.isOpen) {
      // Detach the old stream without cancelling its remote turn.
      this.client.sendFireAndForget({ req: 'detach_session', session_id: previousSession });
    }
    this.flushDraft();
    this.streamText = '';
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = null;
    this.attachedSessionId = null;
    this.lastTurnId = 0;
    this.nearBottom = true;
    await setPref(LAST_SESSION, session.session_id);

    const cached = await loadCachedMessages(serverId, session.session_id, 120);
    const bookmark = await getBookmark(serverId, session.session_id);
    if (sequence !== this.openSequence || this.profile?.id !== serverId) return;
    this.firstVisit = bookmark === null;
    const pending = await listPendingSends(serverId, session.session_id);
    if (sequence !== this.openSequence || this.profile?.id !== serverId) return;
    const delivery: DeliveryRecord[] = pending.map((row) => ({
      clientMessageId: row.client_message_id,
      content: row.content,
      state:
        row.state === 'accepted'
          ? 'accepted'
          : row.state === 'rejected'
            ? 'rejected'
            : row.state === 'unconfirmed'
              ? 'unconfirmed'
              : row.state === 'queued'
                ? 'queued'
                : row.state === 'added'
                  ? 'added'
                  : 'unconfirmed',
      error: row.error ?? undefined,
      createdAt: row.created_at,
      guidance: row.kind === 'guidance',
    }));
    store.setState({
      conversation: resetConversation({
        serverId,
        sessionId: session.session_id,
        session,
        title: session.title ?? session.save_label ?? 'Session',
        workingDir: session.working_dir ?? null,
        messages: cached.messages,
        totalMessages: Math.max(cached.total, cached.messages.length),
        baseIndex: cached.messages[0]?.index ?? 0,
        hasOlder: (cached.messages[0]?.index ?? 0) > 0,
        delivery,
        historyFreshness: {
          status: cached.messages.length ? 'cached' : 'none',
          observedAt: Date.now(),
        },
        execution: {
          kind: session.live_state === 'working' ? 'working' : session.live_state === 'ready' ? 'ready' : 'unknown',
          label:
            session.live_state === 'working'
              ? 'Working'
              : session.live_state === 'ready'
                ? 'Ready'
                : 'Status unavailable',
          observedAt: Date.now(),
          turnId: 0,
        },
      }),
    });
    // Render the cached conversation now; attach reconciles in the background.
    void this.attachSession(session.session_id);
  }

  async attachSession(sessionId: string): Promise<void> {
    const client = this.client;
    if (!client?.isOpen) return;
    if (this.attachedSessionId === sessionId) return;
    const generation = this.clientGeneration;
    this.attachedSessionId = sessionId;
    this.expectedAttachSessionId = sessionId;
    try {
      const frame = await client.request({ req: 'attach_session', session_id: sessionId }, 20_000);
      if (generation !== this.clientGeneration || this.client !== client) return;
      if (frame.ev === 'error') {
        this.attachedSessionId = null;
        store.setState((state) => ({
          conversation: { ...state.conversation, lastError: frame.message },
        }));
      }
    } catch (error) {
      if (generation !== this.clientGeneration || this.client !== client) return;
      this.attachedSessionId = null;
      store.setState((state) => ({
        conversation: { ...state.conversation, lastError: errorMessage(error) },
      }));
    }
  }

  closeConversation(): void {
    const sessionId = store.get().conversation.sessionId;
    this.flushDraft();
    this.flushStream();
    if (sessionId && this.client?.isOpen) {
      this.client.sendFireAndForget({ req: 'detach_session', session_id: sessionId });
    }
    this.attachedSessionId = null;
    this.lastTurnId = 0;
    store.setState({ conversation: resetConversation({ serverId: this.profile?.id ?? null }) });
  }

  setNearBottom(value: boolean): void {
    this.nearBottom = value;
    if (value) {
      store.setState((state) => ({
        conversation: { ...state.conversation, hasNewActivity: false },
      }));
    }
  }

  async markSeenThrough(index: number): Promise<void> {
    if (!this.profile) return;
    const conversation = store.get().conversation;
    if (!conversation.sessionId) return;
    const nextIndex = Math.max(index, conversation.seam?.index ?? index);
    const message =
      conversation.messages.find((entry) => entry.index === nextIndex) ??
      conversation.messages[conversation.messages.length - 1];
    await setBookmark(
      this.profile.id,
      conversation.sessionId,
      nextIndex,
      message ? messageFingerprint(message) : '',
    );
    store.setState((state) => ({
      conversation: { ...state.conversation, seam: null },
    }));
  }

  async dismissSeam(): Promise<void> {
    await this.markSeenThrough(store.get().conversation.seam?.index ?? store.get().conversation.totalMessages);
  }

  forgetFirstVisitSeam(): void {
    if (!this.firstVisit || !this.profile) return;
    const conversation = store.get().conversation;
    if (!conversation.sessionId) return;
    this.firstVisit = false;
    const last = conversation.messages[conversation.messages.length - 1];
    void setBookmark(
      this.profile.id,
      conversation.sessionId,
      conversation.totalMessages,
      last ? messageFingerprint(last) : '',
    );
  }

  /* --------------------------------------------------------------------- send */

  private unresolvedSend(): DeliveryRecord | undefined {
    return store
      .get()
      .conversation.delivery.find(
        (record) => !record.guidance && (record.state === 'sending' || record.state === 'sent_to_server'),
      );
  }

  canSend(): { ok: true } | { ok: false; reason: string } {
    const state = store.get();
    if (!this.client?.isOpen) return { ok: false, reason: 'Reconnect to send.' };
    if (state.connection.state !== 'current' && state.connection.state !== 'reconciling') {
      return { ok: false, reason: 'Reconnect to send.' };
    }
    if (!this.continuationConfirmed || !state.connection.capabilities.includes('mobile_continuation')) {
      return { ok: false, reason: 'This server does not support safe continuation.' };
    }
    if (state.conversation.execution.kind === 'working') return { ok: true };
    if (this.unresolvedSend()) return { ok: false, reason: 'Waiting for the server to accept your last message.' };
    const unconfirmed = state.conversation.delivery.find((record) => record.state === 'unconfirmed');
    if (unconfirmed) return { ok: false, reason: 'Check the unconfirmed message before sending again.' };
    return { ok: true };
  }

  async send(content: string): Promise<{ ok: boolean; error?: string }> {
    const state = store.get();
    const conversation = state.conversation;
    if (!this.profile || !conversation.sessionId) return { ok: false, error: 'No session is open.' };
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, error: 'Write a message first.' };
    if (!this.client?.isOpen) return { ok: false, error: 'Reconnect to send.' };
    if (conversation.execution.kind === 'working') return this.sendGuidance(trimmed);
    const gate = this.canSend();
    if (!gate.ok) return { ok: false, error: gate.reason };

    const profileId = this.profile.id;
    const sessionId = conversation.sessionId;
    const client = this.client;
    const generation = this.clientGeneration;
    const owns = () =>
      generation === this.clientGeneration &&
      this.profile?.id === profileId &&
      store.get().conversation.sessionId === sessionId;
    const clientMessageId = newClientId('msg');
    const record: DeliveryRecord = {
      clientMessageId,
      content: trimmed,
      state: 'sending',
      createdAt: Date.now(),
    };
    this.addDelivery(record);
    await setDraft(profileId, sessionId, '');
    await savePendingSend(profileId, sessionId, {
      client_message_id: clientMessageId,
      content: trimmed,
      state: 'sending',
      error: null,
      created_at: record.createdAt,
    });
    if (!owns() || this.client !== client) {
      await savePendingSend(profileId, sessionId, {
        client_message_id: clientMessageId,
        content: trimmed,
        state: 'unconfirmed',
        error: 'The server changed before this message was sent.',
        created_at: record.createdAt,
      });
      return { ok: false, error: 'The server changed before this message was sent.' };
    }
    try {
      const frame = await client.request(
        {
          req: 'send_message',
          session_id: sessionId,
          content: trimmed,
          client_message_id: clientMessageId,
        },
        15_000,
      );
      if (frame.ev === 'error') {
        if (owns()) this.updateDelivery(clientMessageId, { state: 'rejected', error: frame.message });
        await savePendingSend(profileId, sessionId, {
          client_message_id: clientMessageId,
          content: trimmed,
          state: 'rejected',
          error: frame.message,
          created_at: record.createdAt,
        });
        return { ok: false, error: frame.message };
      }
      if (owns()) this.updateDelivery(clientMessageId, { state: 'sent_to_server' });
      await savePendingSend(profileId, sessionId, {
        client_message_id: clientMessageId,
        content: trimmed,
        state: 'sent_to_server',
        error: null,
        created_at: record.createdAt,
      });
      return { ok: true };
    } catch {
      // The frame may or may not have reached the server: never auto-resend.
      if (owns()) {
        this.updateDelivery(clientMessageId, {
          state: 'unconfirmed',
          error: 'Delivery unconfirmed. Check the conversation before sending again.',
        });
      }
      await savePendingSend(profileId, sessionId, {
        client_message_id: clientMessageId,
        content: trimmed,
        state: 'unconfirmed',
        error: 'Delivery unconfirmed.',
        created_at: record.createdAt,
      });
      return { ok: false, error: 'Delivery unconfirmed. Check the conversation before sending again.' };
    }
  }

  private async sendGuidance(content: string): Promise<{ ok: boolean; error?: string }> {
    const conversation = store.get().conversation;
    if (!this.profile || !conversation.sessionId || !this.client?.isOpen) {
      return { ok: false, error: 'Reconnect to add an instruction.' };
    }
    if (
      !this.continuationConfirmed ||
      !store.get().connection.capabilities.includes('mobile_continuation')
    ) {
      return { ok: false, error: 'This server does not support safe continuation.' };
    }
    const profileId = this.profile.id;
    const sessionId = conversation.sessionId;
    const client = this.client;
    const generation = this.clientGeneration;
    const owns = () =>
      generation === this.clientGeneration &&
      this.profile?.id === profileId &&
      store.get().conversation.sessionId === sessionId;
    const clientId = newClientId('guid');
    const createdAt = Date.now();
    this.addDelivery({
      clientMessageId: clientId,
      content,
      state: 'sending',
      createdAt,
      guidance: true,
    });
    await setDraft(profileId, sessionId, '');
    await savePendingSend(profileId, sessionId, {
      client_message_id: clientId,
      content,
      state: 'sending',
      kind: 'guidance',
      error: null,
      created_at: createdAt,
    });
    if (!owns() || this.client !== client) {
      return { ok: false, error: 'The server changed before this instruction was sent.' };
    }
    try {
      const frame = await client.request(
        { req: 'soft_interrupt', session_id: sessionId, content, client_id: clientId },
        10_000,
      );
      if (frame.ev === 'error') {
        if (owns()) this.updateDelivery(clientId, { state: 'rejected', error: frame.message });
        await savePendingSend(profileId, sessionId, {
          client_message_id: clientId,
          content,
          state: 'rejected',
          kind: 'guidance',
          error: frame.message,
          created_at: createdAt,
        });
        return { ok: false, error: frame.message };
      }
      if (owns()) this.updateDelivery(clientId, { state: 'queued' });
      await savePendingSend(profileId, sessionId, {
        client_message_id: clientId,
        content,
        state: 'queued',
        kind: 'guidance',
        error: null,
        created_at: createdAt,
      });
      return { ok: true };
    } catch (error) {
      // The instruction may have been queued before the socket died. Never
      // label this a rejection and never auto-resend it.
      if (owns()) {
        this.updateDelivery(clientId, { state: 'unconfirmed', error: 'Instruction delivery unconfirmed.' });
      }
      await savePendingSend(profileId, sessionId, {
        client_message_id: clientId,
        content,
        state: 'unconfirmed',
        kind: 'guidance',
        error: 'Instruction delivery unconfirmed.',
        created_at: createdAt,
      });
      return { ok: false, error: 'Instruction delivery unconfirmed.' };
    }
  }

  async retryDelivery(clientMessageId: string): Promise<{ ok: boolean; error?: string }> {
    const record = store
      .get()
      .conversation.delivery.find((entry) => entry.clientMessageId === clientMessageId);
    if (!record) return { ok: false, error: 'Message not found.' };
    await this.dismissDelivery(clientMessageId);
    return this.send(record.content);
  }

  async dismissDelivery(clientMessageId: string): Promise<void> {
    const conversation = store.get().conversation;
    if (this.profile && conversation.sessionId) {
      await deletePendingSend(this.profile.id, conversation.sessionId, clientMessageId);
    }
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        delivery: state.conversation.delivery.filter(
          (record) => record.clientMessageId !== clientMessageId,
        ),
      },
    }));
  }

  private addDelivery(record: DeliveryRecord): void {
    store.setState((state) => ({
      conversation: { ...state.conversation, delivery: [...state.conversation.delivery, record] },
    }));
  }

  private updateDelivery(clientMessageId: string, patch: Partial<DeliveryRecord>): void {
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        delivery: state.conversation.delivery.map((record) =>
          record.clientMessageId === clientMessageId ? { ...record, ...patch } : record,
        ),
      },
    }));
  }

  private markDeliveriesUnconfirmed(): void {
    const state = store.get();
    const conversation = state.conversation;
    let changed = false;
    const delivery = conversation.delivery.map((record) => {
      if (record.state === 'sending' || record.state === 'sent_to_server') {
        changed = true;
        return {
          ...record,
          state: 'unconfirmed' as const,
          error: 'Delivery unconfirmed. Check the conversation before sending again.',
        };
      }
      return record;
    });
    if (!changed) return;
    store.setState((current) => ({ conversation: { ...current.conversation, delivery } }));
    if (this.profile && conversation.sessionId) {
      for (const record of delivery) {
        if (record.state !== 'unconfirmed') continue;
        void savePendingSend(this.profile.id, conversation.sessionId, {
          client_message_id: record.clientMessageId,
          content: record.content,
          state: 'unconfirmed',
          error: record.error ?? null,
          created_at: record.createdAt,
        });
      }
    }
  }

  async stopTurn(): Promise<{ ok: boolean; error?: string }> {
    const conversation = store.get().conversation;
    if (!conversation.sessionId || !this.client?.isOpen) {
      return { ok: false, error: 'Reconnect to stop this turn.' };
    }
    const previous = conversation.execution;
    const client = this.client;
    const generation = this.clientGeneration;
    const sessionId = conversation.sessionId;
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        execution: { ...state.conversation.execution, kind: 'working', label: 'Stopping…' },
      },
    }));
    try {
      const frame = await client.request({ req: 'cancel', session_id: sessionId }, 10_000);
      if (frame.ev === 'error') throw new Error(frame.message);
      return { ok: true };
    } catch (error) {
      if (generation === this.clientGeneration) {
        store.setState((state) => ({
          conversation: { ...state.conversation, execution: previous },
        }));
      }
      return { ok: false, error: errorMessage(error) };
    }
  }

  /* -------------------------------------------------------------------- work */

  async loadPlan(): Promise<void> {
    const conversation = store.get().conversation;
    const client = this.client;
    const sessionId = conversation.sessionId;
    if (!sessionId || !client?.isOpen) return;
    const generation = this.clientGeneration;
    store.setState((state) => ({ conversation: { ...state.conversation, planLoading: true } }));
    try {
      const frame = await client.request({ req: 'get_todo_state', session_id: sessionId }, 10_000);
      if (generation !== this.clientGeneration || store.get().conversation.sessionId !== sessionId) return;
      if (frame.ev === 'todo_state') {
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            plan: { state: frame.state, observedAt: frame.observed_at_ms },
            planLoading: false,
          },
        }));
      }
    } catch {
      if (generation === this.clientGeneration) {
        store.setState((state) => ({
          conversation: { ...state.conversation, planLoading: false },
        }));
      }
    }
  }

  /* ------------------------------------------------------------- new session */

  async createSession(workingDir: string, instruction: string): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
    if (!this.client?.isOpen) return { ok: false, error: 'Reconnect before starting a session.' };
    if (!workingDir.startsWith('/') || workingDir.trim().length < 2) {
      return { ok: false, error: 'Enter an absolute folder path on the server.' };
    }
    if (this.creating) {
      return { ok: false, error: 'A session is already starting.' };
    }
    const profileId = this.profile?.id;
    if (!profileId) return { ok: false, error: 'No server is selected.' };
    const createKey = `pendingCreate:${profileId}:${workingDir.trim()}`;
    const existingKey = await getPref(createKey);
    const requestKey = existingKey || newClientId('create');
    if (!existingKey) await setPref(createKey, requestKey);
    const client = this.client;
    const generation = this.clientGeneration;
    this.creating = client
      .request({ req: 'create_session', working_dir: workingDir.trim(), client_request_id: requestKey }, 30_000)
      .then((frame) => {
        if (frame.ev !== 'attached') throw new Error(frame.ev === 'error' ? frame.message : 'The server did not return a session.');
        return String(frame.session.session_id);
      })
      .finally(() => {
        this.creating = null;
      });
    try {
      const sessionId = await this.creating;
      if (generation !== this.clientGeneration || this.client !== client || this.profile?.id !== profileId) {
        return { ok: false, error: 'The server changed while this session was starting.' };
      }
      await setPref(createKey, '');
      this.attachedSessionId = sessionId;
      if (this.profile) {
        await setPref(LAST_SESSION, sessionId);
      }
      void this.refreshSessions({ force: true });
      if (instruction.trim()) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await this.send(instruction.trim());
      }
      return { ok: true, sessionId };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  /* ---------------------------------------------------------------- servers */

  async profiles(): Promise<Array<{ id: string; label: string; host: string; active: boolean }>> {
    const rows = await listServers();
    const activeId = store.get().profileId;
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      host: `${row.host}:${row.port}`,
      active: row.id === activeId,
    }));
  }

  async switchProfile(profileId: string): Promise<void> {
    const rows = await listServers();
    const profile = rows.find((row) => row.id === profileId);
    if (!profile) return;
    await setPref(LAST_SERVER, profile.id);
    this.closeConversation();
    await this.activateProfile(profile, { restore: true });
  }

  async forgetServer(): Promise<void> {
    if (!this.profile) return;
    const profileId = this.profile.id;
    this.clearReconnect();
    this.client?.close();
    this.client = null;
    await deleteToken(profileId);
    await deleteServer(profileId);
    await clearServerCache(profileId);
    const remaining = await listServers();
    this.profile = null;
    this.token = null;
    this.attachedSessionId = null;
    store.setState({
      profileId: null,
      connection: {
        state: 'cached',
        lastCheckedAt: null,
        serverLabel: '',
        host: '',
        daemonVersion: null,
        serverName: null,
        capabilities: [],
        error: null,
        attempt: 0,
      },
      inventory: { sessions: [], fetchedAt: null, loading: false, error: null, partial: false, limit: 50, includeArchived: false, pendingRestore: null },
      conversation: resetConversation(),
    });
    if (remaining[0]) await this.activateProfile(remaining[0], { restore: false });
  }

  async disconnect(): Promise<void> {
    this.clearReconnect();
    this.client?.close();
    this.client = null;
    this.attachedSessionId = null;
    this.setConnectionState('cached');
    store.setState((state) => ({
      connection: { ...state.connection, lastCheckedAt: Date.now() },
    }));
  }

  async reconnect(): Promise<void> {
    this.reconnectAttempt = 0;
    await this.connectNow({ immediate: true, force: true });
  }

  async clearLocalCache(): Promise<void> {
    const profile = this.profile;
    const conversation = store.get().conversation;
    if (profile && conversation.sessionId) {
      await clearCachedConversation(profile.id, conversation.sessionId);
    } else if (profile) {
      await clearServerCache(profile.id);
    }
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        messages: [],
        totalMessages: 0,
        baseIndex: 0,
        hasOlder: false,
        historyFreshness: { status: 'none', observedAt: Date.now() },
      },
    }));
  }

  async setAppearance(value: 'system' | 'light' | 'night'): Promise<void> {
    store.setState({ appearance: value });
    await setPref(APPEARANCE, value);
  }

  async setPrivacyPreview(value: boolean): Promise<void> {
    store.setState({ privacyPreview: value });
    await setPref(PRIVACY, value ? '1' : '0');
  }

  async restoreIntent(): Promise<string | null> {
    return getPref(LAST_SESSION);
  }

  async lastFolder(): Promise<string> {
    return (await getPref('lastFolder')) ?? '';
  }

  async recentFolders(): Promise<string[]> {
    const raw = await getPref('recentFolders');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 5) : [];
    } catch {
      return [];
    }
  }

  async rememberFolder(folder: string): Promise<void> {
    const trimmed = folder.trim();
    if (!trimmed) return;
    await setPref('lastFolder', trimmed);
    const existing = await this.recentFolders();
    const next = [trimmed, ...existing.filter((value) => value !== trimmed)].slice(0, 5);
    await setPref('recentFolders', JSON.stringify(next));
  }

  async sessionId(): Promise<string | null> {
    return this.profile?.id ?? null;
  }

  async draft(sessionId: string): Promise<string> {
    if (!this.profile) return '';
    return getDraft(this.profile.id, sessionId);
  }

  setDraftText(sessionId: string, text: string): void {
    if (!this.profile) return;
    this.pendingDraft = text;
    if (this.draftTimer) return;
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      this.flushDraft();
    }, budgets.draftDebounceMs);
    void sessionId;
  }

  flushDraft(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    if (!this.profile || this.pendingDraft === null) return;
    const conversation = store.get().conversation;
    if (!conversation.sessionId) return;
    const value = this.pendingDraft;
    this.pendingDraft = null;
    void setDraft(this.profile.id, conversation.sessionId, value);
  }

  /* ---------------------------------------------------------------- frames */

  private onFrame(frame: ServerEvent & { reply_to?: number }): void {
    const conversation = store.get().conversation;
    const currentAttachment = conversation.attachmentId;
    const belongs = (attachmentId?: string) =>
      !!attachmentId && attachmentId === currentAttachment;

    switch (frame.ev) {
      case 'hello_ok':
        return;
      case 'attached': {
        const session = frame.session;
        const previous = store.get().conversation;
        if (
          this.expectedAttachSessionId &&
          session.session_id !== this.expectedAttachSessionId &&
          session.session_id !== previous.sessionId
        ) {
          return;
        }
        this.expectedAttachSessionId = null;
        this.continuationConfirmed = frame.continuation === true;
        const previousAttachment = previous.attachmentId;
        const sameSession = session.session_id === previous.sessionId;
        this.lastTurnId = 0;
        // A reattach keeps the transcript; a different session starts clean so
        // the previous conversation can never flash under the new title.
        const base = sameSession
          ? previous
          : resetConversation({
              serverId: this.profile?.id ?? previous.serverId,
              sessionId: session.session_id,
            });
        store.setState({
          conversation: {
            ...base,
            // A new attachment identity fences every older event.
            attachmentId: frame.attachment_id,
            sessionId: session.session_id,
            serverId: this.profile?.id ?? previous.serverId,
            session,
            title: session.title ?? session.save_label ?? (sameSession ? previous.title : 'New session'),
            workingDir: session.working_dir ?? (sameSession ? previous.workingDir : null),
            execution: {
              kind: session.live_state === 'working' ? 'working' : 'unknown',
              label: session.live_state === 'working' ? 'Last seen working' : 'Status unavailable',
              observedAt: Date.now(),
              turnId: 0,
            },
            lastError: null,
          },
        });
        if (sameSession && previousAttachment && previousAttachment !== frame.attachment_id) {
          this.markDeliveriesUnconfirmed();
        }
        this.attachedSessionId = session.session_id;
        void this.refreshSessions({ force: true });
        return;
      }
      case 'history': {
        if (!belongs(frame.attachment_id)) return;
        void this.applyHistory(frame);
        return;
      }
      case 'text_delta': {
        if (!belongs(frame.attachment_id)) return;
        if (frame.turn_id < this.lastTurnId) return;
        this.lastTurnId = frame.turn_id;
        this.streamText += frame.text;
        if (this.streamText.length > 512 * 1024) {
          this.streamText = this.streamText.slice(-256 * 1024);
        }
        this.setWorking(frame.turn_id, undefined);
        this.scheduleStreamFlush();
        return;
      }
      case 'text_replace': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        this.streamText = frame.text;
        if (!frame.text) this.flushStream(true);
        else this.scheduleStreamFlush();
        return;
      }
      case 'text_suffix_replace': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        if (this.streamText.endsWith(frame.old_text)) {
          this.streamText = `${this.streamText.slice(0, -frame.old_text.length)}${frame.new_text}`;
        }
        this.scheduleStreamFlush();
        return;
      }
      case 'reasoning_delta': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            reasoning: `${state.conversation.reasoning}${frame.text}`.slice(-16_000),
          },
        }));
        return;
      }
      case 'reasoning_done': {
        if (!belongs(frame.attachment_id)) return;
        return;
      }
      case 'text_done': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        this.flushStream();
        return;
      }
      case 'message_accepted': {
        if (!belongs(frame.attachment_id)) return;
        const record = store
          .get()
          .conversation.delivery.find((entry) => entry.clientMessageId === frame.client_message_id);
        if (record) {
          this.updateDelivery(frame.client_message_id, { state: 'accepted' });
          if (this.profile && conversation.sessionId) {
            void deletePendingSend(this.profile.id, conversation.sessionId, frame.client_message_id);
          }
        }
        this.setWorking(frame.turn_id, undefined);
        return;
      }
      case 'send_rejected': {
        if (!belongs(frame.attachment_id)) return;
        this.updateDelivery(frame.client_message_id, { state: 'rejected', error: frame.message });
        return;
      }
      case 'tool_start': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        const row: ToolRow = {
          callId: frame.call_id,
          name: frame.name,
          state: 'running',
          startedAt: Date.now(),
        };
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            tools: this.boundTools([
              ...state.conversation.tools.filter((tool) => tool.callId !== frame.call_id),
              row,
            ]),
          },
        }));
        this.setWorking(frame.turn_id, frame.name);
        this.flushStream();
        return;
      }
      case 'tool_exec': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            tools: this.boundTools(state.conversation.tools.map((tool) =>
              tool.callId === frame.call_id
                ? { ...tool, input: frame.input ?? tool.input, name: frame.name, state: 'running' }
                : tool,
            )),
          },
        }));
        this.setWorking(frame.turn_id, frame.name);
        return;
      }
      case 'tool_done': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            tools: this.boundTools(state.conversation.tools.map((tool) =>
              tool.callId === frame.call_id
                ? {
                    ...tool,
                    name: frame.name,
                    output: frame.output?.slice(0, 8 * 1024),
                    error: frame.error ?? null,
                    truncated: frame.truncated,
                    state: frame.error ? 'failed' : 'done',
                    completedAt: Date.now(),
                  }
                : tool,
            )),
          },
        }));
        // A tool finishing is not the task finishing.
        this.setWorking(frame.turn_id, undefined);
        return;
      }
      case 'turn_done': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        this.flushStream(true);
        this.commitProvisional();
        this.setExecution({
          kind: 'ready',
          label: 'Ready',
          observedAt: Date.now(),
          turnId: frame.turn_id,
        });
        if (typeof frame.pending_soft_interrupts === 'number') {
          store.setState((state) => ({
            conversation: { ...state.conversation, pendingSoftInterrupts: frame.pending_soft_interrupts ?? 0 },
          }));
        }
        return;
      }
      case 'turn_stopped': {
        if (!belongs(frame.attachment_id) || frame.turn_id < this.lastTurnId) return;
        this.flushStream(true);
        this.commitProvisional();
        this.setExecution({
          kind: 'stopped',
          label:
            frame.reason === 'interrupted'
              ? 'Stopped'
              : frame.reason === 'failure' || frame.reason === 'error'
                ? 'Failed'
                : 'Stopped',
          detail: frame.message,
          observedAt: Date.now(),
          turnId: frame.turn_id,
        });
        return;
      }
      case 'session_status': {
        if (!belongs(frame.attachment_id)) return;
        const working = frame.status === 'running' || frame.status === 'processing';
        const idle = frame.status === 'idle' || frame.status === 'ready';
        if (working) this.setWorking(this.lastTurnId, undefined);
        else if (idle) {
          const previous = store.get().conversation.execution;
          const recentlyStopped =
            previous.kind === 'stopped' && Date.now() - previous.observedAt < 8_000;
          if (recentlyStopped) return;
          this.commitProvisional();
          this.setExecution({
            kind: 'ready',
            label: 'Ready',
            observedAt: Date.now(),
            turnId: this.lastTurnId,
          });
        } else {
          this.setExecution({
            kind: 'unknown',
            label: 'Status unavailable',
            detail: frame.status,
            observedAt: Date.now(),
            turnId: this.lastTurnId,
          });
        }
        if (typeof frame.pending_soft_interrupts === 'number') {
          store.setState((state) => ({
            conversation: {
              ...state.conversation,
              pendingSoftInterrupts: frame.pending_soft_interrupts ?? 0,
            },
          }));
        }
        return;
      }
      case 'connection_phase': {
        if (!belongs(frame.attachment_id)) return;
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            execution: { ...state.conversation.execution, phase: frame.phase },
          },
        }));
        return;
      }
      case 'soft_interrupt_injected': {
        if (!belongs(frame.attachment_id)) return;
        for (const clientId of frame.client_ids) {
          const record = store
            .get()
            .conversation.delivery.find((entry) => entry.clientMessageId === clientId);
          if (record && record.state === 'queued') {
            this.updateDelivery(clientId, { state: 'added' });
            const profile = this.profile;
            const sessionId = store.get().conversation.sessionId;
            if (profile && sessionId) {
              void deletePendingSend(profile.id, sessionId, clientId);
            }
          }
        }
        return;
      }
      case 'soft_interrupts_cancelled': {
        for (const clientId of frame.cancelled) {
          this.updateDelivery(clientId, { state: 'rejected', error: 'Cancelled before delivery.' });
        }
        return;
      }
      case 'session_renamed': {
        store.setState((state) => ({
          conversation: { ...state.conversation, title: frame.display_title },
          inventory: {
            ...state.inventory,
            sessions: state.inventory.sessions.map((session) =>
              session.session_id === frame.session_id
                ? { ...session, title: frame.title ?? frame.display_title }
                : session,
            ),
          },
        }));
        return;
      }
      case 'peer_user_message': {
        if (!belongs(frame.attachment_id)) return;
        // Another client's prompt belongs in the committed transcript, which
        // arrives from authoritative history on the next reconciliation.
        this.setWorking(this.lastTurnId, undefined);
        return;
      }
      case 'todo_state': {
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            plan: { state: frame.state, observedAt: frame.observed_at_ms },
            planLoading: false,
          },
        }));
        return;
      }
      case 'session_closed': {
        store.setState((state) => ({
          conversation: { ...state.conversation, lastError: frame.reason },
        }));
        return;
      }
      case 'error': {
        if (frame.code === 'unauthorized') {
          this.setConnectionState('pair_again', 'This phone is no longer authorized.');
          return;
        }
        if (frame.code === 'daemon_unavailable') {
          this.markDeliveriesUnconfirmed();
          this.setConnectionState('reconnecting', frame.message);
          this.scheduleReconnect();
          return;
        }
        if (frame.code === 'unsupported_version' || frame.code === 'unsupported_capability') {
          this.setConnectionState('incompatible', frame.message);
          return;
        }
        store.setState((state) => ({
          conversation: { ...state.conversation, lastError: frame.message },
        }));
        return;
      }
      default:
        return;
    }
  }

  private boundTools(tools: ToolRow[]): ToolRow[] {
    const recent = tools.slice(-120);
    return recent.map((tool) => ({
      ...tool,
      output: tool.output?.slice(0, 8 * 1024),
    }));
  }

  private setWorking(turnId: number, toolName: string | undefined): void {
    this.setExecution({
      kind: 'working',
      label: toolName ? `Running ${toolName}` : 'Working',
      observedAt: Date.now(),
      turnId,
    });
  }

  private setExecution(execution: ExecutionState): void {
    const current = store.get().conversation.execution;
    const unchanged =
      current.kind === execution.kind &&
      current.label === execution.label &&
      current.detail === execution.detail &&
      current.phase === execution.phase &&
      Date.now() - current.observedAt < 250;
    if (unchanged) return;
    const rose = current.kind !== execution.kind;
    store.setState((state) => ({
      conversation: { ...state.conversation, execution },
    }));
    if ((execution.kind === 'working' || execution.kind === 'ready') && rose) {
      const sessionId = store.get().conversation.sessionId;
      if (sessionId && this.profile) {
        void updateSessionLiveState(
          this.profile.id,
          sessionId,
          execution.kind === 'working' ? 'working' : 'ready',
        );
        store.setState((state) => ({
          inventory: {
            ...state.inventory,
            sessions: state.inventory.sessions.map((session) =>
              session.session_id === sessionId
                ? { ...session, live_state: execution.kind === 'working' ? 'working' : 'ready' }
                : session,
            ),
          },
        }));
        // A finished first turn is when the server titles a new session.
        if (execution.kind === 'ready') void this.refreshSessions({ force: true });
      }
    }
  }

  private scheduleStreamFlush(): void {
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      this.flushStream();
    }, budgets.streamCoalesceMs);
  }

  private flushStream(force = false): void {
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = null;
    if (!this.streamText && !force) return;
    const text = this.streamText;
    store.setState((state) => {
      const conversation = state.conversation;
      const shouldNotify =
        !this.nearBottom && conversation.totalMessages > 0;
      return {
        conversation: {
          ...conversation,
          provisionalText: text,
          reasoning: '',
          hasNewActivity: shouldNotify || conversation.hasNewActivity,
        },
      };
    });
  }

  private commitProvisional(): void {
    const conversation = store.get().conversation;
    if (!conversation.provisionalText.trim()) {
      this.streamText = '';
      store.setState((state) => ({ conversation: { ...state.conversation, provisionalText: '' } }));
      return;
    }
    const index = conversation.totalMessages;
    const message: HistoryMessage = {
      index,
      role: 'assistant',
      content: conversation.provisionalText,
    };
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        messages: [...state.conversation.messages, message],
        totalMessages: index + 1,
        provisionalText: '',
        hasOlder: state.conversation.hasOlder || state.conversation.baseIndex > 0,
      },
    }));
    this.streamText = '';
  }

  private async applyHistory(frame: Extract<ServerEvent, { ev: 'history' }>): Promise<void> {
    const state = store.get();
    const conversation = state.conversation;
    if (!this.profile || !conversation.sessionId) return;
    const serverId = this.profile.id;
    const sessionId = conversation.sessionId;
    const generation = this.clientGeneration;

    const bookmark = await getBookmark(serverId, sessionId);
    if (
      generation !== this.clientGeneration ||
      this.profile?.id !== serverId ||
      store.get().conversation.sessionId !== sessionId
    ) {
      return;
    }
    const firstVisit = bookmark === null && this.firstVisit;
    const seam = deriveSeam(frame.messages, frame.total_messages, frame.base_index, bookmark, firstVisit);
    if (firstVisit) this.firstVisit = false;

    // Acceptance must come from the adapter's correlated ledger, never from
    // equal text elsewhere in the window.
    const accepted = new Set(frame.accepted_client_ids);
    const delivery = conversation.delivery.map((record) =>
      accepted.has(record.clientMessageId) && record.state !== 'accepted'
        ? { ...record, state: 'accepted' as const, error: undefined }
        : record,
    );
    for (const record of delivery) {
      if (record.state === 'accepted') {
        void deletePendingSend(serverId, sessionId, record.clientMessageId);
      }
    }

    const hasNewActivity =
      frame.total_messages > conversation.totalMessages && !this.nearBottom;

    store.setState((current) => ({
      conversation: {
        ...current.conversation,
        messages: frame.messages,
        totalMessages: frame.total_messages,
        baseIndex: frame.base_index,
        hasOlder: frame.base_index > 0,
        loadingOlder: false,
        provisionalText: '',
        reasoning: '',
        delivery,
        seam: seam.index !== null ? { index: seam.index, count: seam.count } : null,
        hasNewActivity: hasNewActivity || current.conversation.hasNewActivity,
        historyFreshness: { status: 'authoritative', observedAt: Date.now() },
        interrupted: frame.interrupted_at_attach === true,
        recovery: frame.recovery ?? null,
        lastError: null,
        execution:
          current.conversation.execution.kind === 'unknown'
            ? {
                kind: 'ready',
                label: 'Ready',
                observedAt: Date.now(),
                turnId: current.conversation.execution.turnId,
              }
            : current.conversation.execution,
      },
      connection:
        current.connection.state === 'reconciling'
          ? { ...current.connection, state: 'current', lastCheckedAt: Date.now(), error: null }
          : current.connection,
    }));

    if (firstVisit) {
      const last = frame.messages[frame.messages.length - 1];
      await setBookmark(serverId, sessionId, frame.total_messages, last ? messageFingerprint(last) : '');
    }

    // Persist asynchronously; a big transcript must not block the frame loop.
    setTimeout(() => {
      void upsertMessages(serverId, sessionId, frame.messages);
    }, 0);
  }

  async loadOlder(): Promise<void> {
    const conversation = store.get().conversation;
    const sessionId = conversation.sessionId;
    const client = this.client;
    const profileId = this.profile?.id;
    if (!client?.isOpen || !sessionId) return;
    if (conversation.loadingOlder || !conversation.hasOlder) return;
    store.setState((state) => ({
      conversation: { ...state.conversation, loadingOlder: true },
    }));
    try {
      const frame = await client.request(
        {
          req: 'get_history_before',
          session_id: sessionId,
          before_index: conversation.baseIndex,
          limit: 40,
        },
        15_000,
        { suppressEvent: true },
      );
      if (frame.ev !== 'history') throw new Error('Unexpected history reply.');
      if (this.profile?.id !== profileId || this.client !== client) return;
      store.setState((state) => {
        if (state.conversation.sessionId !== sessionId) return state;
        const existing = state.conversation.messages;
        const merged = [...frame.messages, ...existing].filter(
          (message, index, list) => list.findIndex((entry) => entry.index === message.index) === index,
        );
        merged.sort((a, b) => a.index - b.index);
        return {
          conversation: {
            ...state.conversation,
            messages: merged,
            baseIndex: frame.base_index,
            hasOlder: frame.has_older ?? (frame.messages.length > 0 && frame.base_index > 0),
            loadingOlder: false,
          },
        };
      });
    } catch {
      store.setState((state) => ({
        conversation: { ...state.conversation, loadingOlder: false },
      }));
    }
  }

  /** Called by the conversation screen when the visible anchor changes. */
  noteReadingAnchor(index: number): void {
    if (!this.profile) return;
    const conversation = store.get().conversation;
    if (!conversation.sessionId) return;
    const message = conversation.messages.find((entry) => entry.index === index);
    if (!message) return;
    void setBookmark(this.profile.id, conversation.sessionId, index, messageFingerprint(message));
  }

  /** Server info for the details screen. */
  async serverDetails(): Promise<{
    label: string;
    host: string;
    tls: boolean;
    state: string;
    daemonVersion: string | null;
    lastCheckedAt: number | null;
    capabilities: string[];
    deviceId: string | null;
  } | null> {
    const state = store.get();
    if (!this.profile) return null;
    if (!this.serverInfoObserved) void this.refreshServerInfo();
    return {
      label: this.profile.label,
      host: `${this.profile.host}:${this.profile.port}`,
      tls: this.profile.tls === 1,
      state: state.connection.state,
      daemonVersion: state.connection.daemonVersion,
      lastCheckedAt: state.connection.lastCheckedAt,
      capabilities: state.connection.capabilities,
      deviceId: this.profile.device_id,
    };
  }

  formatChecked(): string {
    const at = store.get().connection.lastCheckedAt;
    return at ? formatClock(at) : '';
  }
}

export const controller = new AppControllerImpl();
