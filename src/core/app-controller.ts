/**
 * Application controller: connection lifecycle, inventory, and the selected
 * conversation. It lives outside React so nothing it owns depends on a screen
 * staying mounted.
 */
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { budgets } from '../design/tokens';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_REASONING_DISPLAY,
  DEFAULT_THEME_FAMILY,
  isAppearance,
  isEffects,
  isReasoningDisplay,
  isThemeFamily,
  type EffectsPreference,
  type ReasoningDisplay,
} from '../design/themes';
import {
  MobileClient,
  TransportError,
  httpBase,
  parseServerAddress,
  type ServerEndpoint,
} from './connection/client';
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
  updateSessionTitle,
  upsertMessages,
  upsertSessions,
  type ServerProfileRow,
} from './persistence/db';
import { deleteToken, loadToken, saveToken } from './persistence/credentials';
import { importDevPairingFile } from './dev/pairing-import';
import { importE2ECredentials } from './dev/e2e-seed';
import {
  DEMO_SERVER_ID,
  DEMO_SESSION_ID,
  demoContext,
  demoMessages,
  demoProjects,
  demoReasoning,
  demoSessions,
  demoTools,
} from './demo/demo-data';
import {
  deriveSeam,
  deriveChanges,
  attachHistoryImages,
  formatClock,
  messageFingerprint,
  newClientId,
} from './session/selectors';
import {
  resetConversation,
  store,
  type ComposerImage,
  type ContextSnapshot,
  type DeliveryRecord,
  type ExecutionState,
  type ProjectRecord,
  type ToolRow,
} from './state/store';

const LAST_SERVER = 'lastServerId';
const LAST_SESSION = 'lastSessionId';
const APPEARANCE = 'appearance';
const THEME_FAMILY = 'themeFamily';
const EFFECTS = 'effects';
const REASONING_DISPLAY = 'reasoningDisplay';
const PRIVACY = 'privacyPreview';
const PROJECTS = 'projects';
const PINNED_SESSIONS = 'pinnedSessions';
const DEVICE_ID = 'deviceId';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

