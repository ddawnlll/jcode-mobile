/**
 * One mobile session attachment.
 *
 * Every attach sends the raw Subscribe with `continue_on_disconnect: true`
 * (default is false at jcode@v0.99.1) so an abrupt socket close - including the
 * phone force-quitting - leaves the server-owned turn running. The only
 * destructive request this class can send is `cancel`, and only from an
 * explicit Stop.
 */
import type { AdapterConfig } from './config.ts';
import { log } from './config.ts';
import { RawDaemonConnection } from './rawDaemon.ts';
import { newId, tailFingerprint, truncate } from './util.ts';
import { effortLadders, inferredEfforts } from './efforts.ts';
import type { ContextCache } from './context-cache.ts';

export type Emit = (frame: Record<string, unknown>) => void;

export interface AttachmentOptions {
  config: AdapterConfig;
  replyTo: number;
  emit: Emit;
  /** Negotiated client frame budget; keeps every outgoing frame decodable. */
  maxFrameBytes?: number;
  sessionId?: string;
  workingDir?: string;
  lookupSession?: (sessionId: string) => Record<string, unknown> | undefined;
  contextCache?: ContextCache;
  acceptedClientIds?: () => string[];
  onAccepted?: (clientMessageId: string) => void;
  onClosed?: () => void;
}

interface PendingMessage {
  clientMessageId: string;
  sentAt: number;
  /** The daemon has received the frame; it has not necessarily ingested it. */
  status: 'pending' | 'acked';
  turnId?: number;
}

interface ToolState {
  name: string;
  input: string;
  startedAt: number;
}

interface PendingRename {
  id: number;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  /** The custom title this request expects back; null means clear. */
  expectedTitle: string | null;
  resolve: (result: { title: string | null; displayTitle: string }) => void;
  reject: (error: Error) => void;
}

const MAX_TOOL_INPUT_BYTES = 256 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const MAX_HISTORY_MESSAGE_BYTES = 256 * 1024;
const MAX_RECOVERY_MESSAGE_BYTES = 8 * 1024;
const BOOTSTRAP_QUEUE_LIMIT = 2000;
/** Fraction of the client budget reserved for the rest of the frame envelope. */
const HISTORY_FRAME_RESERVE = 96 * 1024;
const HISTORY_IMAGE_SHARE = 0.55;

