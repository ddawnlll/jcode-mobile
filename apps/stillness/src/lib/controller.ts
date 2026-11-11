import {
  AdapterClient,
  AdapterRequestError,
  defaultAdapterBase,
  normalizeServerUrl,
  pairDevice,
  type PairedCredential,
} from './adapter';
import {
  getLastSession,
  loadActivityCache,
  loadDraft,
  loadPending,
  loadSessionListCache,
  loadSnapshotCache,
  saveActivityCache,
  saveDraft,
  savePending,
  saveSessionListCache,
  saveSnapshotCache,
  setLastSession,
  type StoredPendingOperation,
} from './cache';
import {
  activeBaseUrl,
  clearCredential,
  credentialStorageProblem,
  initCredentialStorage,
  listCredentials,
  loadCredential,
  saveCredential,
} from './credentials';
import type {
  ActivityItem,
  ActivitySnapshotPayload,
  CancelTurnResponse,
  ContextView,
  CreateSessionResponse,
  DeviceInfo,
  DirEntry,
  DirListing,
  FilePreview,
  HistoryMessageView,
  ModelsListPayload,
  OperationStatePayload,
  OperationView,
  Project,
  RuntimeView,
  ServerHelloPayload,
  ServerInfo,
  SessionEventPayload,
  SessionSnapshot,
  SessionSummary,
  SessionsListPayload,
} from './protocol';

export type Screen =
  | 'welcome'
  | 'pair'
  | 'pairing'
  | 'ready'
  | 'home'
  | 'sessions'
  | 'session'
  | 'projects'
  | 'project'
  | 'plan'
  | 'activity'
  | 'changes'
  | 'settings'
  | 'new-session'
  | 'browser'
  | 'project-create';

export type Phase = 'unpaired' | 'pairing' | 'ready' | 'app' | 'loading';

export interface LiveTool {
  callId: string;
  name: string;
  input: string;
  output: string;
  error: string | null;
  status: 'started' | 'running' | 'done' | 'failed';
}

export interface LiveBlock {
  id: string;
  text: string;
  done: boolean;
}

export interface LiveState {
  turnId: string | null;
  operationId: string | null;
  finishedTurnId: string | null;
  status: string;
  phase: string;
  startedAtMs: number | null;
  assistants: LiveBlock[];
  reasoning: string;
  tools: LiveTool[];
  permission: { requestId: string; toolName: string; description: string } | null;
  recovery: { continuation: string; notice: string | null } | null;
  error: string | null;
  needsReconcile: boolean;
}

export interface PendingMessage {
  text: string;
  operationId: string;
  state: string;
  error: string | null;
  createdAt: number;
}

export interface BrowserState {
  projectId: string;
  path: string;
  entries: DirEntry[];
  preview: FilePreview | null;
  loading: boolean;
  error: string | null;
  cursor: string | null;
}

export interface AppState {
  phase: Phase;
  screen: Screen;
  credential: PairedCredential | null;
  server: ServerInfo | null;
  device: DeviceInfo | null;
  pairingError: string | null;
  pairingStage: 'idle' | 'pairing' | 'connecting' | 'verified' | 'error';
  pairingMessage: string;
  connection: { status: 'connecting' | 'connected' | 'offline'; message: string | null };
  jcodeConnected: boolean;
  savedOnPhone: boolean;
  sessions: SessionSummary[];
  projects: Project[];
  sessionsSource: string;
  sessionsError: string | null;
  activeSessionId: string | null;
  activeMissing: boolean;
  snapshot: SessionSnapshot | null;
  live: LiveState;
  pending: PendingMessage | null;
  operations: Record<string, OperationView>;
  models: ModelsListPayload | null;
  runtime: RuntimeView | null;
  context: ContextView | null;
  plan: unknown | null;
  activity: ActivityItem[];
  devices: DeviceInfo[];
  lastSeq: number;
  epoch: string | null;
  reconciling: boolean;
  composerText: string;
  theme: 'light' | 'dark' | 'system';
  motion: 'system' | 'reduced';
  glass: boolean;
  reasoningVisibility: 'compact' | 'hidden' | 'expanded';
  drawerOpen: boolean;
  sheet: 'model' | 'reasoning' | 'context' | null;
  toast: string | null;
  activeProjectId: string | null;
  browser: BrowserState | null;
  credentialsKnown: number;
}

const PREFS_KEY = 'jcode.mobile.v3.preferences';

function emptyLive(): LiveState {
  return {
    turnId: null,
    operationId: null,
    finishedTurnId: null,
    status: 'idle',
    phase: '',
    startedAtMs: null,
    assistants: [],
    reasoning: '',
    tools: [],
    permission: null,
    recovery: null,
    error: null,
    needsReconcile: false,
  };
}

interface Preferences {
  theme: AppState['theme'];
  motion: AppState['motion'];
  glass: boolean;
  reasoningVisibility: AppState['reasoningVisibility'];
  lastBaseUrl: string | null;
}

function loadPreferences(): Preferences {
  const fallback: Preferences = {
    theme: 'system',
    motion: 'system',
    glass: true,
    reasoningVisibility: 'compact',
    lastBaseUrl: null,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return fallback;
  }
}

export function defaultServerAddress(): string {
  return defaultAdapterBase();
}