function parseProjects(raw: string | null): ProjectRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const record = value as Record<string, unknown>;
      if (
        typeof record.id !== 'string' ||
        typeof record.serverId !== 'string' ||
        typeof record.path !== 'string' ||
        typeof record.name !== 'string'
      ) {
        return [];
      }
      return [
        {
          id: record.id,
          serverId: record.serverId,
          path: record.path,
          name: record.name,
          pinned: record.pinned === true,
          addedAt: typeof record.addedAt === 'number' ? record.addedAt : Date.now(),
          lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

type ProjectLike = ProjectRecord;

interface ConnectionAttempt {
  epoch: number;
  profileId: string;
  generation: number;
  client: MobileClient;
  promise: Promise<void>;
}

export class AppController {
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
  /** Profile/lifecycle epoch. Every async operation captures this value. */
  private lifecycleEpoch = 0;
  /** The one in-flight connection attempt, owned by epoch + profile. */
  private connectAttempt: ConnectionAttempt | null = null;
  /** A retry/manual recovery arrived while an attempt was in progress. */
  private recoveryRequested = false;
  private clientGeneration = 0;
  private expectedAttachSessionId: string | null = null;
  private openSequence = 0;
  private continuationConfirmed = false;
  private lastSessionRefresh = 0;
  private serverInfoObserved = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private healthInFlight = false;
  private reconciliationTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private inventoryRequested = false;
  /** Pairing attempt identity and cancellation owner. */
  private pairAttempt = 0;
  private pairAbort: AbortController | null = null;
  private pairWriteSeq = 0;
  private pairWrites = new Map<string, { seq: number; token: string }>();
  /** Serializes credential/profile writes and cleanup for one profile. */
  private profileQueues = new Map<string, Promise<unknown>>();
  /** A profile whose credential is being loaded; connections are blocked. */
  private credentialLoading: {
    epoch: number;
    profile: ServerProfileRow;
    options: { restore: boolean; deferConnect?: boolean };
  } | null = null;
  /** An activation interrupted by background, resumed on foreground. */
  private pendingActivation: {
    profile: ServerProfileRow;
    options: { restore: boolean; deferConnect?: boolean };
  } | null = null;
  /** Confirmed titles newer than a pending inventory/attach response. */
  private confirmedTitles = new Map<
    string,
    { title: string | null; displayTitle: string; at: number; revision: number }
  >();
  private titleRevision = 0;

  /* ------------------------------------------------------------- ownership */

  private owns(epoch: number, profileId: string | null | undefined): boolean {
    return this.lifecycleEpoch === epoch && this.profile?.id === profileId;
  }

  private ownsClient(
    epoch: number,
    profileId: string | null | undefined,
    generation: number,
    client: MobileClient,
  ): boolean {
    return (
      this.owns(epoch, profileId) &&
      this.clientGeneration === generation &&
      this.client === client
    );
  }

  /**
   * Serialize credential/profile writes and cleanup for one profile. A paused
   * save cannot finish after a newer cleanup, and cleanup cannot read or
   * delete while a newer save is in flight.
   */
  private profileQueue<T>(profileId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.profileQueues.get(profileId) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.profileQueues.set(profileId, tail);
    void tail.finally(() => {
      if (this.profileQueues.get(profileId) === tail) {
        this.profileQueues.delete(profileId);
      }
    });
    return run;
  }

  /** "Last checked" advances even when the attempt fails. */
  private noteAttempt(): void {
    store.setState((state) => ({
      connection: { ...state.connection, lastCheckedAt: Date.now() },
    }));
  }

  /** Successful contact is tracked separately from the attempt. */
  private noteContact(): void {
    const now = Date.now();
    store.setState((state) => ({
      connection: { ...state.connection, lastCheckedAt: now, lastContactAt: now },
    }));
  }

  private clearReconciliation(): void {
    if (this.reconciliationTimer) clearTimeout(this.reconciliationTimer);
    this.reconciliationTimer = null;
  }

  private clearAttemptDeadline(): void {
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.attemptTimer = null;
  }

  private stopHealthChecks(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.healthInFlight = false;
  }

  /**
   * Invalidate every in-flight lifecycle operation before switching, logging
   * out, forgetting, or backgrounding. Old promises may still settle; their
   * captured epoch no longer matches, so they cannot write state.
   */
  private invalidateLifecycle(): void {
    this.lifecycleEpoch += 1;
    this.credentialLoading = null;
    this.pendingActivation = null;
    this.clientGeneration += 1;
    this.clearReconnect();
    this.stopHealthChecks();
    this.cancelPairing();
    this.clearReconciliation();
    this.clearAttemptDeadline();
    this.recoveryRequested = false;
    this.connectAttempt = null;
    try {
      this.client?.close();
    } catch {
      // Already closed.
    }
    this.client = null;
    this.attachedSessionId = null;
    this.expectedAttachSessionId = null;
    this.continuationConfirmed = false;
  }

  /** Drop the transport without changing the selected profile. */
  private dropTransport(): void {
    this.stopHealthChecks();
    this.clearReconciliation();
    this.clearAttemptDeadline();
    this.clientGeneration += 1;
    this.connectAttempt = null;
    try {
      this.client?.close();
    } catch {
      // Already closed.
    }
    this.client = null;
    this.attachedSessionId = null;
    this.expectedAttachSessionId = null;
    this.continuationConfirmed = false;
  }

  cancelPairing(): void {
    this.pairAttempt += 1;
    this.pairAbort?.abort();
    this.pairAbort = null;
  }

  private titleKey(serverId: string, sessionId: string): string {
    return `${serverId}:${sessionId}`;
  }

  /**
   * Older inventory/attach replies must not overwrite a title confirmed by a
   * rename event after the request started.
   */
  private mergeConfirmedTitle(
    serverId: string,
    session: SessionInfo,
    revisionAtStart: number,
  ): SessionInfo {
    const confirmed = this.confirmedTitles.get(this.titleKey(serverId, session.session_id));
    if (confirmed && confirmed.revision > revisionAtStart) {
      return { ...session, title: confirmed.title ?? confirmed.displayTitle };
    }
    return session;
  }

  private applyConfirmedTitle(
    serverId: string,
    sessionId: string,
    title: string | null,
    displayTitle: string,
    at = Date.now(),
  ): void {
    const key = this.titleKey(serverId, sessionId);
    const existing = this.confirmedTitles.get(key);
    if (existing && existing.at > at) return;
    const visible = displayTitle || title || '';
    const revision = ++this.titleRevision;
    this.confirmedTitles.set(key, { title, displayTitle: visible, at, revision });
    store.setState((state) => {
      const conversation = state.conversation;
      const sameConversation =
        conversation.serverId === serverId && conversation.sessionId === sessionId;
      return {
        ...(sameConversation
          ? {
              conversation: {
                ...conversation,
                title: visible || conversation.title,
                session: conversation.session
                  ? { ...conversation.session, title: title ?? displayTitle }
                  : conversation.session,
              },
            }
          : null),
        inventory: {
          ...state.inventory,
          sessions: state.inventory.sessions.map((session) =>
            session.session_id === sessionId
              ? { ...session, title: title ?? displayTitle }
              : session,
          ),
        },
      };
    });
    void updateSessionTitle(serverId, sessionId, visible || null);
  }

  /* ------------------------------------------------------------- bootstrap */

  async bootstrap(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    try {
      await initDatabase();
      await importE2ECredentials();
      await importDevPairingFile();
      const [
        appearance,
        themeFamily,
        effects,
        reasoningDisplay,
        privacy,
        deviceName,
        projectsRaw,
        pinnedRaw,
      ] = await Promise.all([
        getPref(APPEARANCE),
        getPref(THEME_FAMILY),
        getPref(EFFECTS),
        getPref(REASONING_DISPLAY),
        getPref(PRIVACY),
        this.ensureDeviceName(),
        getPref(PROJECTS),
        getPref(PINNED_SESSIONS),
      ]);
      store.setState((state) => ({
        appearance: isAppearance(appearance) ? appearance : DEFAULT_APPEARANCE,
        themeFamily: isThemeFamily(themeFamily) ? themeFamily : DEFAULT_THEME_FAMILY,
        effects: isEffects(effects) ? effects : 'auto',
        reasoningDisplay: isReasoningDisplay(reasoningDisplay)
          ? reasoningDisplay
          : DEFAULT_REASONING_DISPLAY,
        privacyPreview: privacy !== '0',
        deviceName,
        inventory: {
          ...state.inventory,
          projects: parseProjects(projectsRaw),
          pinnedSessionIds: parseStringList(pinnedRaw),
        },
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
        this.clearReconnect();
        this.dropTransport();
        this.setConnectionState('offline');
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
    const interrupted = this.credentialLoading;
    this.invalidateLifecycle();
    if (interrupted) {
      this.pendingActivation = {
        profile: interrupted.profile,
        options: interrupted.options,
      };
    }
    this.suspendInventoryPolling();
    this.flushStream();
    this.flushDraft();
    // No background keepalive: the daemon owns the turn, the phone releases
    // its socket, and reopening reconciles authoritative history.
    store.setState((state) => ({ conversation: { ...state.conversation, attachmentId: null } }));
    store.setState((state) => ({
      connection: { ...state.connection, state: 'cached' },
    }));
  }

  private async onForeground(): Promise<void> {
    const pending = this.pendingActivation;
    this.pendingActivation = null;
    if (pending) {
      await this.activateProfile(pending.profile, pending.options);
      this.ensureInventoryTimer();
      return;
    }
    if (this.profile) {
      await this.connectNow({ immediate: true });
      this.ensureInventoryTimer();
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
    const epoch = this.lifecycleEpoch;
    const attempt = ++this.pairAttempt;
    this.pairAbort?.abort();
    const abort = new AbortController();
    this.pairAbort = abort;
    const cancelled = (): { ok: false; error: string; code: string; detail?: string } => ({
      ok: false,
      code: 'PAIR_CANCELLED',
      error: 'Pairing was cancelled before it completed.',
    });
    const timeoutResult = (): { ok: false; error: string; code: string; detail?: string } => ({
      ok: false,
      code: 'PAIR_TIMEOUT',
      error: `Pairing timed out after ${Math.round(budgets.pairRequestMs / 1000)}s. ${parsed.display} did not complete /pair. Check DNS, port 7643, firewall, and TLS.`,
    });
    const timedOut = () =>
      abort.signal.aborted &&
      this.pairAttempt === attempt &&
      this.lifecycleEpoch === epoch;
    const owns = () =>
      this.pairAttempt === attempt && this.lifecycleEpoch === epoch && !abort.signal.aborted;

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
    const existing = (await listServers()).find(
      (server) =>
        server.host === parsed.endpoint.host &&
        server.port === parsed.endpoint.port &&
        (server.tls === 1) === parsed.endpoint.tls,
    );
    if (!owns()) return cancelled();
    const profileId = existing?.id ?? newClientId('srv');
    const deviceId = (await getPref('deviceId')) ?? profileId;
    if (!owns()) return cancelled();
    const body = {
      code,
      device_id: deviceId,
      device_name: input.deviceName.trim(),
    };
    // The deadline covers fetch, headers, and the response body. A body that
    // stalls after headers must not outlive the advertised timeout.
    timer = setTimeout(() => abort.abort(), budgets.pairRequestMs);
    let response: Response | null = null;
    let payload: { ok?: boolean; token?: string; error?: string };
    try {
      response = await fetch(`${httpBase(parsed.endpoint)}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      if (timedOut()) return timeoutResult();
      if (!owns()) return cancelled();
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        code: 'PAIR_NETWORK',
        error: `Cannot reach ${parsed.display}/pair. Check DNS, port 7643, firewall, and that the adapter is running.`,
        detail,
      };
    }
    if (timedOut()) return timeoutResult();
    if (!owns()) return cancelled();
    if (!response || !response.ok || !payload.ok || !payload.token) {
      return {
        ok: false,
        code: `PAIR_HTTP_${response?.status ?? 0}`,
        error: payload?.error ?? `Pairing failed with HTTP ${response?.status ?? 0}.`,
        detail: `POST ${httpBase(parsed.endpoint)}/pair returned ${response?.status ?? 0}.`,
      };
    }
    if (!/^[0-9a-f]{64}$/.test(payload.token)) {
      return {
        ok: false,
        code: 'PAIR_BAD_TOKEN',
        error: 'The server returned an invalid device token.',
      };
    }
    const pairedToken = payload.token;
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
    const writeSeq = ++this.pairWriteSeq;
    this.pairWrites.set(profileId, { seq: writeSeq, token: pairedToken });
    const persisted = await this.profileQueue(profileId, async () => {
      await saveToken(profileId, pairedToken);
      if (!owns()) {
        await this.cleanupPairWrites(profileId, writeSeq, pairedToken);
        return false;
      }
      await saveServer(profile);
      if (!owns()) {
        await this.cleanupPairWrites(profileId, writeSeq, pairedToken);
        return false;
      }
      await setPref(LAST_SERVER, profileId);
      if (!owns()) {
        await this.cleanupPairWrites(profileId, writeSeq, pairedToken);
        return false;
      }
      return true;
    });
    if (!persisted || !owns()) {
      if (persisted) {
        await this.profileQueue(profileId, () =>
          this.cleanupPairWrites(profileId, writeSeq, pairedToken),
        );
      }
      return cancelled();
    }
    // Pairing is complete once the token is stored. Connect in the background
    // so a slow or broken WebSocket cannot leave the Pair button spinning.
    await this.activateProfile(profile, { restore: false, deferConnect: true });
    return { ok: true, profileId };
    } finally {
      if (timer) clearTimeout(timer);
      if (this.pairAbort === abort) this.pairAbort = null;
    }
  }

  /**
   * Remove only this attempt's local writes. A newer overlapping pair owns a
   * later lease; if this attempt's paused save landed after it, restore the
   * newer token instead of deleting it.
   */
  private async cleanupPairWrites(
    profileId: string,
    seq: number,
    token: string,
  ): Promise<void> {
    const lease = this.pairWrites.get(profileId);
    if (!lease || lease.seq !== seq) {
      if (lease) {
        const current = await loadToken(profileId).catch(() => null);
        if (current !== lease.token) {
          await saveToken(profileId, lease.token).catch(() => undefined);
        }
      } else {
        // No live lease: a forget removed it, or the profile was cleared.
        // Delete only this attempt's token if its paused write landed late.
        const current = await loadToken(profileId).catch(() => null);
        if (current === token) {
          await deleteToken(profileId).catch(() => undefined);
        }
        if (!this.pairWrites.has(profileId)) {
          await deleteServer(profileId).catch(() => undefined);
        }
      }
      return;
    }
    const current = await loadToken(profileId).catch(() => null);
    if (current !== null && current !== token) return;
    await deleteToken(profileId).catch(() => undefined);
    if (this.pairWrites.get(profileId)?.seq !== seq) return;
    this.pairWrites.delete(profileId);
    await deleteServer(profileId).catch(() => undefined);
  }

  private defaultPort(): number {
    return 7643;
  }

  async activateProfile(profile: ServerProfileRow, options: { restore: boolean; deferConnect?: boolean }): Promise<void> {
    this.invalidateLifecycle();
    const epoch = this.lifecycleEpoch;
    this.pendingActivation = null;
    this.profile = null;
    this.token = null;
    this.credentialLoading = { epoch, profile, options };
    store.setState((state) => ({
      connection: {
        ...state.connection,
        state: 'connecting',
        lastCheckedAt: null,
        lastContactAt: null,
        error: null,
      },
    }));
    let token: string | null;
    try {
      token = await this.profileQueue(profile.id, () => loadToken(profile.id));
    } catch {
      if (this.credentialLoading?.epoch === epoch) this.credentialLoading = null;
      return;
    }
    // A later activation may have won while the keychain read was pending.
    // Never publish this profile or its bearer over the winner.
    if (this.lifecycleEpoch !== epoch) return;
    this.profile = profile;
    this.token = token;
    this.credentialLoading = null;
    store.setState((state) => ({
      profileId: profile.id,
      connection: {
        ...state.connection,
        state: 'cached',
        lastCheckedAt: null,
        lastContactAt: null,
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
    if (!this.owns(epoch, profile.id)) return;
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
      if (!this.owns(epoch, profile.id)) return;
      if (lastSession && cached.some((session) => session.session_id === lastSession)) {
        const session = cached.find((entry) => entry.session_id === lastSession)!;
        await this.openSession(session);
      }
    }
  }

  async connectNow(options: { immediate?: boolean; force?: boolean; retry?: boolean } = {}): Promise<void> {
    if (
      this.credentialLoading &&
      this.credentialLoading.epoch === this.lifecycleEpoch
    ) {
      return;
    }
    if (!this.profile) return;
    if (!this.token) {
      this.setConnectionState('pair_again', 'Pair this phone again.');
      return;
    }
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile.id;
    const existing = this.connectAttempt;
    if (existing && existing.epoch === epoch && existing.profileId === profileId) {
      // A retry deadline or manual recovery arrived while this attempt runs.
      // Remember the intent; its finally block starts the next eligible try.
      if (options.force || options.retry) this.recoveryRequested = true;
      return existing.promise;
    }
    if (this.appState !== 'active' && !options.force) return;
    if (!this.online && !options.force) {
      this.setConnectionState('offline');
      return;
    }

    this.clearReconnect();
    this.stopHealthChecks();
    this.clearReconciliation();
    this.recoveryRequested = false;
    this.attachedSessionId = null;
    this.expectedAttachSessionId = null;
    this.continuationConfirmed = false;
    const generation = ++this.clientGeneration;
    const previous = this.client;
    if (previous) previous.close();
    const hadContent = store.get().conversation.messages.length > 0;
    this.noteAttempt();
    this.setConnectionState(hadContent ? 'reconnecting' : 'connecting');

    const token = this.token;
    const endpoint = {
      host: this.profile.host,
      port: this.profile.port,
      tls: this.profile.tls === 1,
    };
    const client = new MobileClient(endpoint, token, {
      onEvent: (frame) => {
        if (generation !== this.clientGeneration || this.client !== client) return;
        this.onFrame(frame);
      },
      onState: (state) => {
        if (generation !== this.clientGeneration || this.client !== client) return;
        if (state === 'closed') {
          this.client = null;
          this.onTransportClosed();
        }
      },
    });
    this.client = client;

    const attempt: ConnectionAttempt = {
      epoch,
      profileId,
      generation,
      client,
      promise: Promise.resolve(),
    };
    const promise = (async () => {
      try {
        await client.connect();
        if (!this.ownsClient(epoch, profileId, generation, client)) {
          client.close();
          return;
        }
        const hello = client.hello;
        if (!hello || hello.ev !== 'hello_ok') {
          throw new TransportError('The server is not protocol-ready.', 'not_ready');
        }
        this.reconnectAttempt = 0;
        const capabilities = hello.capabilities;
        const daemonVersion = hello.daemon_version ?? null;
        this.serverInfoObserved = false;
        this.noteContact();
        store.setState((state) => ({
          connection: {
            ...state.connection,
            state: 'reconciling',
            capabilities,
            daemonVersion,
            error: null,
            attempt: 0,
          },
        }));
        if (this.profile) {
          const updated = {
            ...this.profile,
            last_connected_at: Date.now(),
            daemon_version: daemonVersion,
            capabilities_json: JSON.stringify(capabilities),
          };
          await saveServer(updated);
          if (!this.ownsClient(epoch, profileId, generation, client)) return;
          this.profile = updated;
        }
        const inventory = await this.refreshSessions({ force: true });
        if (!this.ownsClient(epoch, profileId, generation, client)) return;
        if (!inventory.ok) {
          throw new Error(inventory.error ?? 'The session inventory did not reconcile.');
        }
        const sessionId = store.get().conversation.sessionId;
        if (sessionId) {
          await this.attachSession(sessionId);
          if (!this.ownsClient(epoch, profileId, generation, client)) return;
          if (this.attachedSessionId !== sessionId) {
            throw new Error(store.get().conversation.lastError ?? 'The session attachment failed.');
          }
          // Current is published by authoritative history, not by attach alone.
          this.startReconciliationDeadline(epoch, profileId, generation, client, sessionId);
        } else {
          this.setConnectionState('current');
          this.noteContact();
        }
        this.ensureInventoryTimer();
        this.startHealthChecks();
        void this.refreshServerInfo();
      } catch (error) {
        if (!this.ownsClient(epoch, profileId, generation, client)) return;
        this.client = null;
        client.close();
        await this.classifyFailure(error, epoch, profileId, generation);
      } finally {
        if (this.connectAttempt === attempt) {
          this.connectAttempt = null;
          this.clearAttemptDeadline();
        }
        if (this.recoveryRequested && this.owns(epoch, profileId)) {
          this.recoveryRequested = false;
          if (!this.client?.isOpen) this.scheduleReconnect();
        }
      }
    })();
    attempt.promise = promise;
    this.connectAttempt = attempt;
    this.clearAttemptDeadline();
    this.attemptTimer = setTimeout(() => {
      if (this.connectAttempt !== attempt) return;
      this.connectAttempt = null;
      this.attemptTimer = null;
      this.client = null;
      client.close();
      void this.classifyFailure(
        new TransportError('The connection attempt did not complete in time.', 'attempt_timeout'),
        epoch,
        profileId,
        generation,
      );
    }, budgets.connectAttemptMs);
    return promise;
  }

  private startReconciliationDeadline(
    epoch: number,
    profileId: string,
    generation: number,
    client: MobileClient,
    sessionId: string,
  ): void {
    this.clearReconciliation();
    this.reconciliationTimer = setTimeout(() => {
      this.reconciliationTimer = null;
      if (!this.ownsClient(epoch, profileId, generation, client)) return;
      if (store.get().connection.state !== 'reconciling') return;
      if (store.get().conversation.sessionId !== sessionId) return;
      void this.handleTransportFailure(
        client,
        generation,
        'The server did not finish reconciling this session.',
      );
    }, budgets.reconcileTimeoutMs);
  }

  private async classifyFailure(
    error: unknown,
    epoch: number,
    profileId: string | null,
    generation: number,
  ): Promise<void> {
    const ownsAttempt = () =>
      this.owns(epoch, profileId) && this.clientGeneration === generation;
    const message = errorMessage(error);
    if (
      error instanceof TransportError &&
      (error.code === 'unsupported_version' || error.code === 'unsupported_capability')
    ) {
      if (ownsAttempt()) {
        this.setConnectionState('incompatible', message);
      }
      return;
    }
    if (error instanceof TransportError && error.code === 'unauthorized') {
      if (ownsAttempt()) {
        this.setConnectionState('pair_again', 'This phone is no longer authorized.');
      }
      return;
    }
    const endpoint = this.endpoint();
    let adapterReachable = false;
    if (endpoint && this.token) {
      this.noteAttempt();
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
        if (!ownsAttempt()) return;
        if (response.status === 401) {
          this.setConnectionState('pair_again', 'This phone is no longer authorized.');
          return;
        }
        adapterReachable = response.ok;
      } catch {
        // Network-level failure: fall through to reconnect.
      }
    }
    if (!ownsAttempt()) return;
    const hadContent = store.get().conversation.messages.length > 0;
    const offline = !this.online || this.reconnectAttempt >= 4;
    const detail =
      adapterReachable && !offline
        ? `${message} The adapter is reachable; the daemon is not ready.`
        : message;
    this.setConnectionState(
      offline ? 'offline' : hadContent ? 'reconnecting' : 'connecting',
      detail,
    );
    this.markDeliveriesUnconfirmed();
    this.scheduleReconnect();
  }

  private onTransportClosed(): void {
    this.stopHealthChecks();
    this.clearReconciliation();
    this.attachedSessionId = null;
    store.setState((state) => ({
      conversation: { ...state.conversation, attachmentId: null },
    }));
    this.markDeliveriesUnconfirmed();
    const hadContent = store.get().conversation.messages.length > 0;
    this.setConnectionState(hadContent ? 'reconnecting' : 'offline');
    this.scheduleReconnect();
  }

  private async handleTransportFailure(
    client: MobileClient,
    generation: number,
    message: string,
  ): Promise<void> {
    if (this.client !== client || this.clientGeneration !== generation) return;
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id ?? null;
    this.client = null;
    client.close();
    this.stopHealthChecks();
    this.clearReconciliation();
    this.attachedSessionId = null;
    this.expectedAttachSessionId = null;
    this.continuationConfirmed = false;
    this.markDeliveriesUnconfirmed();
    const hadContent = store.get().conversation.messages.length > 0;
    this.setConnectionState(hadContent ? 'reconnecting' : 'offline', message);
    await this.classifyFailure(
      new TransportError(message, 'health_timeout'),
      epoch,
      profileId,
      generation,
    );
  }

  private startHealthChecks(): void {
    this.stopHealthChecks();
    this.healthTimer = setInterval(() => {
      if (this.appState !== 'active' || this.healthInFlight) return;
      const client = this.client;
      if (!client?.isOpen) return;
      const epoch = this.lifecycleEpoch;
      const profileId = this.profile?.id ?? null;
      const generation = this.clientGeneration;
      this.healthInFlight = true;
      this.noteAttempt();
      client
        .ping()
        .then(() => {
          if (this.ownsClient(epoch, profileId, generation, client)) this.noteContact();
        })
        .catch(() => {
          if (this.ownsClient(epoch, profileId, generation, client)) {
            void this.handleTransportFailure(client, generation, 'The server stopped answering.');
          }
        })
        .finally(() => {
          this.healthInFlight = false;
        });
    }, budgets.healthCheckMs);
  }

  private scheduleReconnect(immediate = false): void {
    if (this.reconnectTimer || !this.online || this.appState !== 'active') return;
    if (!this.profile || !this.token) return;
    const delay = immediate ? 0 : backoffDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    store.setState((state) => ({
      connection: { ...state.connection, attempt: this.reconnectAttempt },
    }));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectNow({ immediate: true, force: true, retry: true });
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
    const client = this.client;
    if (!client?.isOpen) return;
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id ?? null;
    const generation = this.clientGeneration;
    try {
      const frame = await client.request({ req: 'get_server_info' }, 8_000);
      if (!this.ownsClient(epoch, profileId, generation, client)) return;
      if (frame.ev !== 'server_info') return;
      this.serverInfoObserved = true;
      this.noteContact();
      store.setState((state) => ({
        connection: {
          ...state.connection,
          daemonVersion: frame.daemon_version ?? state.connection.daemonVersion,
          capabilities: frame.capabilities,
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
    this.inventoryRequested = true;
    this.ensureInventoryTimer();
  }

  stopInventoryPolling(): void {
    this.inventoryRequested = false;
    this.suspendInventoryPolling();
  }

  /** Keep the focused-screen intent but stop background traffic. */
  private suspendInventoryPolling(): void {
    if (this.inventoryTimer) clearInterval(this.inventoryTimer);
    this.inventoryTimer = null;
  }

  private ensureInventoryTimer(): void {
    if (!this.inventoryRequested || this.appState !== 'active' || this.inventoryTimer) return;
    this.inventoryTimer = setInterval(() => {
      if (this.appState === 'active') void this.refreshInventoryWithRecovery();
    }, budgets.inventoryRefreshMs);
  }

  private async refreshInventoryWithRecovery(): Promise<void> {
    const client = this.client;
    if (!client?.isOpen) return;
    const generation = this.clientGeneration;
    const result = await this.refreshSessions();
    if (result.ok) return;
    if (this.client !== client || this.clientGeneration !== generation) return;
    const state = store.get().connection.state;
    if (state === 'current' || state === 'reconciling') {
      await this.handleTransportFailure(
        client,
        generation,
        result.error ?? 'The session inventory did not reconcile.',
      );
    }
  }

  async refreshSessions(
    options: { force?: boolean; includeArchived?: boolean } = {},
  ): Promise<{ ok: boolean; error?: string }> {
    if (store.get().demo) return { ok: true };
    if (!this.client?.isOpen) {
      const state = store.get();
      if (state.inventory.sessions.length === 0 && this.profile) {
        const cached = await loadCachedSessions(this.profile.id);
        if (cached.length) {
          store.setState((current) => ({ inventory: { ...current.inventory, sessions: cached } }));
        }
      }
      return { ok: false, error: 'The connection is not open.' };
    }
    if (!options.force && Date.now() - this.lastSessionRefresh < 5_000) return { ok: true };
    const state = store.get();
    const limit = state.inventory.limit;
    const includeArchived = options.includeArchived ?? state.inventory.includeArchived;
    const client = this.client;
    const generation = this.clientGeneration;
    const profileId = this.profile?.id;
    const epoch = this.lifecycleEpoch;
    const titleRevisionAtStart = this.titleRevision;
    this.noteAttempt();
    store.setState((current) => ({ inventory: { ...current.inventory, loading: true, error: null } }));
    try {
      const frame = await client.request(
        { req: 'list_sessions', limit, include_archived: includeArchived },
        20_000,
      );
      if (!this.ownsClient(epoch, profileId, generation, client)) {
        return { ok: false, error: 'The server changed.' };
      }
      if (frame.ev !== 'sessions') throw new Error('Unexpected inventory reply.');
      this.noteContact();
      this.lastSessionRefresh = Date.now();
      const mergedSessions = frame.sessions.map((session) =>
        this.mergeConfirmedTitle(profileId!, session, titleRevisionAtStart),
      );
      store.setState((current) => ({
        inventory: {
          ...current.inventory,
          sessions: mergedSessions,
          fetchedAt: Date.now(),
          loading: false,
          error: null,
          partial: frame.partial,
          includeArchived,
        },
      }));
      if (profileId) {
        await upsertSessions(profileId, mergedSessions).catch(() => undefined);
      }
      if (!this.ownsClient(epoch, profileId, generation, client)) {
        return { ok: false, error: 'The server changed.' };
      }
      // A rename may have been confirmed while the older inventory write was
      // pending. Reapply it after the write so SQLite, the list, and the open
      // header cannot revert to the pre-rename title.
      let effectiveSessions = mergedSessions;
      if (profileId && this.titleRevision > titleRevisionAtStart) {
        effectiveSessions = frame.sessions.map((session) =>
          this.mergeConfirmedTitle(profileId, session, titleRevisionAtStart),
        );
        const changed = effectiveSessions.filter(
          (session, index) =>
            (session.title ?? null) !== (mergedSessions[index].title ?? null),
        );
        for (const session of changed) {
          const key = this.titleKey(profileId, session.session_id);
          const confirmedBefore = this.confirmedTitles.get(key);
          const confirmedRevision =
            confirmedBefore && confirmedBefore.revision > titleRevisionAtStart
              ? confirmedBefore.revision
              : titleRevisionAtStart;
          let title =
            confirmedBefore && confirmedBefore.revision > titleRevisionAtStart
              ? confirmedBefore.title ?? confirmedBefore.displayTitle
              : session.title ?? null;
          await updateSessionTitle(profileId, session.session_id, title).catch(() => undefined);
          // A second rename may have been confirmed while this write was
          // pending. Re-read the revision after each write until it settles.
          let appliedRevision = confirmedRevision;
          let latest = this.confirmedTitles.get(key);
          for (let pass = 0; pass < 4 && latest && latest.revision > appliedRevision; pass += 1) {
            title = latest.title ?? latest.displayTitle;
            await updateSessionTitle(profileId, session.session_id, title).catch(
              () => undefined,
            );
            appliedRevision = latest.revision;
            latest = this.confirmedTitles.get(key);
          }
          effectiveSessions = effectiveSessions.map((entry) =>
            entry.session_id === session.session_id ? { ...entry, title } : entry,
          );
          store.setState((current) => {
            const conversation = current.conversation;
            const sameConversation =
              conversation.serverId === profileId &&
              conversation.sessionId === session.session_id;
            return {
              inventory: {
                ...current.inventory,
                sessions: current.inventory.sessions.map((item) =>
                  item.session_id === session.session_id
                    ? { ...item, title }
                    : item,
                ),
              },
              ...(sameConversation
                ? {
                    conversation: {
                      ...conversation,
                      title: title ?? conversation.title,
                      session: conversation.session
                        ? { ...conversation.session, title }
                        : conversation.session,
                    },
                  }
                : null),
            };
          });
        }
      }
      const currentConversation = store.get().conversation;
      const currentSession = effectiveSessions.find(
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
      return { ok: true };
    } catch (error) {
      if (!this.ownsClient(epoch, profileId, generation, client)) {
        return { ok: false, error: 'The server changed.' };
      }
      store.setState((current) => ({
        inventory: { ...current.inventory, loading: false, error: errorMessage(error) },
      }));
      const connectionState = store.get().connection.state;
      if (
        this.client === client &&
        !this.connectAttempt &&
        (connectionState === 'current' || connectionState === 'reconciling')
      ) {
        void this.handleTransportFailure(
          client,
          generation,
          errorMessage(error),
        );
      }
      return { ok: false, error: errorMessage(error) };
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
    const client = this.client;
    if (!client?.isOpen) return { ok: false, error: 'This action needs a connection.' };
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id;
    const generation = this.clientGeneration;
    try {
      const frame = await client.request({ req: 'archive_session', session_id: session.session_id }, 15_000);
      if (!this.ownsClient(epoch, profileId, generation, client)) {
        return { ok: false, error: 'The server changed while this action was pending.' };
      }
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
    const client = this.client;
    if (!client?.isOpen) return { ok: false, error: 'This action needs a connection.' };
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id;
    const generation = this.clientGeneration;
    try {
      const frame = await client.request({ req: 'restore_session', session_id: session.session_id }, 15_000);
      if (!this.ownsClient(epoch, profileId, generation, client)) {
        return { ok: false, error: 'The server changed while this action was pending.' };
      }
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
    const client = this.client;
    if (!client?.isOpen || !this.attachedSessionId || sessionId !== this.attachedSessionId) {
      return { ok: false, error: 'Open the session before changing its saved state.' };
    }
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id;
    const generation = this.clientGeneration;
    try {
      const frame = await client.request(
        { req: 'set_session_saved', session_id: sessionId, saved, label: label ?? null },
        10_000,
      );
      if (!this.ownsClient(epoch, profileId, generation, client)) {
        return { ok: false, error: 'The server changed while this action was pending.' };
      }
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
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id;
    const generation = this.clientGeneration;
    if (!profileId) return { ok: false, error: 'No server is selected.' };
    this.noteAttempt();
    try {
      const frame = await client.request(
        { req: 'rename_session', session_id: sessionId, title },
        budgets.renameTimeoutMs,
      );
      if (!this.ownsClient(epoch, profileId, generation, client)) {
        return { ok: false, error: 'The server changed while the rename was pending.' };
      }
      if (frame.ev === 'error') return { ok: false, error: frame.message };
      if (frame.ev !== 'ok') return { ok: false, error: 'The server did not confirm the rename.' };
      if (frame.session_id && frame.session_id !== sessionId) {
        return { ok: false, error: 'The server confirmed a different session.' };
      }
      const displayTitle = frame.display_title?.trim();
      if (!displayTitle) {
        return {
          ok: false,
          error: 'The server completed the request without confirming the new title.',
        };
      }
      this.applyConfirmedTitle(
        profileId,
        sessionId,
        frame.title === undefined ? null : frame.title,
        displayTitle,
      );
      this.noteContact();
      return { ok: true };
    } catch (error) {
      if (!this.owns(epoch, profileId)) {
        return { ok: false, error: 'The server changed while the rename was pending.' };
      }
      return { ok: false, error: errorMessage(error) };
    }
  }

  /* ------------------------------------------------------------- conversation */

  async openSession(session: SessionInfo): Promise<void> {
    if (store.get().demo) {
      this.openDemoSession(session.session_id);
      return;
    }
    if (!this.profile) return;
    const serverId = this.profile.id;
    const epoch = this.lifecycleEpoch;
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
    if (epoch !== this.lifecycleEpoch || this.profile?.id !== serverId) return;
    await setPref(LAST_SESSION, session.session_id);

    const cached = await loadCachedMessages(serverId, session.session_id, 120);
    const bookmark = await getBookmark(serverId, session.session_id);
    if (
      sequence !== this.openSequence ||
      epoch !== this.lifecycleEpoch ||
      this.profile?.id !== serverId
    ) {
      return;
    }
    this.firstVisit = bookmark === null;
    const pending = await listPendingSends(serverId, session.session_id);
    if (
      sequence !== this.openSequence ||
      epoch !== this.lifecycleEpoch ||
      this.profile?.id !== serverId
    ) {
      return;
    }
    const confirmed = this.confirmedTitles.get(this.titleKey(serverId, session.session_id));
    const seededSession = confirmed
      ? { ...session, title: confirmed.title ?? session.title }
      : session;
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
        session: seededSession,
        title:
          confirmed?.displayTitle ??
          session.title ??
          session.save_label ??
          'Session',
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
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id ?? null;
    const generation = this.clientGeneration;
    this.attachedSessionId = sessionId;
    this.expectedAttachSessionId = sessionId;
    try {
      const frame = await client.request({ req: 'attach_session', session_id: sessionId }, 20_000);
      if (!this.ownsClient(epoch, profileId, generation, client)) return;
      this.noteContact();
      if (frame.ev === 'error') {
        this.attachedSessionId = null;
        store.setState((state) => ({
          conversation: { ...state.conversation, lastError: frame.message },
        }));
      }
    } catch (error) {
      if (!this.ownsClient(epoch, profileId, generation, client)) return;
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
    if (state.demo) return { ok: true };
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

  async send(
    content: string,
    images: ComposerImage[] = [],
  ): Promise<{ ok: boolean; error?: string }> {
    const state = store.get();
    const conversation = state.conversation;
    if (!this.profile || !conversation.sessionId) return { ok: false, error: 'No session is open.' };
    const trimmed = content.trim();
    if (!trimmed && images.length === 0) return { ok: false, error: 'Write a message first.' };
    if (state.demo) return this.sendDemo(trimmed, images);
    if (!this.client?.isOpen) return { ok: false, error: 'Reconnect to send.' };
    if (conversation.execution.kind === 'working') return this.sendGuidance(trimmed, images);
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
      ...(images.length ? { images } : null),
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
          ...(images.length
            ? {
                images: images
                  .filter((image) => image.base64)
                  .map((image) => [image.mediaType, image.base64!] as [string, string]),
              }
            : null),
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

  private async sendGuidance(
    content: string,
    images: ComposerImage[] = [],
  ): Promise<{ ok: boolean; error?: string }> {
    const conversation = store.get().conversation;
    if (store.get().demo) return this.sendDemo(content, images);
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
      ...(images.length ? { images } : null),
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
        {
          req: 'soft_interrupt',
          session_id: sessionId,
          content,
          client_id: clientId,
          ...(images.length
            ? {
                images: images
                  .filter((image) => image.base64)
                  .map((image) => [image.mediaType, image.base64!] as [string, string]),
              }
            : null),
        },
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
    } catch {
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

  private async sendDemo(
    content: string,
    images: ComposerImage[],
  ): Promise<{ ok: boolean; error?: string }> {
    if (!store.get().demo) return { ok: false, error: 'Preview has ended.' };
    const now = Date.now();
    const conversation = store.get().conversation;
    const index = conversation.totalMessages;
    const userMessage: HistoryMessage = {
      index,
      role: 'user',
      content: content || 'Image attached',
      ...(images.length
        ? {
            images: images.map((image) => ({
              media_type: image.mediaType,
              data: image.base64 ?? '',
              uri: image.uri,
              alt: image.alt ?? image.name,
              label: image.name,
              source: 'user_prompt',
            })),
          }
        : null),
    };
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        messages: [...state.conversation.messages, userMessage],
        totalMessages: index + 1,
        execution: { kind: 'working', label: 'Preview', observedAt: now, turnId: 1 },
        reasoningPhase: 'none',
      },
    }));
    if (!images.length && !content) return { ok: true };
    setTimeout(() => {
      if (!store.get().demo) return;
      store.setState((state) => ({
        conversation: {
          ...state.conversation,
          messages: [
            ...state.conversation.messages,
            {
              index: state.conversation.totalMessages,
              role: 'assistant',
              content:
                'This is the **Preview** surface. Nothing was sent. Pair a server to run the instruction on your VPS.',
            },
          ],
          totalMessages: state.conversation.totalMessages + 1,
          execution: { kind: 'ready', label: 'Ready', observedAt: Date.now(), turnId: 1 },
        },
      }));
    }, 500);
    return { ok: true };
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
    if (store.get().demo) {
      store.setState((state) => ({
        conversation: {
          ...state.conversation,
          execution: {
            kind: 'stopped',
            label: 'Stopped',
            detail: 'Preview only',
            observedAt: Date.now(),
            turnId: state.conversation.execution.turnId,
          },
          reasoningPhase: 'none',
        },
      }));
      return { ok: true };
    }
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
    if (store.get().demo) return;
    const conversation = store.get().conversation;
    const client = this.client;
    const sessionId = conversation.sessionId;
    if (!sessionId || !client?.isOpen) return;
    const epoch = this.lifecycleEpoch;
    const profileId = this.profile?.id ?? null;
    const generation = this.clientGeneration;
    store.setState((state) => ({ conversation: { ...state.conversation, planLoading: true } }));
    try {
      const frame = await client.request({ req: 'get_todo_state', session_id: sessionId }, 10_000);
      if (!this.ownsClient(epoch, profileId, generation, client)) return;
      if (store.get().conversation.sessionId !== sessionId) return;
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
    const epoch = this.lifecycleEpoch;
    const rows = await listServers();
    if (this.lifecycleEpoch !== epoch) return;
    const profile = rows.find((row) => row.id === profileId);
    if (!profile) return;
    await setPref(LAST_SERVER, profile.id);
    if (this.lifecycleEpoch !== epoch) return;
    this.closeConversation();
    await this.activateProfile(profile, { restore: true });
  }

  async forgetServer(): Promise<void> {
    if (!this.profile) return;
    const profileId = this.profile.id;
    this.invalidateLifecycle();
    const epoch = this.lifecycleEpoch;
    this.profile = null;
    this.token = null;
    this.pairWrites.delete(profileId);
    this.inventoryRequested = false;
    this.suspendInventoryPolling();
    await this.profileQueue(profileId, async () => {
      // A new pair for this endpoint owns the profile now; do not delete it.
      if (this.pairWrites.has(profileId)) return;
      await deleteToken(profileId).catch(() => undefined);
      await deleteServer(profileId).catch(() => undefined);
      await clearServerCache(profileId).catch(() => undefined);
    });
    if (this.lifecycleEpoch !== epoch) return;
    for (const key of [...this.confirmedTitles.keys()]) {
      if (key.startsWith(`${profileId}:`)) this.confirmedTitles.delete(key);
    }
    const remaining = await listServers();
    if (this.lifecycleEpoch !== epoch) return;
    this.profile = null;
    this.token = null;
    this.attachedSessionId = null;
    store.setState({
      profileId: null,
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
    if (remaining[0]) await this.activateProfile(remaining[0], { restore: false });
  }

  async disconnect(): Promise<void> {
    this.invalidateLifecycle();
    this.suspendInventoryPolling();
    this.setConnectionState('cached');
  }

  async reconnect(): Promise<void> {
    if (this.credentialLoading) return;
    this.reconnectAttempt = 0;
    this.clearReconnect();
    this.recoveryRequested = true;
    if (this.connectAttempt) {
      this.setConnectionState('reconnecting');
      return this.connectAttempt.promise;
    }
    this.dropTransport();
    this.setConnectionState('reconnecting');
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

  async setThemeFamily(value: string): Promise<void> {
    if (!isThemeFamily(value)) return;
    store.setState({ themeFamily: value });
    await setPref(THEME_FAMILY, value);
  }

  async setEffects(value: EffectsPreference): Promise<void> {
    if (!isEffects(value)) return;
    store.setState({ effects: value });
    await setPref(EFFECTS, value);
  }

  async setReasoningDisplay(value: ReasoningDisplay): Promise<void> {
    if (!isReasoningDisplay(value)) return;
    // Presentation only: this never touches the attachment or the turn.
    store.setState({ reasoningDisplay: value });
    await setPref(REASONING_DISPLAY, value);
  }

  /**
   * Labelled demo. No socket, no daemon, no repository state. Used by Welcome
   * so the interface can be inspected before pairing.
   */
  enterDemo(): void {
    this.stopHealthChecks();
    this.suspendInventoryPolling();
    const now = Date.now();
    const rich = demoSessions.find((session) => session.session_id === DEMO_SESSION_ID) ?? demoSessions[0];
    store.setState((state) => ({
      demo: true,
      bootstrap: 'ready',
      connection: {
        ...state.connection,
        state: 'current',
        lastCheckedAt: now,
        lastContactAt: now,
        serverLabel: 'Preview · sample data',
        host: 'On this phone',
        daemonVersion: 'preview',
        serverName: 'Preview',
        capabilities: [
          'mobile_continuation',
          'bounded_history',
          'identity_fencing',
          'delivery_receipts',
          'soft_interrupt_ids',
          'todo_state',
          'file_read',
          'archive_restore',
          'models',
          'directory_browse',
          'session_config',
          'context_snapshot',
          'image_input',
          'changes',
        ],
        error: null,
        attempt: 0,
      },
      inventory: {
        ...state.inventory,
        sessions: demoSessions,
        fetchedAt: now,
        loading: false,
        error: null,
        partial: false,
        pinnedSessionIds: [DEMO_SESSION_ID],
        projects: demoProjects,
      },
      conversation: resetConversation({
        serverId: DEMO_SERVER_ID,
        sessionId: DEMO_SESSION_ID,
        attachmentId: 'demo-attachment',
        session: rich,
        title: rich.title ?? 'Preview session',
        workingDir: rich.working_dir ?? null,
        messages: demoMessages,
        totalMessages: demoMessages.length,
        baseIndex: 0,
        hasOlder: false,
        reasoning: demoReasoning,
        reasoningPhase: 'thinking',
        reasoningStartedAt: now - 5_000,
        tools: demoTools,
        changes: deriveChanges(demoMessages, demoTools),
        config: {
          model: 'claude-sonnet-preview',
          effort: 'high',
          efforts: ['none', 'low', 'medium', 'high', 'max'],
          modelConfirmed: true,
          effortConfirmed: true,
          source: 'server',
          pendingModel: null,
          pendingEffort: null,
          applying: false,
          error: null,
          observedAt: now,
        },
        context: demoContext,
        execution: {
          kind: 'working',
          label: 'Running bash',
          detail: 'bun run typecheck',
          observedAt: now,
          turnId: 1,
        },
        seam: { index: 2, count: 3 },
        historyFreshness: { status: 'authoritative', observedAt: now },
        plan: {
          state: {
            todos: [
              { id: 't1', content: 'Verify continuation attach', status: 'completed' },
              { id: 't2', content: 'Restore draft and reading anchor', status: 'completed' },
              { id: 't3', content: 'Run adapter contract tests', status: 'in_progress' },
            ],
          },
          observedAt: now,
        },
      }),
    }));
  }

  exitDemo(): void {
    store.setState((state) => ({
      demo: false,
      connection: {
        ...state.connection,
        state: 'cached',
        serverLabel: '',
        host: '',
        daemonVersion: null,
        serverName: null,
        capabilities: [],
        error: null,
      },
      inventory: {
        ...state.inventory,
        sessions: [],
        fetchedAt: null,
        error: null,
        pinnedSessionIds: [],
        projects: [],
      },
      conversation: resetConversation(),
    }));
  }

  private openDemoSession(sessionId: string): void {
    const session = demoSessions.find((entry) => entry.session_id === sessionId) ?? demoSessions[0];
    const rich = session.session_id === DEMO_SESSION_ID;
    store.setState((state) => ({
      conversation: resetConversation({
        serverId: DEMO_SERVER_ID,
        sessionId: session.session_id,
        attachmentId: `demo-${session.session_id}`,
        session,
        title: session.title ?? 'Preview session',
        workingDir: session.working_dir ?? null,
        messages: rich ? demoMessages : [],
        totalMessages: rich ? demoMessages.length : 0,
        reasoning: rich ? demoReasoning : '',
        reasoningPhase: rich ? 'thinking' : 'none',
        reasoningStartedAt: rich ? Date.now() - 5_000 : null,
        tools: rich ? demoTools : [],
        changes: rich ? deriveChanges(demoMessages, demoTools) : [],
        config: {
          model: 'claude-sonnet-preview',
          effort: 'high',
          efforts: ['none', 'low', 'medium', 'high', 'max'],
          modelConfirmed: true,
          effortConfirmed: true,
          source: 'server',
          pendingModel: null,
          pendingEffort: null,
          applying: false,
          error: null,
          observedAt: Date.now(),
        },
        context: rich ? demoContext : null,
        execution: rich
          ? {
              kind: 'working',
              label: 'Running bash',
              detail: 'bun run typecheck',
              observedAt: Date.now(),
              turnId: 1,
            }
          : { kind: 'ready', label: 'Ready', observedAt: Date.now(), turnId: 1 },
        historyFreshness: { status: 'authoritative', observedAt: Date.now() },
      }),
      connection: { ...state.connection, state: 'current' },
    }));
  }

  async togglePinnedSession(sessionId: string): Promise<void> {
    const current = store.get().inventory.pinnedSessionIds;
    const next = current.includes(sessionId)
      ? current.filter((value) => value !== sessionId)
      : [...current, sessionId].slice(-24);
    store.setState((state) => ({ inventory: { ...state.inventory, pinnedSessionIds: next } }));
    await setPref(PINNED_SESSIONS, JSON.stringify(next));
  }

  async saveProjects(projects: Array<ProjectLike>): Promise<void> {
    store.setState((state) => ({ inventory: { ...state.inventory, projects } }));
    await setPref(PROJECTS, JSON.stringify(projects));
  }

  /** Server-owned model catalog and model-specific effort ladder. */
  async refreshModels(): Promise<{ models: string[]; current: string | null }> {
    if (store.get().demo) {
      const config = store.get().conversation.config;
      return { models: ['claude-sonnet-preview', 'gpt-5-preview'], current: config.model };
    }
    const client = this.client;
    const sessionId = store.get().conversation.sessionId;
    if (!client?.isOpen || !sessionId) return { models: [], current: null };
    try {
      const frame = await client.request({ req: 'list_models', session_id: sessionId }, 8_000, {
        suppressEvent: true,
      });
      if (frame.ev !== 'models') return { models: [], current: null };
      this.applyCatalog(frame);
      return { models: frame.models, current: frame.current ?? null };
    } catch {
      return { models: [], current: null };
    }
  }

  private applyCatalog(frame: Extract<ServerEvent, { ev: 'models' }>): void {
    const sessionId = store.get().conversation.sessionId;
    if (!sessionId || frame.session_id !== sessionId) return;
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        config: {
          ...state.conversation.config,
          model: frame.current ?? state.conversation.config.model,
          modelConfirmed: frame.current !== undefined && frame.current !== null,
          efforts: frame.efforts ?? state.conversation.config.efforts,
          effort: frame.current_effort ?? state.conversation.config.effort,
          effortConfirmed:
            frame.current_effort !== undefined && frame.current_effort !== null,
          source: 'server',
          observedAt: Date.now(),
        },
      },
    }));
  }

  /**
   * Apply model then effort. The adapter only reports confirmed after the
   * daemon acknowledges the corresponding change event.
   */
  async configureSession(input: {
    model?: string | null;
    effort?: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    if (store.get().demo) {
      store.setState((state) => ({
        conversation: {
          ...state.conversation,
          config: {
            ...state.conversation.config,
            model: input.model ?? state.conversation.config.model,
            effort: input.effort ?? state.conversation.config.effort,
            applying: false,
            source: 'server',
            observedAt: Date.now(),
          },
        },
      }));
      return { ok: true };
    }
    const client = this.client;
    const conversation = store.get().conversation;
    const sessionId = conversation.sessionId;
    if (!client?.isOpen || !sessionId) return { ok: false, error: 'Reconnect to change configuration.' };
    if (conversation.execution.kind === 'working') {
      return { ok: false, error: 'This turn is running. Configuration applies to the next turn.' };
    }
    const model = input.model ?? conversation.config.model;
    const effort = input.effort ?? conversation.config.effort;
    store.setState((state) => ({
      conversation: {
        ...state.conversation,
        config: {
          ...state.conversation.config,
          applying: true,
          error: null,
          pendingModel: input.model ?? state.conversation.config.pendingModel,
          pendingEffort: input.effort ?? state.conversation.config.pendingEffort,
          source: 'pending',
        },
      },
    }));
    try {
      if (input.model !== undefined && input.model !== conversation.config.model) {
        const reply = await client.request(
          { req: 'set_model', session_id: sessionId, model: input.model ?? '' },
          15_000,
          { suppressEvent: true },
        );
        if (reply.ev === 'error') throw new Error(reply.message);
      }
      if (input.effort !== undefined) {
        const reply = await client.request(
          { req: 'set_effort', session_id: sessionId, effort: input.effort },
          15_000,
          { suppressEvent: true },
        );
        if (reply.ev === 'error') throw new Error(reply.message);
      }
      store.setState((state) => ({
        conversation: {
          ...state.conversation,
          config: {
            ...state.conversation.config,
            model: model ?? state.conversation.config.model,
            effort,
            modelConfirmed: model !== null,
            effortConfirmed: input.effort === null || effort !== null,
            applying: false,
            pendingModel: null,
            pendingEffort: null,
            source: 'server',
            observedAt: Date.now(),
          },
        },
      }));
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error);
      store.setState((state) => ({
        conversation: {
          ...state.conversation,
          config: { ...state.conversation.config, applying: false, error: message },
        },
      }));
      return { ok: false, error: message };
    }
  }

  async refreshContext(): Promise<void> {
    if (store.get().demo) return;
    const client = this.client;
    const conversation = store.get().conversation;
    if (!client?.isOpen || !conversation.sessionId || !conversation.attachmentId) return;
    try {
      const frame = await client.request(
        { req: 'get_context_snapshot', session_id: conversation.sessionId },
        8_000,
        { suppressEvent: true },
      );
      if (frame.ev === 'context_snapshot') this.applyContext(frame);
    } catch {
      // Unknown stays unknown; no invented percentage.
    }
  }

  private applyContext(frame: Extract<ServerEvent, { ev: 'context_snapshot' }>): void {
    const conversation = store.get().conversation;
    if (frame.session_id !== conversation.sessionId) return;
    const next: ContextSnapshot = {
      usedTokens: frame.used_tokens,
      limitTokens: frame.limit_tokens,
      basis: frame.basis,
      model: frame.model,
      observedAt: frame.observed_at_ms,
      freshness: 'current',
      source: 'adapter',
    };
    store.setState((state) => ({ conversation: { ...state.conversation, context: next } }));
  }

  /** Authenticated read-only server directory listing. */
  async listDirectories(
    path: string,
    options: { cursor?: string; showHidden?: boolean } = {},
  ): Promise<
    | { ok: true; canonicalPath: string; parent: string | null; entries: import('./protocol/frames').DirectoryEntry[]; cursor: string | null; roots: string[] }
    | { ok: false; error: string }
  > {
    const client = this.client;
    if (!client?.isOpen) return { ok: false, error: 'Reconnect to browse the server.' };
    const capabilities =
      client.hello?.ev === 'hello_ok' ? client.hello.capabilities : [];
    if (!capabilities.includes('directory_browse')) {
      return { ok: false, error: 'This server does not support folder browsing.' };
    }
    try {
      const frame = await client.request(
        {
          req: 'list_directories',
          path,
          ...(options.cursor ? { cursor: options.cursor } : null),
          show_hidden: options.showHidden === true,
          limit: 100,
        },
        12_000,
        { suppressEvent: true },
      );
      if (frame.ev === 'error') return { ok: false, error: frame.message };
      if (frame.ev !== 'directory') return { ok: false, error: 'The server returned no folder listing.' };
      if (frame.error) return { ok: false, error: frame.error };
      return {
        ok: true,
        canonicalPath: frame.canonical_path,
        parent: frame.parent,
        entries: frame.entries.filter((entry) => entry.kind === 'directory'),
        cursor: frame.cursor,
        roots: frame.roots,
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
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
        const profileId = this.profile?.id;
        const session = profileId
          ? this.mergeConfirmedTitle(profileId, frame.session, -1)
          : frame.session;
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
        if (frame.capabilities.includes('session_config')) {
          setTimeout(() => {
            if (store.get().conversation.attachmentId === frame.attachment_id) {
              void this.refreshModels();
            }
          }, 0);
        }
        if (frame.capabilities.includes('context_snapshot')) {
          setTimeout(() => {
            if (store.get().conversation.attachmentId === frame.attachment_id) {
              void this.refreshContext();
            }
          }, 0);
        }
        return;
      }
      case 'history': {
        if (!belongs(frame.attachment_id)) return;
        void this.applyHistory(frame);
        return;
      }
      case 'text_delta': {
        if (!belongs(frame.attachment_id)) return;
        if (store.get().conversation.reasoningPhase === 'thinking') {
          store.setState((state) => ({
            conversation: { ...state.conversation, reasoningPhase: 'working' },
          }));
        }
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
            reasoningPhase: 'thinking',
            reasoningStartedAt: state.conversation.reasoningStartedAt ?? Date.now(),
          },
        }));
        return;
      }
      case 'reasoning_done': {
        if (!belongs(frame.attachment_id)) return;
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            reasoningPhase: 'working',
            reasoningDurationSecs:
              frame.duration_secs ??
              (state.conversation.reasoningStartedAt
                ? (Date.now() - state.conversation.reasoningStartedAt) / 1000
                : null),
          },
        }));
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
        store.setState((state) => ({
          conversation: { ...state.conversation, reasoningPhase: 'working' },
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
        store.setState((state) => {
          const tools = this.boundTools(
            state.conversation.tools.map((tool) =>
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
            ),
          );
          return {
            conversation: {
              ...state.conversation,
              tools,
              changes: deriveChanges(state.conversation.messages, tools),
              reasoningPhase: 'working',
            },
          };
        });
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
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            reasoningPhase: 'none',
            reasoningDurationSecs:
              state.conversation.reasoningDurationSecs ??
              (state.conversation.reasoningStartedAt
                ? (Date.now() - state.conversation.reasoningStartedAt) / 1000
                : null),
          },
        }));
        void this.refreshContext();
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
        store.setState((state) => ({
          conversation: { ...state.conversation, reasoningPhase: 'none' },
        }));
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
        const profileId = this.profile?.id;
        if (!profileId) return;
        this.applyConfirmedTitle(
          profileId,
          frame.session_id,
          frame.title ?? null,
          frame.display_title || frame.title || '',
        );
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
      case 'models': {
        this.applyCatalog(frame);
        return;
      }
      case 'context_snapshot': {
        if (frame.session_id !== conversation.sessionId) return;
        this.applyContext(frame);
        return;
      }
      case 'session_config': {
        if (frame.session_id !== conversation.sessionId) return;
        store.setState((state) => ({
          conversation: {
            ...state.conversation,
            config: {
              ...state.conversation.config,
              model: frame.model ?? state.conversation.config.model,
              effort: frame.effort,
              efforts: frame.efforts.length
                ? frame.efforts
                : state.conversation.config.efforts,
              modelConfirmed: frame.confirmed && frame.model !== null,
              effortConfirmed: frame.confirmed,
              applying: false,
              pendingModel: null,
              pendingEffort: null,
              source: frame.confirmed ? 'server' : 'unknown',
              error: null,
              observedAt: Date.now(),
            },
          },
        }));
        return;
      }
      case 'directory':
      case 'image_ack':
        return;
      case 'session_closed': {
        store.setState((state) => ({
          conversation: { ...state.conversation, lastError: frame.reason },
        }));
        return;
      }
      case 'error': {
        if (frame.code === 'unauthorized') {
          this.stopHealthChecks();
          this.dropTransport();
          this.setConnectionState('pair_again', 'This phone is no longer authorized.');
          return;
        }
        if (frame.code === 'daemon_unavailable') {
          this.markDeliveriesUnconfirmed();
          this.setConnectionState('reconnecting', frame.message);
          const client = this.client;
          const generation = this.clientGeneration;
          if (client) void this.handleTransportFailure(client, generation, frame.message);
          else this.scheduleReconnect();
          return;
        }
        if (frame.code === 'unsupported_version' || frame.code === 'unsupported_capability') {
          this.stopHealthChecks();
          this.dropTransport();
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
    const epoch = this.lifecycleEpoch;
    const generation = this.clientGeneration;
    const client = this.client;

    const bookmark = await getBookmark(serverId, sessionId);
    if (
      epoch !== this.lifecycleEpoch ||
      generation !== this.clientGeneration ||
      this.client !== client ||
      this.profile?.id !== serverId ||
      store.get().conversation.sessionId !== sessionId
    ) {
      return;
    }
    const messages = attachHistoryImages(frame.messages, frame.images);
    const firstVisit = bookmark === null && this.firstVisit;
    const seam = deriveSeam(messages, frame.total_messages, frame.base_index, bookmark, firstVisit);
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
        messages,
        totalMessages: frame.total_messages,
        baseIndex: frame.base_index,
        hasOlder: frame.base_index > 0,
        loadingOlder: false,
        provisionalText: '',
        reasoning: '',
        reasoningPhase: 'none',
        reasoningStartedAt: null,
        reasoningDurationSecs: null,
        changes: deriveChanges(messages, current.conversation.tools),
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
          ? { ...current.connection, state: 'current', error: null }
          : current.connection,
    }));
    this.clearReconciliation();
    this.noteContact();

    if (firstVisit) {
      const last = messages[messages.length - 1];
      await setBookmark(serverId, sessionId, frame.total_messages, last ? messageFingerprint(last) : '');
    }

    // Persist asynchronously; a big transcript must not block the frame loop.
    setTimeout(() => {
      if (epoch !== this.lifecycleEpoch || this.profile?.id !== serverId) return;
      void upsertMessages(serverId, sessionId, messages);
    }, 0);
  }

  async loadOlder(): Promise<void> {
    if (store.get().demo) return;
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
    lastContactAt: number | null;
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
      lastContactAt: state.connection.lastContactAt,
      capabilities: state.connection.capabilities,
      deviceId: this.profile.device_id,
    };
  }

  formatChecked(): string {
    const at = store.get().connection.lastCheckedAt;
    return at ? formatClock(at) : '';
  }
}

export const controller = new AppController();