interface CatalogWaiter {
  resolve: (value: { models: string[]; current: string | null }) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface TokenUsageSnapshot {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  at: number;
  /** Route the usage belongs to; a switch invalidates the old measurement. */
  model: string | null;
  fromCache?: boolean;
}

interface ConfigWaiter {
  kind: 'model' | 'effort';
  resolve: (value: { error?: string; effort?: string | null; model?: string | null; contextWindow?: number | null }) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Attachment {
  readonly attachmentId = newId('att');
  sessionId: string;
  private readonly options: AttachmentOptions;
  private readonly connection: RawDaemonConnection;
  private readonly pending = new Map<number, PendingMessage>();
  private readonly turnByRequest = new Map<number, number>();
  private readonly tools = new Map<string, ToolState>();
  private nextLegacyId = 1;
  private renameWaiter: PendingRename | null = null;
  private orphanedRename: { id: number; expectedTitle: string | null } | null = null;
  private completedRenameIds = new Set<number>();
  private history: Array<{ index: number; role: string; content: string; response_stats?: unknown }> = [];
  private historyTotal = 0;
  private historyReceived = false;
  private preHistoryQueue: Array<Record<string, unknown>> = [];
  private ready = false;
  private turnId = 1;
  private status: 'working' | 'ready' | 'unknown' = 'unknown';
  private stoppedThisTurn = false;
  private currentToolCallId: string | null = null;
  private closed = false;
  private createdAt = Date.now();
  private daemonVersion: string | null = null;
  private historyImages: Array<Record<string, unknown>> = [];
  private historyImageBytes = 0;
  private historyImagesOmitted = 0;
  private emptyHistorySeen = false;
  private tokenUsage: TokenUsageSnapshot | null = null;
  private contextWindow: number | null = null;
  private providerName: string | null = null;
  private modelName: string | null = null;
  private currentEffort: string | null = null;
  private modelsList: string[] = [];
  private modelRoutes: Array<{ model: string; provider: string; available: boolean }> = [];
  private configWaiters = new Map<number, ConfigWaiter>();
  private catalogWaiters = new Map<number, CatalogWaiter>();
  private runtimeWaiters = new Map<number, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
  /**
   * Request ids that are not agent turns. A `done` (or `ack`) for one of these
   * is a control reply, never turn completion or execution evidence (STR-4).
   */
  private controlIds = new Set<number>();

  constructor(options: AttachmentOptions) {
    this.options = options;
    this.sessionId = options.sessionId ?? '';
    this.connection = new RawDaemonConnection(options.config.daemonSocket);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get observedStatus(): 'working' | 'ready' | 'unknown' {
    return this.status;
  }

  get ageMs(): number {
    return Date.now() - this.createdAt;
  }

  get observedDaemonVersion(): string | null {
    return this.daemonVersion;
  }

  currentConfig(): {
    model: string | null;
    effort: string | null;
    efforts: string[];
    effortsByModel: Record<string, string[]>;
    modelConfirmed: boolean;
    effortConfirmed: boolean;
  } {
    return {
      model: this.modelName,
      effort: this.currentEffort,
      efforts: inferredEfforts(this.providerName, this.modelName),
      effortsByModel: effortLadders(this.providerName, this.modelsList),
      modelConfirmed: this.modelName !== null,
      effortConfirmed: this.modelName !== null,
    };
  }

  private emit(frame: Record<string, unknown>, replyTo?: number): void {
    this.options.emit(replyTo !== undefined ? { ...frame, reply_to: replyTo } : frame);
  }

  private frameBudget(): number {
    return this.options.maxFrameBytes ?? this.options.config.maxFrameBytes;
  }

  private identity(): Record<string, unknown> {
    return {
      session_id: this.sessionId,
      attachment_id: this.attachmentId,
    };
  }

  private nextId(): number {
    return this.nextLegacyId++;
  }

  private trackControl(id: number): void {
    this.controlIds.add(id);
    if (this.controlIds.size > 200) {
      const oldest = this.controlIds.values().next().value;
      if (typeof oldest === 'number') this.controlIds.delete(oldest);
    }
  }

  async start(): Promise<void> {
    const cached = this.options.contextCache?.get(this.sessionId);
    if (cached) {
      this.tokenUsage = {
        input: cached.input,
        output: cached.output,
        cacheRead: cached.cacheRead,
        cacheCreate: cached.cacheCreate,
        at: cached.at,
        model: cached.model,
        fromCache: true,
      };
      this.contextWindow = cached.contextWindow;
      if (cached.model) this.modelName = cached.model;
    }
    this.connection.onEvent((event) => this.onDaemonEvent(event));
    this.connection.onClose(() => this.onSocketClose());
    await this.connection.connect();

    const subscribeId = this.nextId();
    const stateId = this.nextId();
    const subscribe: Record<string, unknown> = {
      type: 'subscribe',
      id: subscribeId,
      client_instance_id: `jcode-mobile-adapter:${this.attachmentId}`,
      client_has_local_history: false,
      allow_session_takeover: false,
      supports_server_failover: true,
      supports_user_response: false,
      supports_pdf_panels: false,
      // Mandatory for this product: the server keeps the running turn alive
      // after this transport disappears.
      continue_on_disconnect: true,
    };
    if (this.options.workingDir) subscribe.working_dir = this.options.workingDir;
    else if (this.options.sessionId) subscribe.target_session_id = this.options.sessionId;
    this.connection.send(subscribe);
    this.connection.send({ type: 'state', id: stateId });

    await this.waitForState(stateId);
    this.markReady();
  }

  private waitForState(stateId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.closed) {
          reject(new Error('Daemon closed the attachment during bootstrap.'));
          return;
        }
        if (this.ready) {
          resolve();
          return;
        }
        if (Date.now() - started > 12_000) {
          reject(new Error('The server did not confirm the session attachment.'));
          return;
        }
        setTimeout(check, 40);
      };
      this.pendingStateId = stateId;
      check();
    });
  }

  private pendingStateId: number | null = null;

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    const info =
      (this.options.lookupSession?.(this.sessionId) as Record<string, unknown> | undefined) ?? {};
    const sessionInfo: Record<string, unknown> = {
      ...info,
      session_id: this.sessionId,
      ...(this.options.workingDir ? { working_dir: this.options.workingDir } : null),
      status: this.status === 'unknown' ? 'idle' : this.status,
      ...(this.status === 'working' ? { live_state: 'working' } : null),
      ...(this.status === 'ready' ? { live_state: 'ready' } : null),
    };
    this.emit(
      {
        ev: 'attached',
        session: sessionInfo,
        attachment_id: this.attachmentId,
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
        continuation: true,
      },
      this.options.replyTo,
    );
    this.emitStatus();
    if (this.historyReceived) this.emitHistory();
    else {
      // Some daemon paths answer the attachment state before (or without) an
      // unsolicited history frame. Ask explicitly rather than leaving the
      // client waiting on a boundary that may never arrive.
      setTimeout(() => {
        if (this.closed || this.historyReceived) return;
        this.requestHistory();
      }, 1200).unref();
    }
    // Live delivery starts here. History is a separate reconciliation stream;
    // waiting for it would hold deltas behind a snapshot (STR-1).
    this.flushPreHistory();
    void this.refreshRuntimeContext();
  }

  private lastTerminal: { message: string; at: number } | null = null;

  private noteTerminal(message: string): void {
    this.lastTerminal = { message, at: Date.now() };
  }

  private isDuplicateTerminal(message: string): boolean {
    return (
      this.lastTerminal !== null &&
      this.lastTerminal.message === message &&
      Date.now() - this.lastTerminal.at < 5000
    );
  }

  private emitStatus(): void {
    if (!this.ready) return;
    const status = this.status === 'working' ? 'running' : this.status === 'ready' ? 'idle' : 'unknown';
    this.emit({ ev: 'session_status', ...this.identity(), status });
  }

  private emitHistory(): void {
    if (!this.ready) return;
    const window = this.options.config.historyWindow;
    const baseIndex = Math.max(0, this.history.length - window);
    const bounded = this.boundHistory(this.history.slice(baseIndex), this.historyOffset + baseIndex);
    const interrupted = this.lastHistoryFlags.interrupted;
    const recovery = this.lastHistoryFlags.recovery;
    this.emit({
      ev: 'history',
      ...this.identity(),
      messages: bounded.messages,
      base_index: bounded.baseIndex,
      total_messages: this.historyTotal,
      tail_fingerprint: tailFingerprint(this.history),
      accepted_client_ids: this.options.acceptedClientIds?.() ?? [],
      ...(this.historyImages.length ? { images: this.historyImages } : null),
      ...(this.historyImagesOmitted ? { images_omitted: this.historyImagesOmitted } : null),
      ...(interrupted ? { interrupted_at_attach: true } : null),
      ...(recovery ? { recovery } : null),
    });
  }

  /**
   * Enforce an outgoing UTF-8 budget, independent of message count. The
   * returned copies carry the truncation marker; sizing a clone and then
   * returning the original slice made the budget lie (HIST-1).
   */
  private boundHistory(
    messages: Array<{ index: number; role: string; content: string; response_stats?: unknown }>,
    baseIndex: number,
  ): { messages: typeof messages; baseIndex: number } {
    const budget = Math.max(
      64 * 1024,
      Math.min(
        this.options.config.maxHistoryBytes,
        // Text and images share one frame, so text gets what media does not.
        this.frameBudget() - HISTORY_FRAME_RESERVE - this.historyImageBytes,
      ),
    );
    // A single large message must fit too: the previous loop always kept the
    // newest message even when it alone exceeded the budget.
    const perMessageCap = Math.max(
      1024,
      Math.min(MAX_HISTORY_MESSAGE_BYTES, Math.floor(budget * 0.75)),
    );
    let bytes = 0;
    let start = messages.length;
    const kept: typeof messages = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = { ...messages[index] };
      const limited = truncate(message.content, perMessageCap);
      message.content = limited.truncated ? `${limited.text}\n[truncated by adapter]` : limited.text;
      const size = Buffer.byteLength(JSON.stringify(message), 'utf8') + 1;
      if (start < messages.length && bytes + size > budget) break;
      bytes += size;
      start = index;
      kept.unshift(message);
    }
    return { messages: kept, baseIndex: baseIndex + start };
  }

  private lastHistoryFlags: {
    interrupted: boolean;
    recovery?: { continuation_message: string; reconnect_notice?: string };
  } = { interrupted: false };

  /** Number of messages dropped from the front of the retained window. */
  private historyOffset = 0;

  private flushPreHistory(): void {
    if (!this.ready) return;
    const queue = this.preHistoryQueue.splice(0);
    for (const frame of queue) this.options.emit(frame);
  }

  private queue(frame: Record<string, unknown>): void {
    if (this.preHistoryQueue.length >= BOOTSTRAP_QUEUE_LIMIT) {
      this.preHistoryQueue.shift();
      log(this.options.config, 'warn', 'dropping a bootstrap event: queue limit');
    }
    this.preHistoryQueue.push(frame);
  }

  private onSocketClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.renameWaiter) {
      clearTimeout(this.renameWaiter.timer);
      this.renameWaiter.reject(new Error('The session connection ended before the rename confirmed.'));
      this.renameWaiter = null;
    }
    this.orphanedRename = null;
    for (const waiter of this.catalogWaiters.values()) clearTimeout(waiter.timer);
    this.catalogWaiters.clear();
    this.options.onClosed?.();
    this.options.emit({
      ev: 'error',
      code: 'daemon_unavailable',
      message: 'The connection to the JCode session ended.',
    });
  }

  private onDaemonEvent(event: Record<string, unknown>): void {
    if (this.closed) return;
    const type = typeof event.type === 'string' ? event.type : '';
    switch (type) {
      case 'state': {
        const sessionId = typeof event.session_id === 'string' ? event.session_id : this.sessionId;
        if (sessionId) this.sessionId = sessionId;
        const processing = event.is_processing === true;
        this.status = processing ? 'working' : 'ready';
        if (processing && this.ready) this.promoteAcked();
        if (event.id === this.pendingStateId) this.markReady();
        else if (this.ready) this.emitStatus();
        return;
      }
      case 'session': {
        if (typeof event.session_id === 'string' && !this.sessionId) {
          this.sessionId = event.session_id;
        }
        return;
      }
      case 'history': {
        this.onHistory(event);
        return;
      }
      case 'ack': {
        const id = typeof event.id === 'number' ? event.id : -1;
        if (this.controlIds.delete(id)) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        // The pinned daemon writes ACK before dispatching the message and can
        // reject it afterwards. ACK is transport receipt, not ingestion.
        pending.status = 'acked';
        pending.turnId = pending.turnId ?? this.turnId;
        this.turnByRequest.set(id, pending.turnId);
        if (this.turnByRequest.size > 200) {
          const oldest = this.turnByRequest.keys().next().value;
          if (typeof oldest === 'number') this.turnByRequest.delete(oldest);
        }
        // Do NOT publish execution state from a raw ACK (STR-4). The daemon's
        // `state`, stream or accepted evidence owns that claim.
        return;
      }
      case 'error': {
        const id = typeof event.id === 'number' ? event.id : -1;
        const message = typeof event.message === 'string' ? event.message : 'The server rejected the request.';
        const runtimeWaiter = this.runtimeWaiters.get(id);
        if (runtimeWaiter) {
          this.runtimeWaiters.delete(id);
          clearTimeout(runtimeWaiter.timer);
          this.controlIds.delete(id);
          runtimeWaiter.resolve();
          return;
        }
        const catalogWaiter = this.catalogWaiters.get(id);
        if (catalogWaiter) {
          this.catalogWaiters.delete(id);
          clearTimeout(catalogWaiter.timer);
          this.controlIds.delete(id);
          catalogWaiter.resolve({ models: this.modelsList, current: this.modelName });
          return;
        }
        const configWaiter = this.configWaiters.get(id);
        if (configWaiter) {
          this.configWaiters.delete(id);
          clearTimeout(configWaiter.timer);
          this.controlIds.delete(id);
          configWaiter.resolve({ error: message });
          return;
        }
        if (this.completedRenameIds.delete(id)) return;
        if (this.orphanedRename?.id === id) {
          this.orphanedRename = null;
          return;
        }
        if (this.renameWaiter?.id === id) {
          const waiter = this.renameWaiter;
          this.renameWaiter = null;
          clearTimeout(waiter.timer);
          waiter.reject(new Error(message));
          return;
        }
        if (this.controlIds.delete(id)) {
          this.emit({
            ev: 'control_error',
            ...this.identity(),
            message,
          });
          return;
        }
        if (this.isDuplicateTerminal(message)) return;
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          const frame = {
            ev: 'send_rejected',
            ...this.identity(),
            client_message_id: pending.clientMessageId,
            message,
          };
          if (this.ready && this.historyReceived) this.options.emit(frame);
          else this.queue(frame);
          return;
        }
        const turnActive = this.pending.size > 0 || this.turnByRequest.size > 0 || this.tools.size > 0;
        if (!turnActive) {
          this.emit({ ev: 'control_error', ...this.identity(), message });
          return;
        }
        this.status = 'ready';
        this.noteTerminal(message);
        this.stoppedThisTurn = true;
        this.push({ ev: 'turn_stopped', ...this.identity(), turn_id: this.turnId, reason: 'error', message });
        this.scheduleStoppedFallback();
        return;
      }
      case 'text_delta': {
        const text = typeof event.text === 'string' ? event.text : '';
        if (!text) return;
        this.status = 'working';
        this.push({ ev: 'text_delta', ...this.identity(), turn_id: this.turnId, text });
        return;
      }
      case 'text_replace': {
        this.push({
          ev: 'text_replace',
          ...this.identity(),
          turn_id: this.turnId,
          text: typeof event.text === 'string' ? event.text : '',
        });
        return;
      }
      case 'text_suffix_replace': {
        this.push({
          ev: 'text_suffix_replace',
          ...this.identity(),
          turn_id: this.turnId,
          old_text: typeof event.old_text === 'string' ? event.old_text : '',
          new_text: typeof event.new_text === 'string' ? event.new_text : '',
        });
        return;
      }
      case 'reasoning_delta': {
        const text = typeof event.text === 'string' ? event.text : '';
        if (!text) return;
        this.status = 'working';
        this.push({ ev: 'reasoning_delta', ...this.identity(), turn_id: this.turnId, text });
        return;
      }
      case 'reasoning_done': {
        this.push({
          ev: 'reasoning_done',
          ...this.identity(),
          turn_id: this.turnId,
          ...(typeof event.duration_secs === 'number'
            ? { duration_secs: event.duration_secs }
            : null),
        });
        return;
      }
      case 'text_done': {
        this.push({ ev: 'text_done', ...this.identity(), turn_id: this.turnId });
        return;
      }
      case 'message_end': {
        // A provider-response boundary is not an assistant-message boundary.
        // Collapsing both into text_done merged separate responses (STR-3).
        this.push({
          ev: 'message_end',
          ...this.identity(),
          turn_id: this.turnId,
          ...(typeof event.stop_reason === 'string' ? { stop_reason: event.stop_reason } : null),
        });
        return;
      }
      case 'retry_rollback': {
        this.push({
          ev: 'retry_rollback',
          ...this.identity(),
          turn_id: this.turnId,
          attempt: typeof event.attempt === 'number' ? event.attempt : 0,
          max: typeof event.max === 'number' ? event.max : 0,
        });
        this.push({
          ev: 'connection_phase',
          ...this.identity(),
          phase: `retrying (${String(event.attempt ?? '?')}/${String(event.max ?? '?')})`,
        });
        return;
      }
      case 'tool_start': {
        const callId = typeof event.id === 'string' ? event.id : '';
        const name = typeof event.name === 'string' ? event.name : 'tool';
        if (!callId) return;
        this.promoteAcked();
        this.tools.set(callId, { name, input: '', startedAt: Date.now() });
        this.currentToolCallId = callId;
        this.push({ ev: 'tool_start', ...this.identity(), turn_id: this.turnId, call_id: callId, name });
        return;
      }
      case 'tool_input': {
        const callId = typeof event.id === 'string' && event.id ? event.id : this.currentToolCallId;
        if (!callId) return;
        const tool = this.tools.get(callId);
        if (!tool) return;
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (tool.input.length + delta.length <= MAX_TOOL_INPUT_BYTES) tool.input += delta;
        return;
      }
      case 'tool_exec': {
        const callId = typeof event.id === 'string' ? event.id : '';
        const name = typeof event.name === 'string' ? event.name : 'tool';
        if (!callId) return;
        const tool = this.tools.get(callId) ?? { name, input: '', startedAt: Date.now() };
        this.tools.set(callId, tool);
        this.status = 'working';
        this.push({
          ev: 'tool_exec',
          ...this.identity(),
          turn_id: this.turnId,
          call_id: callId,
          name,
          ...(parseToolInput(tool.input) !== undefined ? { input: parseToolInput(tool.input) } : null),
        });
        return;
      }
      case 'tool_done': {
        const callId = typeof event.id === 'string' ? event.id : '';
        const name = typeof event.name === 'string' ? event.name : 'tool';
        if (!callId) return;
        this.tools.delete(callId);
        if (this.currentToolCallId === callId) this.currentToolCallId = null;
        const output = typeof event.output === 'string' ? event.output : '';
        const bounded = truncate(output, MAX_TOOL_OUTPUT_BYTES);
        this.push({
          ev: 'tool_done',
          ...this.identity(),
          turn_id: this.turnId,
          call_id: callId,
          name,
          output: bounded.text,
          error: typeof event.error === 'string' ? event.error : null,
          truncated: bounded.truncated || undefined,
        });
        return;
      }
      case 'turn_stopped': {
        const reason = typeof event.reason === 'string' ? event.reason : 'unknown';
        const message = typeof event.message === 'string' ? event.message : 'The turn stopped.';
        this.status = 'ready';
        this.noteTerminal(message);
        this.stoppedThisTurn = true;
        this.push({ ev: 'turn_stopped', ...this.identity(), turn_id: this.turnId, reason, message });
        this.scheduleStoppedFallback();
        this.requestHistory();
        return;
      }
      case 'interrupted': {
        this.status = 'ready';
        this.stoppedThisTurn = true;
        this.noteTerminal('Stopped by you.');
        this.push({
          ev: 'turn_stopped',
          ...this.identity(),
          turn_id: this.turnId,
          reason: 'interrupted',
          message: 'Stopped by you.',
        });
        this.scheduleStoppedFallback();
        return;
      }
      case 'provider_guardrail': {
        const message =
          typeof event.message === 'string' ? event.message : 'The provider ended the turn without output.';
        this.status = 'ready';
        this.noteTerminal(message);
        this.stoppedThisTurn = true;
        this.push({
          ev: 'turn_stopped',
          ...this.identity(),
          turn_id: this.turnId,
          reason: 'provider_guardrail',
          message,
        });
        this.scheduleStoppedFallback();
        return;
      }
      case 'done': {
        const id = typeof event.id === 'number' ? event.id : -1;
        // A control reply (set_session_saved, rename, cancel, ...) must never
        // finish a generation, bump turn_id, or clear tool state (STR-4).
        if (this.controlIds.delete(id)) return;
        if (this.completedRenameIds.delete(id)) return;
        if (this.orphanedRename?.id === id) {
          this.orphanedRename = null;
          return;
        }
        if (this.renameWaiter?.id === id) {
          const waiter = this.renameWaiter;
          this.renameWaiter = null;
          clearTimeout(waiter.timer);
          // The daemon emits session_renamed before done. A done without that
          // event is ambiguous, not a success claim.
          if (!waiter.settled) {
            waiter.reject(new Error('The server completed the request without confirming the new title.'));
          }
          return;
        }
        const trackedTurn = this.turnByRequest.get(id);
        const pendingMessage = this.pending.get(id);
        if (trackedTurn === undefined && !pendingMessage) {
          // Uncorrelated `done`: neither an agent turn nor a known control.
          // Never invent a phantom turn completion from it.
          return;
        }
        const turnId = trackedTurn ?? this.turnId;
        if (pendingMessage) {
          // A prompt that completed without an intervening processing state is
          // still an ingested prompt, so publish its correlated acceptance.
          this.pending.delete(id);
          this.options.onAccepted?.(pendingMessage.clientMessageId);
          this.push({
            ev: 'message_accepted',
            ...this.identity(),
            client_message_id: pendingMessage.clientMessageId,
            turn_id: turnId,
          });
        }
        this.turnByRequest.delete(id);
        this.status = 'ready';
        if (this.stoppedThisTurn) {
          // `done` is the terminal confirmation of the stopped turn, not a
          // successful completion. Keep Stopped visible and close the turn.
          this.finishTurn(turnId);
          return;
        }
        this.promoteAcked();
        this.push({ ev: 'turn_done', ...this.identity(), turn_id: turnId });
        this.finishTurn(turnId);
        this.requestHistory();
        return;
      }
      case 'soft_interrupt_injected': {
        const ids = Array.isArray(event.client_ids)
          ? event.client_ids.filter((value): value is string => typeof value === 'string')
          : [];
        this.push({
          ev: 'soft_interrupt_injected',
          ...this.identity(),
          client_ids: ids,
          point: typeof event.point === 'string' ? event.point : 'unknown',
        });
        return;
      }
      case 'soft_interrupts_cancelled': {
        this.push({
          ev: 'soft_interrupts_cancelled',
          cancelled: Array.isArray(event.client_ids) ? event.client_ids : [],
          not_queued: [],
        });
        return;
      }
      case 'soft_interrupt_queue': {
        this.push({
          ev: 'session_status',
          ...this.identity(),
          status: this.status === 'working' ? 'running' : 'idle',
          pending_soft_interrupts: typeof event.pending === 'number' ? event.pending : 0,
        });
        return;
      }
      case 'connection_phase': {
        this.push({
          ev: 'connection_phase',
          ...this.identity(),
          phase: typeof event.phase === 'string' ? event.phase : 'unknown',
        });
        return;
      }
      case 'session_renamed': {
        const eventTitle = typeof event.title === 'string' ? event.title : null;
        const displayTitle =
          typeof event.display_title === 'string' ? event.display_title : '';
        if (this.renameWaiter && this.renameWaiter.expectedTitle === eventTitle) {
          const waiter = this.renameWaiter;
          waiter.settled = true;
          clearTimeout(waiter.timer);
          this.renameWaiter = null;
          this.completedRenameIds.add(waiter.id);
          if (this.completedRenameIds.size > 50) {
            const oldest = this.completedRenameIds.values().next().value;
            if (typeof oldest === 'number') this.completedRenameIds.delete(oldest);
          }
          waiter.resolve({
            title: eventTitle,
            displayTitle,
          });
        }
        if (this.orphanedRename && this.orphanedRename.expectedTitle === eventTitle) {
          // The late confirmation belongs to the timed-out request. Retire its
          // id so the following done cannot become a turn or a later rename.
          this.completedRenameIds.add(this.orphanedRename.id);
          this.orphanedRename = null;
        }
        this.emit({
          ev: 'session_renamed',
          session_id: this.sessionId,
          title: eventTitle,
          display_title: displayTitle,
        });
        return;
      }
      case 'peer_user_message': {
        this.emit({
          ev: 'peer_user_message',
          ...this.identity(),
          content: typeof event.content === 'string' ? event.content : '',
        });
        return;
      }
      case 'compaction': {
        // Compaction changes the persisted transcript, not live delivery.
        // Re-arming a bootstrap gate here held deltas mid-turn (STR-1).
        this.requestHistory();
        return;
      }
      case 'session_close_requested': {
        this.emit({
          ev: 'session_closed',
          ...this.identity(),
          reason: typeof event.reason === 'string' ? event.reason : 'The server closed this session.',
        });
        this.closeConnection();
        return;
      }
      case 'reloading': {
        this.emit({
          ev: 'error',
          code: 'daemon_unavailable',
          message: 'The server is reloading. Reconnect when it is ready.',
        });
        this.closeConnection();
        return;
      }
      case 'tokens': {
        const input = typeof event.input === 'number' ? event.input : 0;
        const output = typeof event.output === 'number' ? event.output : 0;
        const cacheRead =
          typeof event.cache_read_input === 'number' ? event.cache_read_input : 0;
        const cacheCreate =
          typeof event.cache_creation_input === 'number' ? event.cache_creation_input : 0;
        this.tokenUsage =
          input + output + cacheRead + cacheCreate > 0
            ? {
                input,
                output,
                cacheRead,
                cacheCreate,
                at: Date.now(),
                model: this.modelName,
                fromCache: false,
              }
            : null;
        if (this.tokenUsage) this.rememberContext();
        this.emitContextSnapshot();
        return;
      }
      case 'model_changed': {
        const id = typeof event.id === 'number' ? event.id : -1;
        const model = typeof event.model === 'string' ? event.model : this.modelName;
        const modelChanged = model !== this.modelName;
        this.modelName = model ?? this.modelName;
        if (typeof event.provider_name === 'string') this.providerName = event.provider_name;
        // The daemon omits context_window when unknown. Carry-forward would
        // combine the previous route's limit with the new route's usage.
        this.contextWindow =
          typeof event.context_window === 'number' ? event.context_window : null;
        if (modelChanged) this.tokenUsage = null;
        this.rememberContext();
        this.currentEffort =
          typeof event.reasoning_effort === 'string' ? event.reasoning_effort : null;
        const waiter = this.configWaiters.get(id);
        if (waiter) {
          this.configWaiters.delete(id);
          clearTimeout(waiter.timer);
          waiter.resolve({
            model: this.modelName,
            effort: this.currentEffort,
            contextWindow: this.contextWindow,
            ...(typeof event.error === 'string' ? { error: event.error } : null),
          });
        }
        this.emitConfig();
        this.emitContextSnapshot();
        return;
      }
      case 'reasoning_effort_changed': {
        const id = typeof event.id === 'number' ? event.id : -1;
        this.currentEffort =
          typeof event.effort === 'string' ? event.effort : null;
        const waiter = this.configWaiters.get(id);
        if (waiter) {
          this.configWaiters.delete(id);
          clearTimeout(waiter.timer);
          waiter.resolve({
            effort: this.currentEffort,
            ...(typeof event.error === 'string' ? { error: event.error } : null),
          });
        }
        this.emitConfig();
        return;
      }
      case 'side_pane_images': {
        this.requestHistory();
        return;
      }
      case 'runtime_command_result': {
        const id = typeof event.id === 'number' ? event.id : -1;
        this.controlIds.delete(id);
        this.applyRuntimeCommandData(event.data);
        const waiter = this.runtimeWaiters.get(id);
        if (waiter) {
          this.runtimeWaiters.delete(id);
          clearTimeout(waiter.timer);
          waiter.resolve();
        }
        return;
      }
      case 'available_models_updated': {
        if (Array.isArray(event.available_models)) {
          this.modelsList = event.available_models.filter(
            (value): value is string => typeof value === 'string',
          );
        }
        if (typeof event.provider_name === 'string') this.providerName = event.provider_name;
        if (typeof event.provider_model === 'string') this.modelName = event.provider_model;
        this.parseModelRoutes(event.available_model_routes);
        this.emitConfig();
        return;
      }
      default:
        return;
    }
  }

  private push(frame: Record<string, unknown>): void {
    // Only pre-attach events can be queued. Live delivery no longer waits for
    // a transcript snapshot, so a slow history reply cannot reorder output.
    if (this.ready) this.options.emit(frame);
    else this.queue(frame);
  }

  private stoppedFallback: NodeJS.Timeout | null = null;

  private scheduleStoppedFallback(): void {
    if (this.stoppedFallback) clearTimeout(this.stoppedFallback);
    this.stoppedFallback = setTimeout(() => {
      this.stoppedFallback = null;
      if (this.stoppedThisTurn && !this.closed) this.finishTurn();
    }, 2500);
    this.stoppedFallback.unref?.();
  }

  private finishTurn(completedTurnId?: number): void {
    if (this.stoppedFallback) {
      clearTimeout(this.stoppedFallback);
      this.stoppedFallback = null;
    }
    const completed = completedTurnId ?? this.turnId;
    if (completed >= this.turnId) this.turnId = completed + 1;
    this.stoppedThisTurn = false;
    this.tools.clear();
    this.currentToolCallId = null;
    this.emitStatus();
  }

  /**
   * Promote acked messages only after the daemon shows processing. This is the
   * first correlated evidence that the prompt was ingested, not just received.
   */
  private promoteAcked(): void {
    for (const [requestId, pending] of [...this.pending]) {
      if (pending.status !== 'acked') continue;
      this.pending.delete(requestId);
      const turnId = pending.turnId ?? this.turnId;
      const accepted = {
        ev: 'message_accepted',
        ...this.identity(),
        client_message_id: pending.clientMessageId,
        turn_id: turnId,
      };
      this.options.onAccepted?.(pending.clientMessageId);
      if (this.ready) this.options.emit(accepted);
      else this.queue(accepted);
    }
  }

  private onHistory(event: Record<string, unknown>): void {
    const replyId = typeof event.id === 'number' ? event.id : -1;
    const catalogWaiter = this.catalogWaiters.get(replyId);
    if (catalogWaiter) {
      // `get_model_catalog` is answered with a request-id-bearing history
      // event with zero messages. Route it by id so it can never enter the
      // transcript bootstrap path or leave the caller waiting (CFG-1).
      this.catalogWaiters.delete(replyId);
      clearTimeout(catalogWaiter.timer);
      if (typeof event.provider_name === 'string') this.providerName = event.provider_name;
      if (typeof event.provider_model === 'string') this.modelName = event.provider_model;
      if (Array.isArray(event.available_models)) {
        this.modelsList = event.available_models.filter(
          (value): value is string => typeof value === 'string',
        );
      }
      this.parseModelRoutes(event.available_model_routes);
      catalogWaiter.resolve({
        models: this.modelsList,
        current: this.modelName,
      });
      this.emitConfig();
      return;
    }
    if (typeof event.server_version === 'string' && event.server_version) {
      this.daemonVersion = event.server_version;
    }
    if (typeof event.provider_name === 'string') this.providerName = event.provider_name;
    if (typeof event.provider_model === 'string') this.modelName = event.provider_model;
    if (typeof event.reasoning_effort === 'string' || event.reasoning_effort === null) {
      this.currentEffort =
        typeof event.reasoning_effort === 'string' ? event.reasoning_effort : null;
    }
    if (Array.isArray(event.available_models)) {
      this.modelsList = event.available_models.filter(
        (value): value is string => typeof value === 'string',
      );
    }
    this.parseModelRoutes(event.available_model_routes);
    // Every full history reply is authoritative for the image set. An empty
    // array means "no images"; keeping the previous set made deleted images
    // survive reconciliation (HIST-2).
    const imageBudget = Math.max(
      0,
      Math.floor((this.frameBudget() - HISTORY_FRAME_RESERVE) * HISTORY_IMAGE_SHARE),
    );
    const bounded: Array<Record<string, unknown>> = [];
    let bytes = 0;
    let omitted = 0;
    const sourceImages = Array.isArray(event.images) ? event.images : [];
    for (const image of sourceImages) {
      if (!image || typeof image !== 'object') {
        omitted += 1;
        continue;
      }
      const record = image as Record<string, unknown>;
      const mediaType = typeof record.media_type === 'string' ? record.media_type : '';
      const data = typeof record.data === 'string' ? record.data : '';
      if (!mediaType || !data) {
        omitted += 1;
        continue;
      }
      const size = Buffer.byteLength(data, 'utf8');
      // Oversize media is omitted with an explicit count instead of producing
      // a frame the phone must discard wholesale (HIST-1).
      if (bytes + size > imageBudget) {
        omitted += 1;
        continue;
      }
      bytes += size;
      bounded.push({
        media_type: mediaType,
        data,
        label: typeof record.label === 'string' ? record.label : null,
        alt: typeof record.alt === 'string' ? record.alt : null,
        source:
          record.source && typeof record.source === 'object'
            ? (record.source as Record<string, unknown>).kind ?? 'tool_result'
            : 'tool_result',
        ...(record.anchor && typeof record.anchor === 'object'
          ? { anchor: record.anchor }
          : null),
        ...(typeof record.history_message_index === 'number'
          ? { history_message_index: record.history_message_index }
          : null),
      });
    }
    this.historyImages = bounded;
    this.historyImageBytes = bytes;
    this.historyImagesOmitted = omitted;
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const parsed = messages
      .map((message, index) => {
        if (!message || typeof message !== 'object') return null;
        const record = message as Record<string, unknown>;
        const role = typeof record.role === 'string' ? record.role : '';
        const content = typeof record.content === 'string' ? record.content : '';
        if (!role) return null;
        const split = role === 'assistant' ? splitReasoningMarkup(content) : null;
        const toolCalls = Array.isArray(record.tool_calls)
          ? record.tool_calls.filter((value): value is string => typeof value === 'string')
          : undefined;
        const toolData =
          record.tool_data && typeof record.tool_data === 'object'
            ? (record.tool_data as Record<string, unknown>)
            : null;
        const toolId = toolData && typeof toolData.id === 'string' ? toolData.id : null;
        const toolName = toolData && typeof toolData.name === 'string' ? toolData.name : null;
        const boundedInput = toolData ? truncate(JSON.stringify(toolData.input ?? null), 8192) : null;
        return {
          index,
          role,
          content: split?.content ?? content,
          ...(split?.reasoning ? { reasoning: split.reasoning } : null),
          ...(toolCalls && toolCalls.length ? { tool_calls: toolCalls.slice(0, 20) } : null),
          ...(toolId && toolName
            ? {
                tool_data: {
                  id: toolId,
                  name: toolName,
                  ...(boundedInput ? { input: safeParse(boundedInput.text) } : null),
                  ...(typeof toolData?.intent === 'string' ? { intent: toolData.intent } : null),
                },
              }
            : null),
          ...(record.response_stats ? { response_stats: record.response_stats } : null),
        };
      })
      .filter((message): message is NonNullable<typeof message> => message !== null);

    const total = parsed.length;
    // Some daemon paths emit an empty history frame after the authoritative
    // one while an attachment is still settling. Never let that erase a
    // transcript the server already delivered.
    if (total === 0) {
      if (this.history.length > 0) {
        this.historyReceived = true;
        if (this.ready) this.emitHistory();
        return;
      }
      if (!this.emptyHistorySeen) {
        // Attach can observe a transient empty history before the daemon has
        // loaded the persisted transcript. Ask once more instead of publishing
        // an empty authoritative window that hides readable history.
        this.emptyHistorySeen = true;
        this.historyReceived = true;
        if (this.ready) this.emitHistory();
        setTimeout(() => {
          if (!this.closed && this.history.length === 0) this.requestHistory();
        }, 300).unref?.();
        return;
      }
    }
    if (total > 0) this.emptyHistorySeen = false;
    const keep = Math.min(total, this.options.config.maxHistoryMessages);
    this.historyOffset = total - keep;
    // Parsed indexes are already absolute. Do not add the offset twice.
    this.history = parsed.slice(this.historyOffset);
    this.historyTotal = total;
    if (!this.tokenUsage) {
      // The daemon's in-memory last_usage is empty after a reload. Stored turn
      // response stats still carry the last prompt size, which is a real
      // observation from this session, so surface it as last-known.
      for (let index = parsed.length - 1; index >= 0; index -= 1) {
        const stats = parsed[index].response_stats;
        if (!stats || typeof stats !== 'object') continue;
        const record = stats as Record<string, unknown>;
        const input = typeof record.input_tokens === 'number' ? record.input_tokens : null;
        if (input === null || input <= 0) continue;
        this.tokenUsage = {
          input,
          output: typeof record.output_tokens === 'number' ? record.output_tokens : 0,
          cacheRead: 0,
          cacheCreate: 0,
          at: Date.now(),
          model: this.modelName,
          fromCache: true,
        };
        break;
      }
    }
    this.lastHistoryFlags = {
      interrupted: event.was_interrupted === true,
      recovery: parseRecovery(event.reload_recovery),
    };
    if (event.activity && typeof event.activity === 'object') {
      const activity = event.activity as Record<string, unknown>;
      if (typeof activity.is_processing === 'boolean') {
        this.status = activity.is_processing ? 'working' : 'ready';
      }
    }
    this.historyReceived = true;
    if (this.ready) {
      this.emitHistory();
    }
  }

  private requestHistory(): void {
    const id = this.nextId();
    this.connection.send({ type: 'get_history', id });
  }

  /** Slice of retained committed history before an index. */
  getHistoryBefore(beforeIndex: number, limit: number): Record<string, unknown> {
    const start = Math.max(0, this.historyOffset);
    const endAbsolute = Math.min(beforeIndex, this.historyOffset + this.history.length);
    const startAbsolute = Math.max(start, endAbsolute - limit);
    const page = this.history.slice(startAbsolute - this.historyOffset, endAbsolute - this.historyOffset);
    const bounded = this.boundHistory(page, startAbsolute);
    // With a zero-row page at the retention floor, reporting has_older made
    // "Load older" loop forever (HIST-3).
    const hasOlder = bounded.messages.length > 0 && bounded.baseIndex > 0;
    return {
      ev: 'history',
      session_id: this.sessionId,
      attachment_id: this.attachmentId,
      messages: bounded.messages,
      base_index: bounded.baseIndex,
      total_messages: this.historyTotal,
      tail_fingerprint: tailFingerprint(this.history),
      accepted_client_ids: this.options.acceptedClientIds?.() ?? [],
      has_older: hasOlder,
      ...(this.historyImages.length
        ? {
            images: this.historyImages.filter((image) => {
              const boundary = image.history_message_index;
              if (typeof boundary !== 'number') return true;
              const target = boundary - 1;
              return target >= bounded.baseIndex && target < endAbsolute;
            }),
          }
        : null),
      ...(this.historyImagesOmitted ? { images_omitted: this.historyImagesOmitted } : null),
    };
  }

  sendMessage(
    content: string,
    clientMessageId: string,
    images: Array<[string, string]> = [],
  ): { accepted: boolean } {
    if (!this.connection.isOpen) return { accepted: false };
    const id = this.nextId();
    this.pending.set(id, { clientMessageId, sentAt: Date.now(), status: 'pending' });
    this.connection.send({
      type: 'message',
      id,
      content,
      ...(images.length ? { images } : null),
    });
    if (this.options.config.faultAfterSend) {
      // Deterministic A05 harness: drop the attachment after the prompt is
      // written but before the daemon ack can be delivered to the phone.
      setTimeout(() => this.connection.close(), 0);
    }
    return { accepted: true };
  }

  softInterrupt(
    content: string,
    clientId: string,
    images: Array<[string, string]> = [],
  ): void {
    if (!this.connection.isOpen) return;
    const id = this.nextId();
    this.trackControl(id);
    this.connection.send({
      type: 'soft_interrupt',
      id,
      content,
      client_id: clientId,
      ...(images.length ? { images } : null),
    });
  }

  cancelSoftInterrupts(clientIds: string[]): void {
    if (!this.connection.isOpen) return;
    const id = this.nextId();
    this.trackControl(id);
    this.connection.send({
      type: 'cancel_soft_interrupts',
      id,
      client_ids: clientIds,
    });
  }

  /** Re-emit the current bounded history window from cache. */
  resendHistory(): void {
    this.emitHistory();
  }

  /** Ask the daemon for authoritative history now. */
  refreshHistory(): void {
    if (!this.connection.isOpen) return;
    this.requestHistory();
  }

  cancel(): void {
    if (!this.connection.isOpen) return;
    const id = this.nextId();
    this.trackControl(id);
    this.connection.send({ type: 'cancel', id });
  }

  rename(title: string | null): Promise<{ title: string | null; displayTitle: string }> {
    if (!this.connection.isOpen) {
      return Promise.reject(new Error('The session connection is not open.'));
    }
    if (this.renameWaiter || this.orphanedRename) {
      return Promise.reject(
        new Error('A rename is still pending at the server; wait for it to reconcile.'),
      );
    }
    const id = this.nextId();
    const expectedTitle = title && title.length > 0 ? title : null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.renameWaiter?.id !== id) return;
        this.renameWaiter = null;
        // The daemon may still process this request. Keep its identity so a
        // late session_renamed cannot be mistaken for a newer rename.
        this.orphanedRename = { id, expectedTitle };
        reject(new Error('The server did not confirm the rename.'));
      }, this.options.config.renameTimeoutMs);
      this.renameWaiter = { id, timer, settled: false, expectedTitle, resolve, reject };
      try {
        this.connection.send({
          type: 'rename_session',
          id,
          ...(title ? { title } : null),
        });
      } catch (error) {
        clearTimeout(timer);
        this.renameWaiter = null;
        reject(error as Error);
      }
    });
  }

  setSaved(saved: boolean, label?: string | null): void {
    if (!this.connection.isOpen) return;
    const id = this.nextId();
    this.trackControl(id);
    this.connection.send({
      type: 'set_session_saved',
      id,
      saved,
      ...(label ? { label } : null),
    });
  }

  models(): Promise<{
    models: string[];
    current: string | null;
    efforts: string[];
    currentEffort: string | null;
    effortsByModel: Record<string, string[]>;
    routes: Array<{ model: string; provider: string; available: boolean }>;
  }> {
    return new Promise((resolve) => {
      const snapshot = () => ({
        models: this.modelsList,
        current: this.modelName,
        efforts: inferredEfforts(this.providerName, this.modelName),
        currentEffort: this.currentEffort,
        effortsByModel: effortLadders(this.providerName, this.modelsList),
        routes: this.modelRoutes,
      });
      if (!this.connection.isOpen) {
        resolve(snapshot());
        return;
      }
      const id = this.nextId();
      if (this.modelsList.length > 0) {
        // Paint from the known catalog, then refresh in the background. A slow
        // daemon reply must not turn a populated picker into "No models".
        const timer = setTimeout(() => this.catalogWaiters.delete(id), 4000);
        timer.unref?.();
        this.catalogWaiters.set(id, { timer, resolve: () => undefined });
        try {
          this.connection.send({ type: 'get_model_catalog', id, subscribe_usage_updates: false });
        } catch {
          this.catalogWaiters.delete(id);
          clearTimeout(timer);
        }
        resolve(snapshot());
        return;
      }
      // A catalog reply is a request-id-bearing history event. Keep one waiter
      // per request so overlapping pickers cannot steal each other's reply.
      const timer = setTimeout(() => {
        this.catalogWaiters.delete(id);
        resolve(snapshot());
      }, 4000);
      this.catalogWaiters.set(id, {
        timer,
        resolve: () => {
          resolve(snapshot());
        },
      });
      this.connection.send({ type: 'get_model_catalog', id, subscribe_usage_updates: false });
    });
  }

  setModel(model: string): Promise<{
    model: string | null;
    effort: string | null;
    contextWindow: number | null;
    error?: string;
  }> {
    return new Promise((resolve) => {
      if (!this.connection.isOpen) {
        resolve({ model: null, effort: null, contextWindow: null, error: 'The session connection is not open.' });
        return;
      }
      const id = this.nextId();
      const timer = setTimeout(() => {
        this.configWaiters.delete(id);
        resolve({
          model: this.modelName,
          effort: this.currentEffort,
          contextWindow: this.contextWindow,
          error: 'The server did not confirm the model change.',
        });
      }, 12_000);
      this.configWaiters.set(id, {
        kind: 'model',
        timer,
        resolve: (value) => {
          resolve({
            model: value.model ?? this.modelName,
            effort: value.effort ?? this.currentEffort,
            contextWindow: value.contextWindow ?? this.contextWindow,
            ...(value.error ? { error: value.error } : null),
          });
        },
      });
      this.trackControl(id);
      this.connection.send({ type: 'set_model', id, model });
    });
  }

  setEffort(effort: string | null): Promise<{ effort: string | null; error?: string }> {
    return new Promise((resolve) => {
      if (!effort) {
        resolve({ effort: this.currentEffort });
        return;
      }
      if (!this.connection.isOpen) {
        resolve({ effort: this.currentEffort, error: 'The session connection is not open.' });
        return;
      }
      const id = this.nextId();
      const timer = setTimeout(() => {
        this.configWaiters.delete(id);
        resolve({
          effort: this.currentEffort,
          error: 'The server did not confirm the effort change.',
        });
      }, 12_000);
      this.configWaiters.set(id, {
        kind: 'effort',
        timer,
        resolve: (value) => {
          resolve({
            effort: value.effort ?? this.currentEffort,
            ...(value.error ? { error: value.error } : null),
          });
        },
      });
      this.trackControl(id);
      this.connection.send({
        type: 'set_reasoning_effort',
        id,
        ...(effort ? { effort } : null),
      });
    });
  }

  contextSnapshot(): Record<string, unknown> {
    const usage = this.tokenUsage;
    const used = usage
      ? usage.input + usage.cacheRead + usage.cacheCreate
      : null;
    return {
      ev: 'context_snapshot',
      ...this.identity(),
      used_tokens: used,
      limit_tokens: this.contextWindow,
      basis: usage ? 'last_request' : 'unknown',
      model: usage?.model ?? this.modelName,
      observed_at_ms: usage?.at ?? Date.now(),
      cached: usage?.fromCache === true,
    };
  }

  /**
   * Authoritative runtime snapshot path (CFG-2). The harness bridge reports
   * the resolved model limit and last request usage even before any live
   * `tokens` frame, which is what a reattached or freshly created session
   * needs. Unknown values stay null.
   */
  applyRuntimeContext(input: {
    model?: string | null;
    providerName?: string | null;
    effort?: string | null;
    contextWindow?: number | null;
    usedTokens?: number | null;
    observedAtMs?: number | null;
  }): void {
    if (typeof input.providerName === 'string') this.providerName = input.providerName;
    if (typeof input.model === 'string' && input.model) {
      if (this.modelName !== input.model) this.tokenUsage = null;
      this.modelName = input.model;
    }
    if (input.effort !== undefined) this.currentEffort = input.effort;
    if (input.contextWindow !== undefined) this.contextWindow = input.contextWindow;
    if (typeof input.usedTokens === 'number') {
      this.tokenUsage = {
        input: input.usedTokens,
        output: 0,
        cacheRead: 0,
        cacheCreate: 0,
        at: input.observedAtMs ?? Date.now(),
        model: this.modelName,
        fromCache: false,
      };
    }
    this.rememberContext();
    this.emitConfig();
    this.emitContextSnapshot();
  }

  /**
   * Ask the attached daemon for its authoritative runtime snapshot. This is
   * the raw `runtime_command: info` path, not a guessed limit (CFG-2). Older
   * daemons reply with an error; the waiter resolves so callers stay bounded.
   */
  refreshRuntimeContext(timeoutMs = 4000): Promise<void> {
    if (!this.connection.isOpen) return Promise.resolve();
    const id = this.nextId();
    this.trackControl(id);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.runtimeWaiters.delete(id);
        resolve();
      }, timeoutMs);
      this.runtimeWaiters.set(id, { resolve, timer });
      try {
        this.connection.send({ type: 'runtime_command', id, command: 'info', args: [] });
      } catch {
        this.runtimeWaiters.delete(id);
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private applyRuntimeCommandData(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const record = data as Record<string, unknown>;
    const usage = record.last_usage && typeof record.last_usage === 'object'
      ? (record.last_usage as Record<string, unknown>)
      : null;
    const input = numberField(usage, ['input', 'input_tokens', 'prompt_tokens']);
    const cacheRead = numberField(usage, ['cache_read_input', 'cache_read_input_tokens']);
    const cacheCreate = numberField(usage, [
      'cache_creation_input',
      'cache_creation_input_tokens',
    ]);
    // `last_usage()` is a non-optional default struct. A freshly reloaded
    // agent reports all zeros, which means "no request observed", not 0%.
    const observed =
      (input ?? 0) + (cacheRead ?? 0) + (cacheCreate ?? 0);
    const used = input !== null && observed > 0 ? observed : null;
    this.applyRuntimeContext({
      model: typeof record.model === 'string' ? record.model : undefined,
      providerName: typeof record.provider === 'string' ? record.provider : undefined,
      effort:
        typeof record.reasoning_effort === 'string'
          ? record.reasoning_effort
          : record.reasoning_effort === null
            ? null
            : undefined,
      contextWindow: typeof record.context_window === 'number' ? record.context_window : undefined,
      usedTokens: used,
      observedAtMs: Date.now(),
    });
  }

  private rememberContext(): void {
    if (!this.sessionId || !this.options.contextCache) return;
    const usage = this.tokenUsage;
    if (!usage || usage.fromCache) return;
    this.options.contextCache.remember(this.sessionId, {
      model: usage.model,
      contextWindow: this.contextWindow,
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheCreate: usage.cacheCreate,
      at: usage.at,
    });
  }

  private parseModelRoutes(value: unknown): void {
    if (!Array.isArray(value)) return;
    const routes: Array<{ model: string; provider: string; available: boolean }> = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const model = typeof record.model === 'string' ? record.model : '';
      const provider = typeof record.provider === 'string' ? record.provider : '';
      if (!model || !provider) continue;
      routes.push({ model, provider, available: record.available !== false });
    }
    if (!routes.length) return;
    this.modelRoutes = routes;
    if (!this.modelsList.length) {
      this.modelsList = [
        ...new Set(routes.filter((route) => route.available).map((route) => route.model)),
      ];
    }
  }

  private emitContextSnapshot(): void {
    if (!this.ready) return;
    this.options.emit(this.contextSnapshot());
  }

  private emitConfig(): void {
    if (!this.ready) return;
    this.options.emit({
      ev: 'session_config',
      session_id: this.sessionId,
      model: this.modelName,
      effort: this.currentEffort,
      efforts: inferredEfforts(this.providerName, this.modelName),
      confirmed: true,
      source: 'server',
    });
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.configWaiters.values()) clearTimeout(waiter.timer);
    this.configWaiters.clear();
    for (const waiter of this.catalogWaiters.values()) clearTimeout(waiter.timer);
    this.catalogWaiters.clear();
    for (const waiter of this.runtimeWaiters.values()) clearTimeout(waiter.timer);
    this.runtimeWaiters.clear();
    // Closing the transport is not cancellation: the daemon keeps the turn
    // because the subscribe opted into continuation.
    this.connection.close();
  }

  private closeConnection(): void {
    this.dispose();
    this.options.onClosed?.();
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function numberField(
  record: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * JCode persists provider reasoning as `*\u2063line\u2063*` emphasis runs. The
 * mobile UI styles reasoning itself, so recover the text and keep it out of
 * normal prose, Copy and Hidden surfaces.
 */
export function splitReasoningMarkup(content: string): {
  content: string;
  reasoning: string;
} {
  const marker = /^\*\u2063([\s\S]*)\u2063\*\s*$/;
  let found = false;
  const kept: string[] = [];
  const reasoning: string[] = [];
  for (const line of content.split('\n')) {
    const match = marker.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }
    found = true;
    reasoning.push(
      match[1].replace(/\\([*_`\[\]<>&~|$])/g, (_whole, char: string) => char),
    );
  }
  if (!found) {
    // No reasoning wrapper: return the exact source bytes. Trimming and
    // collapsing blank lines here corrupted legitimate Markdown (TXT-2).
    return { content, reasoning: '' };
  }
  // Drop only the blank lines the reasoning block itself contributed before
  // the answer; internal spacing after that is preserved verbatim.
  let start = 0;
  while (start < kept.length && kept[start].trim() === '') start += 1;
  return {
    content: kept.slice(start).join('\n'),
    reasoning: reasoning.join('\n').trim(),
  };
}

function parseToolInput(raw: string): unknown {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { unparsed: truncate(raw, 4096).text };
  }
}

function parseRecovery(value: unknown): { continuation_message: string; reconnect_notice?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.continuation_message !== 'string') return undefined;
  const bounded = truncate(record.continuation_message, MAX_RECOVERY_MESSAGE_BYTES);
  return {
    continuation_message: bounded.text,
    ...(typeof record.reconnect_notice === 'string'
      ? { reconnect_notice: record.reconnect_notice }
      : null),
  };
}