export class Controller {
  private state: AppState;
  private client: AdapterClient | null = null;
  private listeners = new Set<() => void>();
  private notifyTimer: number | null = null;
  private snapshotTimer: number | null = null;
  private sessionsTimer: number | null = null;
  private unsubscribers: Array<() => void> = [];
  private snapshotInFlight = false;
  private refreshingSessions = false;

  constructor() {
    const prefs = loadPreferences();
    this.state = {
      phase: 'loading',
      screen: 'welcome',
      credential: null,
      server: null,
      device: null,
      pairingError: null,
      pairingStage: 'idle',
      pairingMessage: '',
      connection: { status: 'offline', message: null },
      jcodeConnected: false,
      savedOnPhone: false,
      sessions: [],
      projects: [],
      sessionsSource: '',
      sessionsError: null,
      activeSessionId: null,
      activeMissing: false,
      snapshot: null,
      live: emptyLive(),
      pending: null,
      operations: {},
      models: null,
      runtime: null,
      context: null,
      plan: null,
      activity: [],
      devices: [],
      lastSeq: 0,
      epoch: null,
      reconciling: false,
      composerText: '',
      theme: prefs.theme,
      motion: prefs.motion,
      glass: prefs.glass,
      reasoningVisibility: prefs.reasoningVisibility,
      drawerOpen: false,
      sheet: null,
      toast: null,
      activeProjectId: null,
      browser: null,
      credentialsKnown: listCredentials().length,
    };
    window.setTimeout(() => this.restore(), 0);
  }

  getSnapshot = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(immediate = false) {
    if (immediate) {
      if (this.notifyTimer != null) {
        window.clearTimeout(this.notifyTimer);
        this.notifyTimer = null;
      }
      for (const listener of this.listeners) listener();
      return;
    }
    if (this.notifyTimer != null) return;
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.listeners) listener();
    }, 50);
  }

  private setState(patch: Partial<AppState>, immediate = false) {
    this.state = { ...this.state, ...patch };
    this.emit(immediate);
  }

  private patchLive(patch: Partial<LiveState>, immediate = false) {
    this.state = { ...this.state, live: { ...this.state.live, ...patch } };
    this.emit(immediate);
  }

  private savePreferences() {
    const prefs: Preferences = {
      theme: this.state.theme,
      motion: this.state.motion,
      glass: this.state.glass,
      reasoningVisibility: this.state.reasoningVisibility,
      lastBaseUrl: this.state.credential?.baseUrl ?? activeBaseUrl(),
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  private async restore() {
    await initCredentialStorage();
    const storageProblem = credentialStorageProblem();
    if (storageProblem) {
      this.setState({
        phase: 'unpaired',
        screen: 'pair',
        pairingStage: 'error',
        pairingError: `The desktop credential store is unavailable: ${storageProblem}`,
      }, true);
      return;
    }
    const credential = loadCredential();
    if (!credential) {
      this.setState({ phase: 'unpaired', screen: 'welcome', credentialsKnown: listCredentials().length }, true);
      return;
    }
    const cached = loadSessionListCache(credential.serverId);
    this.setState(
      {
        credential,
        phase: 'pairing',
        screen: 'pairing',
        pairingStage: 'connecting',
        pairingMessage: 'Restoring the saved server pairing.',
        connection: { status: 'connecting', message: null },
        sessions: cached?.sessions ?? [],
        projects: cached?.projects ?? [],
        sessionsSource: cached?.source ?? '',
        savedOnPhone: Boolean(cached),
      },
      true,
    );
    await this.startClient(credential, false);
  }

  private async startClient(credential: PairedCredential, brandNewPairing: boolean) {
    this.client?.close();
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    const client = new AdapterClient(credential.baseUrl, credential.token);
    this.client = client;
    this.bind(client);
    try {
      const hello = await client.connect();
      this.serverHello(hello, credential);
      if (brandNewPairing) {
        this.setState(
          {
            phase: 'ready',
            screen: 'ready',
            pairingStage: 'verified',
            pairingMessage: 'The adapter confirmed this device.',
            connection: { status: 'connected', message: null },
            server: hello.server,
            device: hello.device,
            credential,
          },
          true,
        );
      } else {
        this.setState(
          {
            phase: 'app',
            server: hello.server,
            device: hello.device,
            connection: { status: 'connected', message: null },
            jcodeConnected: hello.server.healthy,
            credentialsKnown: listCredentials().length,
          },
          true,
        );
        await this.refreshSessions();
        const last = getLastSession(credential.serverId);
        const available = this.state.sessions.some((session) => session.session_id === last);
        if (last && available) {
          await this.openSession(last);
        } else {
          this.setState({ screen: 'home' }, true);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cached = loadSessionListCache(credential.serverId);
      if (brandNewPairing) {
        this.setState(
          {
            phase: 'unpaired',
            screen: 'pair',
            pairingStage: 'error',
            pairingError: `The adapter accepted pairing, but the authenticated channel failed: ${message}`,
          },
          true,
        );
      } else {
        this.setState(
          {
            phase: 'app',
            screen: cached ? 'home' : 'home',
            connection: { status: 'offline', message },
            savedOnPhone: Boolean(cached),
            sessions: cached?.sessions ?? [],
            projects: cached?.projects ?? [],
            sessionsSource: cached?.source ?? '',
            sessionsError: 'Adapter unreachable. Showing data saved on this phone.',
          },
          true,
        );
      }
    }
  }

  private serverHello(hello: ServerHelloPayload, credential: PairedCredential) {
    if (credential.serverId !== hello.server.server_id) {
      // A host can change identity after a reset. Do not silently keep writing
      // cached data from the previous identity into the new one.
      this.setState({
        server: hello.server,
        savedOnPhone: false,
        sessions: [],
        projects: [],
        sessionsSource: '',
      });
    }
    this.setState({ server: hello.server, device: hello.device });
  }

  private bind(client: AdapterClient) {
    this.unsubscribers.push(
      client.on('session.event', (raw) => {
        this.onSessionEvent(raw as Parameters<Controller['onSessionEvent']>[0]);
      }),
      client.on('operations.state', (raw) => {
        const envelope = raw as { payload?: OperationStatePayload; session_id?: string };
        if (envelope.payload?.operation) this.applyOperation(envelope.payload.operation);
      }),
      client.on('server.connection', (raw) => {
        const payload = (raw as { payload?: { jcode_connected: boolean; message: string | null } }).payload;
        if (!payload) return;
        this.setState({
          jcodeConnected: payload.jcode_connected,
          connection: this.state.connection.status === 'offline'
            ? this.state.connection
            : {
                status: 'connected',
                message: payload.jcode_connected ? null : payload.message ?? 'JCode harness unavailable',
              },
        });
      }),
      client.on('sessions.changed', () => this.scheduleSessionsRefresh()),
      client.on('disconnected', (raw) => {
        const detail = raw as { reason?: string } | null;
        this.setState({
          connection: { status: 'offline', message: detail?.reason ?? 'Adapter connection lost' },
          savedOnPhone: true,
          sessionsError: 'Adapter unreachable. Showing data saved on this phone.',
        });
      }),
      client.on('reconnected', () => {
        this.setState({ connection: { status: 'connected', message: null } }, true);
        void this.refreshSessions();
        if (this.state.activeSessionId) {
          void this.subscribeToSession(this.state.activeSessionId, true);
        }
      }),
      client.on('connected', () => {
        this.setState({ connection: { status: 'connected', message: null } }, true);
      }),
    );
  }

  private scheduleSessionsRefresh() {
    if (this.sessionsTimer != null) return;
    this.sessionsTimer = window.setTimeout(() => {
      this.sessionsTimer = null;
      void this.refreshSessions();
    }, 350);
  }

  async refreshSessions() {
    if (!this.client || !this.state.credential || this.refreshingSessions) return;
    if (this.client.status !== 'connected') return;
    this.refreshingSessions = true;
    try {
      const payload = await this.client.request<SessionsListPayload>('sessions.list', {}, 20_000);
      const credential = this.state.credential;
      saveSessionListCache(credential.serverId, {
        sessions: payload.sessions,
        projects: payload.projects,
        observed_at_ms: payload.observed_at_ms,
        source: payload.source,
      });
      const active = this.state.activeSessionId;
      this.setState({
        sessions: payload.sessions,
        projects: payload.projects,
        sessionsSource: payload.source,
        sessionsError: null,
        savedOnPhone: false,
        activeMissing: Boolean(active && !payload.sessions.some((session) => session.session_id === active)),
      });
    } catch (error) {
      const cached = loadSessionListCache(this.state.credential.serverId);
      this.setState({
        sessionsError:
          error instanceof Error
            ? `Sessions could not be refreshed: ${error.message}`
            : 'Sessions could not be refreshed.',
        savedOnPhone: Boolean(cached),
      });
    } finally {
      this.refreshingSessions = false;
    }
  }

  async pair(baseUrl: string, code: string, deviceName: string) {
    this.setState(
      {
        phase: 'pairing',
        screen: 'pairing',
        pairingStage: 'pairing',
        pairingError: null,
        pairingMessage: 'Exchanging the one-time pairing code.',
      },
      true,
    );
    try {
      const normalized = normalizeServerUrl(baseUrl);
      const response = await pairDevice(normalized, code, deviceName);
      const credential: PairedCredential = {
        baseUrl: normalized,
        token: response.token,
        device: response.device,
        serverId: response.server.server_id,
        savedAt: Date.now(),
      };
      await saveCredential(credential);
      this.setState({
        credential,
        device: response.device,
        server: response.server,
        pairingStage: 'connecting',
        pairingMessage: 'Negotiating the authenticated mobile channel.',
        credentialsKnown: listCredentials().length,
      });
      await this.startClient(credential, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState(
        {
          phase: 'unpaired',
          screen: 'pair',
          pairingStage: 'error',
          pairingError: message,
        },
        true,
      );
    }
  }

  enterApp() {
    this.setState({ phase: 'app', screen: 'home', drawerOpen: false }, true);
    void this.refreshSessions();
  }

  go(screen: Screen, immediate = true) {
    this.setState({ screen, drawerOpen: false, sheet: null }, immediate);
  }

  openDrawer(open: boolean) {
    this.setState({ drawerOpen: open }, true);
  }

  openSheet(sheet: AppState['sheet']) {
    this.setState({ sheet }, true);
  }

  setToast(message: string | null) {
    this.setState({ toast: message }, true);
    if (message) {
      window.setTimeout(() => {
        if (this.state.toast === message) this.setState({ toast: null });
      }, 4200);
    }
  }

  async openSession(sessionId: string) {
    if (!this.state.credential) return;
    const serverId = this.state.credential.serverId;
    const cached = loadSnapshotCache(serverId, sessionId);
    const draft = loadDraft(serverId, sessionId);
    const storedPending = loadPending(serverId, sessionId);
    this.setState(
      {
        screen: 'session',
        drawerOpen: false,
        activeSessionId: sessionId,
        activeMissing: false,
        snapshot: cached,
        savedOnPhone: Boolean(cached),
        live: emptyLive(),
        pending: storedPending
          ? {
              text: storedPending.text,
              operationId: storedPending.operation_id,
              state: storedPending.state,
              error: null,
              createdAt: storedPending.created_at_ms,
            }
          : null,
        composerText: draft,
        lastSeq: cached?.last_seq ?? 0,
        epoch: cached?.epoch ?? null,
        plan: cached?.plan ?? null,
        context: cached?.context ?? null,
        runtime: cached?.runtime ?? null,
        models: null,
        activity: loadActivityCache(serverId, sessionId)?.items ?? [],
        reconciling: false,
      },
      true,
    );
    setLastSession(serverId, sessionId);
    if (storedPending) {
      void this.lookupOperation(storedPending.operation_id);
    }
    if (!this.client || this.client.status !== 'connected') return;
    await this.subscribeToSession(sessionId, false);
    void this.refreshModels(sessionId);
    void this.refreshPlan(sessionId);
    void this.refreshActivity(sessionId);
    void this.refreshContext(sessionId);
  }

  private async subscribeToSession(sessionId: string, forReconnect: boolean) {
    if (!this.client || this.client.status !== 'connected') return;
    if (!forReconnect) this.setState({ reconciling: true });
    try {
      const snapshot = await this.client.request<SessionSnapshot>(
        'sessions.subscribe',
        {
          session_id: sessionId,
          tail: 160,
          after_seq: forReconnect ? this.state.lastSeq || null : null,
        },
        35_000,
        { sessionId },
      );
      if (this.state.activeSessionId !== sessionId) return;
      this.applySnapshot(snapshot);
    } catch (error) {
      if (this.state.activeSessionId !== sessionId) return;
      this.setState({
        reconciling: false,
        sessionsError:
          error instanceof Error ? `Session could not be restored: ${error.message}` : 'Session could not be restored.',
        savedOnPhone: true,
      });
    }
  }

  private applySnapshot(snapshot: SessionSnapshot) {
    if (!this.state.credential) return;
    if (this.state.activeSessionId && snapshot.session.session_id !== this.state.activeSessionId) return;
    const credential = this.state.credential;
    saveSnapshotCache(credential.serverId, snapshot);
    const pendingInHistory = this.state.pending
      ? snapshot.messages.some(
          (message) => message.role === 'user' && message.content === this.state.pending?.text,
        )
      : false;
    const liveText = this.state.live.assistants.map((block) => block.text).join('\n\n');
    const lastAssistant = [...snapshot.messages].reverse().find((message) => message.role === 'assistant');
    const includesLive = Boolean(
      liveText && lastAssistant && lastAssistant.content.includes(liveText.slice(-120)),
    );
    const clearLive =
      !snapshot.stale &&
      (includesLive || (!this.state.live.turnId && !this.state.live.assistants.length));
    const sessions = this.state.sessions.map((session) =>
      session.session_id === snapshot.session.session_id ? snapshot.session : session,
    );
    if (pendingInHistory) {
      savePending(credential.serverId, snapshot.session.session_id, null);
      saveDraft(credential.serverId, snapshot.session.session_id, '');
    }
    this.setState({
      snapshot,
      sessions,
      lastSeq: snapshot.last_seq,
      epoch: snapshot.epoch,
      plan: snapshot.plan ?? this.state.plan,
      context: snapshot.context ?? this.state.context,
      runtime: snapshot.runtime ?? this.state.runtime,
      savedOnPhone: false,
      sessionsError: null,
      reconciling: snapshot.stale,
      activeMissing: false,
      live: clearLive
        ? emptyLive()
        : { ...this.state.live, needsReconcile: false, status: snapshot.stale ? 'reconciling' : this.state.live.status },
      pending: pendingInHistory ? null : this.state.pending,
      composerText: pendingInHistory ? '' : this.state.composerText,
    });
    if (snapshot.session.title) {
      document.title = `${snapshot.session.title} · JCode`;
    }
  }

  private onSessionEvent(envelope: {
    session_id?: string;
    epoch?: string;
    seq?: number;
    payload?: SessionEventPayload;
  }) {
    if (!envelope.payload || !envelope.session_id) return;
    if (envelope.session_id !== this.state.activeSessionId) return;
    if (!this.state.snapshot) {
      this.scheduleSnapshot(250);
      return;
    }
    if (this.state.epoch && envelope.epoch && envelope.epoch !== this.state.epoch) {
      this.patchLive({ needsReconcile: true });
      this.scheduleSnapshot(150);
      return;
    }
    const seq = envelope.seq ?? 0;
    if (seq > 0) {
      if (seq <= this.state.lastSeq) return;
      if (this.state.lastSeq > 0 && seq > this.state.lastSeq + 1) {
        this.patchLive({ needsReconcile: true, status: 'reconciling' });
        this.scheduleSnapshot(150);
        return;
      }
      this.setState({ lastSeq: seq, reconciling: false });
    }
    const payload = envelope.payload;
    const event = payload.event;
    const eventTurn = payload.turn_id ?? (event.kind === 'turn_started' ? event.turn_id : null);
    const live = this.state.live;
    const fencedKinds = new Set([
      'text_delta',
      'text_done',
      'text_replace',
      'reasoning_delta',
      'reasoning_done',
      'tool_start',
      'tool_input_delta',
      'tool_exec',
      'tool_done',
      'turn_stopped',
      'turn_done',
    ]);
    if (
      eventTurn &&
      fencedKinds.has(event.kind) &&
      ((live.turnId && eventTurn !== live.turnId) || eventTurn === live.finishedTurnId)
    ) {
      return;
    }
    switch (event.kind) {
      case 'turn_started': {
        this.setState({
          live: {
            ...emptyLive(),
            turnId: event.turn_id,
            operationId: event.operation_id,
            status: 'dispatching',
            startedAtMs: payload.observed_at_ms,
          },
        });
        break;
      }
      case 'text_delta': {
        this.appendText(event.text, event.message_id);
        break;
      }
      case 'text_done': {
        this.finishBlock(event.message_id);
        break;
      }
      case 'text_replace': {
        this.replaceText(event.text, event.message_id);
        break;
      }
      case 'reasoning_delta': {
        this.patchLive({ reasoning: `${this.state.live.reasoning}${event.text}`, status: 'thinking' });
        break;
      }
      case 'reasoning_done': {
        this.patchLive({ status: 'working' });
        break;
      }
      case 'tool_start': {
        this.upsertTool(event.call_id, event.name, 'started');
        break;
      }
      case 'tool_input_delta': {
        const tool = this.state.live.tools.find((item) => item.callId === event.call_id);
        this.upsertTool(event.call_id, tool?.name ?? 'tool', 'running', tool?.input ?? '', event.delta);
        break;
      }
      case 'tool_exec': {
        this.upsertTool(event.call_id, event.name, 'running');
        break;
      }
      case 'tool_done': {
        this.upsertTool(event.call_id, event.name, event.error ? 'failed' : 'done', '', '', event.output, event.error);
        break;
      }
      case 'permission_request': {
        this.patchLive({
          permission: {
            requestId: event.request_id,
            toolName: event.tool_name,
            description: event.description,
          },
          status: 'waiting for permission',
        });
        break;
      }
      case 'token_usage': {
        this.setState({
          context: {
            input_tokens: event.input,
            output_tokens: event.output,
            cache_read_input: event.cache_read_input,
            cache_creation_input: event.cache_creation_input,
            effective_budget: event.effective_budget,
            provider: this.state.runtime?.provider ?? null,
            model: this.state.runtime?.model ?? null,
            observed_at_ms: payload.observed_at_ms,
            source: 'jcode.token_usage',
          },
        });
        break;
      }
      case 'session_status': {
        this.patchLive({ status: event.status });
        break;
      }
      case 'connection_phase': {
        this.patchLive({ phase: event.phase });
        break;
      }
      case 'session_recovery': {
        this.patchLive({
          recovery: {
            continuation: event.continuation_message,
            notice: event.reconnect_notice,
          },
        });
        break;
      }
      case 'title_changed': {
        const snapshot = this.state.snapshot;
        if (snapshot) {
          this.setState({
            snapshot: {
              ...snapshot,
              session: { ...snapshot.session, title: event.display_title || event.title },
            },
            sessions: this.state.sessions.map((session) =>
              session.session_id === snapshot.session.session_id
                ? { ...session, title: event.display_title || event.title }
                : session,
            ),
          });
        }
        break;
      }
      case 'plan_updated': {
        this.setState({ plan: event.plan });
        break;
      }
      case 'context_cap_changed': {
        const context = this.state.context;
        if (context) {
          this.setState({
            context: { ...context, effective_budget: event.effective_budget },
          });
        }
        break;
      }
      case 'adapter_error': {
        this.patchLive({ error: `${event.code}: ${event.message}`, status: 'error' });
        break;
      }
      case 'turn_stopped': {
        this.finishTurn(event.turn_id, 'stopped');
        break;
      }
      case 'turn_done': {
        this.finishTurn(event.turn_id, 'done');
        break;
      }
      case 'needs_reconcile': {
        this.patchLive({ needsReconcile: true, status: 'reconciling' });
        this.scheduleSnapshot(200);
        break;
      }
    }
  }

  private appendText(text: string, messageId: string | null) {
    const id = messageId ?? 'current';
    const assistants = [...this.state.live.assistants];
    let block = assistants.find((item) => item.id === id);
    if (!block) {
      block = { id, text: '', done: false };
      assistants.push(block);
    }
    block.text += text;
    this.setState({
      live: {
        ...this.state.live,
        assistants,
        status: this.state.live.status === 'thinking' ? 'writing' : this.state.live.status === 'idle' ? 'working' : this.state.live.status,
      },
    });
  }

  private replaceText(text: string, messageId: string | null) {
    const id = messageId ?? 'current';
    const assistants = [...this.state.live.assistants];
    let block = assistants.find((item) => item.id === id);
    if (!block) {
      block = { id, text, done: false };
      assistants.push(block);
    } else {
      block.text = text;
    }
    this.setState({ live: { ...this.state.live, assistants } });
  }

  private finishBlock(messageId: string | null) {
    const id = messageId ?? 'current';
    this.setState({
      live: {
        ...this.state.live,
        assistants: this.state.live.assistants.map((block) =>
          block.id === id ? { ...block, done: true } : block,
        ),
      },
    });
  }

  private upsertTool(
    callId: string,
    name: string,
    status: LiveTool['status'],
    initialInput = '',
    inputDelta = '',
    output = '',
    error: string | null = null,
  ) {
    const tools = [...this.state.live.tools];
    const index = tools.findIndex((tool) => tool.callId === callId);
    if (index === -1) {
      tools.push({
        callId,
        name,
        input: initialInput + inputDelta,
        output,
        error,
        status,
      });
    } else {
      tools[index] = {
        ...tools[index],
        name: name || tools[index].name,
        input: tools[index].input + inputDelta,
        output: output || tools[index].output,
        error: error ?? tools[index].error,
        status,
      };
    }
    this.patchLive({ tools, status: status === 'failed' ? 'tool failed' : 'working' });
  }

  private finishTurn(turnId: string | null, status: 'done' | 'stopped') {
    this.patchLive({
      turnId: null,
      finishedTurnId: turnId ?? this.state.live.turnId ?? this.state.live.finishedTurnId,
      status,
      phase: '',
      permission: null,
    });
    this.scheduleSnapshot(320);
  }

  private scheduleSnapshot(delayMs: number) {
    if (this.snapshotTimer != null) window.clearTimeout(this.snapshotTimer);
    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = null;
      void this.refreshSnapshot();
    }, delayMs);
  }

  async refreshSnapshot() {
    if (!this.client || this.client.status !== 'connected') return;
    const sessionId = this.state.activeSessionId;
    if (!sessionId || this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    this.setState({ reconciling: true });
    try {
      const snapshot = await this.client.request<SessionSnapshot>(
        'sessions.snapshot',
        { session_id: sessionId, tail: 160, after_seq: this.state.lastSeq || null },
        30_000,
        { sessionId },
      );
      if (this.state.activeSessionId === sessionId) {
        this.applySnapshot(snapshot);
        if (snapshot.stale) {
          this.scheduleSnapshot(900);
        }
      }
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Snapshot failed.');
    } finally {
      this.snapshotInFlight = false;
    }
  }

  private applyOperation(operation: OperationView) {
    const operations = { ...this.state.operations, [operation.operation_id]: operation };
    const pending =
      this.state.pending && this.state.pending.operationId === operation.operation_id
        ? { ...this.state.pending, state: operation.state, error: operation.error_message }
        : this.state.pending;
    if (this.state.credential && this.state.activeSessionId && pending) {
      savePending(this.state.credential.serverId, this.state.activeSessionId, {
        operation_id: pending.operationId,
        text: pending.text,
        state: pending.state,
        created_at_ms: pending.createdAt,
      });
    }
    this.setState({ operations, pending });
  }

  async lookupOperation(operationId: string) {
    if (!this.client || this.client.status !== 'connected') return;
    try {
      const payload = await this.client.request<OperationStatePayload>('operations.lookup', {
        operation_id: operationId,
      });
      this.applyOperation(payload.operation);
    } catch {
      // Keep the locally saved unknown state; it is not an acceptance claim.
    }
  }

  setComposerText(text: string) {
    this.setState({ composerText: text });
    if (this.state.credential && this.state.activeSessionId) {
      saveDraft(this.state.credential.serverId, this.state.activeSessionId, text);
    }
  }

  async send() {
    const text = this.state.composerText.trim();
    const sessionId = this.state.activeSessionId;
    if (!this.client || this.client.status !== 'connected') {
      this.setToast('The adapter is offline. The draft is saved on this phone.');
      return;
    }
    if (!sessionId) return;
    if (!text) return;
    if (this.state.pending && ['staged', 'reserved', 'dispatching', 'accepted', 'unknown'].includes(this.state.pending.state)) {
      this.setToast('This message is still being resolved. Do not resend it.');
      return;
    }
    if (this.state.live.turnId) {
      this.setToast('A turn is already running in this session.');
      return;
    }
    const credential = this.state.credential;
    if (!credential) return;
    const operationId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const pending: PendingMessage = {
      text,
      operationId,
      state: 'staged',
      error: null,
      createdAt: Date.now(),
    };
    saveDraft(credential.serverId, sessionId, text);
    savePending(credential.serverId, sessionId, {
      operation_id: operationId,
      text,
      state: 'staged',
      created_at_ms: pending.createdAt,
    });
    this.setState({ pending, composerText: '' }, true);
    try {
      const reserved = await this.client.request<OperationStatePayload>(
        'operations.reserve',
        {
          operation_id: operationId,
          session_id: sessionId,
          kind: 'send',
          body: text,
          expected_turn_id: null,
        },
        15_000,
        { sessionId, operationId },
      );
      this.applyOperation(reserved.operation);
      const dispatched = await this.client.request<OperationStatePayload>(
        'operations.dispatch',
        { operation_id: operationId },
        40_000,
        { sessionId, operationId },
      );
      this.applyOperation(dispatched.operation);
      saveDraft(credential.serverId, sessionId, '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unknown = !(error instanceof AdapterRequestError);
      const nextState = unknown ? 'unknown' : 'rejected';
      if (nextState === 'rejected') {
        // The server explicitly rejected the request, so this attempt never
        // entered the session. Return the text to the composer.
        this.setState({
          pending: null,
          composerText: text,
        });
        savePending(credential.serverId, sessionId, null);
        saveDraft(credential.serverId, sessionId, text);
      } else {
        this.setState({
          pending: { ...pending, state: nextState, error: message },
        });
        savePending(credential.serverId, sessionId, {
          operation_id: operationId,
          text,
          state: nextState,
          created_at_ms: pending.createdAt,
        });
      }
      this.setToast(
        nextState === 'unknown'
          ? `Delivery unconfirmed: ${message}`
          : `Message was not sent: ${message}`,
      );
    }
  }

  async stop() {
    if (!this.client || this.client.status !== 'connected') return;
    const sessionId = this.state.activeSessionId;
    const turnId = this.state.live.turnId;
    if (!sessionId || !turnId) {
      this.setToast('There is no active turn to stop.');
      return;
    }
    try {
      const response = await this.client.request<CancelTurnResponse>(
        'operations.cancel',
        {
          session_id: sessionId,
          operation_id: this.state.live.operationId,
          expected_turn_id: turnId,
        },
        20_000,
        { sessionId, operationId: this.state.live.operationId ?? undefined },
      );
      this.setToast(
        response.atomic_turn_scope
          ? 'Stop sent for this turn.'
          : 'Stop sent for the verified turn. Upstream cancellation is session-scoped.',
      );
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Stop was rejected.');
    }
  }

  async respondPermission(decision: 'allow' | 'deny') {
    const permission = this.state.live.permission;
    const sessionId = this.state.activeSessionId;
    if (!permission || !sessionId || !this.client) return;
    try {
      await this.client.request(
        'tool.permission_response',
        {
          session_id: sessionId,
          request_id: permission.requestId,
          decision,
        },
        15_000,
        { sessionId },
      );
      this.patchLive({ permission: null, status: 'working' });
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Permission response failed.');
    }
  }

  async refreshModels(sessionId = this.state.activeSessionId) {
    if (!this.client || this.client.status !== 'connected' || !sessionId) return;
    try {
      const models = await this.client.request<ModelsListPayload>(
        'models.list',
        { session_id: sessionId },
        25_000,
        { sessionId },
      );
      if (this.state.activeSessionId === sessionId) {
        this.setState({ models, runtime: models.runtime });
      }
    } catch {
      if (this.state.activeSessionId === sessionId) {
        this.setState({ models: null });
      }
    }
  }

  async refreshPlan(sessionId = this.state.activeSessionId) {
    if (!this.client || this.client.status !== 'connected' || !sessionId) return;
    try {
      const payload = await this.client.request<{ plan: unknown | null }>(
        'plan.snapshot',
        { session_id: sessionId },
        20_000,
        { sessionId },
      );
      if (this.state.activeSessionId === sessionId) this.setState({ plan: payload.plan });
    } catch {
      // Missing plan stays missing; do not synthesize 0/0.
    }
  }

  async refreshContext(sessionId = this.state.activeSessionId) {
    if (!this.client || this.client.status !== 'connected' || !sessionId) return;
    try {
      const context = await this.client.request<ContextView>(
        'context.snapshot',
        { session_id: sessionId },
        20_000,
        { sessionId },
      );
      if (this.state.activeSessionId === sessionId) this.setState({ context });
    } catch {
      // Token counts remain unknown.
    }
  }

  async refreshActivity(sessionId = this.state.activeSessionId) {
    if (!sessionId) return;
    if (!this.client || this.client.status !== 'connected') {
      const cached = this.state.credential
        ? loadActivityCache(this.state.credential.serverId, sessionId)
        : null;
      if (cached) this.setState({ activity: cached.items });
      return;
    }
    try {
      const payload = await this.client.request<ActivitySnapshotPayload>(
        'activity.snapshot',
        { session_id: sessionId },
        20_000,
        { sessionId },
      );
      if (this.state.activeSessionId === sessionId) {
        this.setState({ activity: payload.items });
        if (this.state.credential) {
          saveActivityCache(this.state.credential.serverId, payload);
        }
      }
    } catch {
      // Observed activity is optional; keep what was already shown.
    }
  }

  async selectModel(model: string, provider: string) {
    const sessionId = this.state.activeSessionId;
    if (!this.client || this.client.status !== 'connected' || !sessionId) return;
    try {
      const payload = await this.client.request<ModelsListPayload>(
        'models.set',
        { session_id: sessionId, model, expected_provider: provider },
        30_000,
        { sessionId },
      );
      this.setState({ models: payload, runtime: payload.runtime, sheet: null });
      this.setToast(`Model set to ${payload.runtime.model ?? model}.`);
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Model change was rejected.');
    }
  }

  async setReasoning(effort: string) {
    const sessionId = this.state.activeSessionId;
    if (!this.client || this.client.status !== 'connected' || !sessionId) return;
    try {
      const runtime = await this.client.request<RuntimeView>(
        'reasoning.set',
        { session_id: sessionId, effort },
        25_000,
        { sessionId },
      );
      this.setState({ runtime, sheet: null });
      this.setToast(`Reasoning effort set to ${runtime.reasoning_effort ?? effort}.`);
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Reasoning change was rejected.');
    }
  }

  async renameSession(title: string) {
    const sessionId = this.state.activeSessionId;
    if (!this.client || this.client.status !== 'connected' || !sessionId) return;
    try {
      const payload = await this.client.request<{ session: SessionSummary }>(
        'sessions.rename',
        { session_id: sessionId, title },
        20_000,
        { sessionId },
      );
      const snapshot = this.state.snapshot;
      this.setState({
        snapshot: snapshot ? { ...snapshot, session: payload.session } : snapshot,
        sessions: this.state.sessions.map((session) =>
          session.session_id === payload.session.session_id ? payload.session : session,
        ),
      });
      this.setToast('Title saved.');
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Title change was rejected.');
    }
  }

  async createSession(projectId: string | null, title: string) {
    if (!this.client || this.client.status !== 'connected') return;
    const clientRequestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `create_${Date.now().toString(36)}`;
    try {
      const payload = await this.client.request<CreateSessionResponse>(
        'sessions.create',
        {
          client_request_id: clientRequestId,
          project_id: projectId,
          working_dir: null,
          title: title.trim() || null,
        },
        40_000,
      );
      this.setState({
        sessions: [payload.session, ...this.state.sessions.filter((session) => session.session_id !== payload.session.session_id)],
      });
      await this.openSession(payload.session.session_id);
      this.setToast(payload.created ? 'Session created.' : 'Session already existed; attached to it.');
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Session creation failed.');
    }
  }

  async createProject(label: string, path: string) {
    if (!this.client || this.client.status !== 'connected') return false;
    try {
      await this.client.request(
        'projects.create',
        { label, path, pinned: false },
        20_000,
      );
      await this.refreshSessions();
      this.setToast('Project added.');
      return true;
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Project creation failed.');
      return false;
    }
  }

  selectProject(projectId: string | null) {
    this.setState({ activeProjectId: projectId, screen: projectId ? 'project' : 'projects' }, true);
  }

  async loadDirectory(projectId: string, path: string) {
    if (!this.client || this.client.status !== 'connected') return;
    this.setState({
      browser: {
        projectId,
        path,
        entries: this.state.browser?.entries ?? [],
        preview: null,
        loading: true,
        error: null,
        cursor: null,
      },
    });
    try {
      const payload = await this.client.request<DirListing>('files.list_dir', {
        project_id: projectId,
        path,
        limit: 200,
        cursor: null,
      });
      this.setState({
        browser: {
          projectId,
          path: payload.path,
          entries: payload.entries,
          preview: null,
          loading: false,
          error: null,
          cursor: payload.next_cursor,
        },
      });
    } catch (error) {
      this.setState({
        browser: this.state.browser
          ? { ...this.state.browser, loading: false, error: error instanceof Error ? error.message : 'Folder could not be read.' }
          : null,
      });
    }
  }

  openBrowser(projectId: string) {
    this.setState({ screen: 'browser', browser: null }, true);
    void this.loadDirectory(projectId, '');
  }

  async openFile(path: string) {
    const browser = this.state.browser;
    if (!browser || !this.client || this.client.status !== 'connected') return;
    try {
      const preview = await this.client.request<FilePreview>('files.read_preview', {
        project_id: browser.projectId,
        path,
      });
      this.setState({ browser: { ...browser, preview } });
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'File could not be read.');
    }
  }

  async createFolder(name: string) {
    const browser = this.state.browser;
    if (!browser || !this.client || this.client.status !== 'connected') return;
    try {
      await this.client.request('folders.create', {
        project_id: browser.projectId,
        parent: browser.path,
        name,
      });
      this.setToast('Folder created.');
      await this.loadDirectory(browser.projectId, browser.path);
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Folder creation failed.');
    }
  }

  async loadDevices() {
    if (!this.client || this.client.status !== 'connected') return;
    try {
      const payload = await this.client.request<{ devices: DeviceInfo[] }>('device.list', {});
      this.setState({ devices: payload.devices });
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Devices could not be listed.');
    }
  }

  async revokeDevice(deviceId: string) {
    if (!this.client || this.client.status !== 'connected') return;
    try {
      await this.client.request('device.revoke', { device_id: deviceId });
      this.setState({ devices: this.state.devices.filter((device) => device.device_id !== deviceId) });
      this.setToast('Device revoked.');
      if (this.state.device?.device_id === deviceId) void this.unpair();
    } catch (error) {
      this.setToast(error instanceof Error ? error.message : 'Device could not be revoked.');
    }
  }

  async unpair() {
    if (this.state.credential) {
      try {
        await clearCredential(this.state.credential.baseUrl);
      } catch (error) {
        this.setToast(
          `This device was not forgotten because the credential store refused the delete: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    }
    this.client?.close();
    this.client = null;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.setState(
      {
        phase: 'unpaired',
        screen: 'welcome',
        credential: null,
        server: null,
        device: null,
        sessions: [],
        projects: [],
        snapshot: null,
        activeSessionId: null,
        pending: null,
        live: emptyLive(),
        connection: { status: 'offline', message: null },
        savedOnPhone: false,
        credentialsKnown: listCredentials().length,
      },
      true,
    );
  }

  setTheme(theme: AppState['theme']) {
    this.setState({ theme }, true);
    this.savePreferences();
  }

  setMotion(motion: AppState['motion']) {
    this.setState({ motion }, true);
    this.savePreferences();
  }

  setGlass(glass: boolean) {
    this.setState({ glass }, true);
    this.savePreferences();
  }

  setReasoningVisibility(value: AppState['reasoningVisibility']) {
    this.setState({ reasoningVisibility: value }, true);
    this.savePreferences();
  }
}

export const controller = new Controller();
