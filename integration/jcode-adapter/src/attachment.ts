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

export type Emit = (frame: Record<string, unknown>) => void;

export interface AttachmentOptions {
  config: AdapterConfig;
  replyTo: number;
  emit: Emit;
  sessionId?: string;
  workingDir?: string;
  lookupSession?: (sessionId: string) => Record<string, unknown> | undefined;
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

  private emit(frame: Record<string, unknown>, replyTo?: number): void {
    this.options.emit(replyTo !== undefined ? { ...frame, reply_to: replyTo } : frame);
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

  async start(): Promise<void> {
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
        capabilities: ['mobile_continuation', 'bounded_history', 'identity_fencing', 'delivery_receipts', 'soft_interrupt_ids', 'todo_state', 'file_read', 'archive_restore', 'models'],
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
    this.flushPreHistory();
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
      ...(interrupted ? { interrupted_at_attach: true } : null),
      ...(recovery ? { recovery } : null),
    });
  }

  /** Enforce an outgoing UTF-8 budget, independent of message count. */
  private boundHistory(
    messages: Array<{ index: number; role: string; content: string; response_stats?: unknown }>,
    baseIndex: number,
  ): { messages: typeof messages; baseIndex: number } {
    const budget = this.options.config.maxHistoryBytes;
    let bytes = 0;
    let start = messages.length;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = { ...messages[index] };
      const limited = truncate(message.content, MAX_HISTORY_MESSAGE_BYTES);
      message.content = limited.truncated ? `${limited.text}\n[truncated by adapter]` : limited.text;
      const size = Buffer.byteLength(JSON.stringify(message), 'utf8') + 1;
      if (start < messages.length && bytes + size > budget) break;
      bytes += size;
      start = index;
    }
    return { messages: messages.slice(start), baseIndex: baseIndex + start };
  }

  private lastHistoryFlags: {
    interrupted: boolean;
    recovery?: { continuation_message: string; reconnect_notice?: string };
  } = { interrupted: false };

  /** Number of messages dropped from the front of the retained window. */
  private historyOffset = 0;

  private flushPreHistory(): void {
    if (!this.historyReceived) return;
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
        this.status = 'working';
        this.stoppedThisTurn = false;
        this.emitStatus();
        return;
      }
      case 'error': {
        const id = typeof event.id === 'number' ? event.id : -1;
        const message = typeof event.message === 'string' ? event.message : 'The server rejected the request.';
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
        this.push({ ev: 'reasoning_delta', ...this.identity(), turn_id: this.turnId, text });
        return;
      }
      case 'reasoning_done': {
        this.push({ ev: 'reasoning_done', ...this.identity(), turn_id: this.turnId });
        return;
      }
      case 'text_done': {
        this.push({ ev: 'text_done', ...this.identity(), turn_id: this.turnId });
        return;
      }
      case 'message_end': {
        this.push({ ev: 'text_done', ...this.identity(), turn_id: this.turnId });
        return;
      }
      case 'retry_rollback': {
        this.push({ ev: 'text_replace', ...this.identity(), turn_id: this.turnId, text: '' });
        this.push({ ev: 'reasoning_done', ...this.identity(), turn_id: this.turnId });
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
        const turnId = this.turnByRequest.get(id) ?? this.turnId;
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
        this.historyReceived = false;
        this.emitStatus();
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
      case 'available_models_updated': {
        if (this.handleAuxEvent(event)) return;
        return;
      }
      default:
        return;
    }
  }

  private push(frame: Record<string, unknown>): void {
    if (this.ready && this.historyReceived) this.options.emit(frame);
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
      if (this.ready && this.historyReceived) this.options.emit(accepted);
      else this.queue(accepted);
    }
  }

  private onHistory(event: Record<string, unknown>): void {
    if (typeof event.server_version === 'string' && event.server_version) {
      this.daemonVersion = event.server_version;
    }
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const parsed = messages
      .map((message, index) => {
        if (!message || typeof message !== 'object') return null;
        const record = message as Record<string, unknown>;
        const role = typeof record.role === 'string' ? record.role : '';
        const content = typeof record.content === 'string' ? record.content : '';
        if (!role) return null;
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
          content,
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
    const keep = Math.min(total, this.options.config.maxHistoryMessages);
    this.historyOffset = total - keep;
    // Parsed indexes are already absolute. Do not add the offset twice.
    this.history = parsed.slice(this.historyOffset);
    this.historyTotal = total;
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
      this.flushPreHistory();
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
    return {
      ev: 'history',
      session_id: this.sessionId,
      attachment_id: this.attachmentId,
      messages: bounded.messages,
      base_index: bounded.baseIndex,
      total_messages: this.historyTotal,
      tail_fingerprint: tailFingerprint(this.history),
      accepted_client_ids: this.options.acceptedClientIds?.() ?? [],
      has_older: bounded.baseIndex > 0,
    };
  }

  sendMessage(content: string, clientMessageId: string): { accepted: boolean } {
    if (!this.connection.isOpen) return { accepted: false };
    const id = this.nextId();
    this.pending.set(id, { clientMessageId, sentAt: Date.now(), status: 'pending' });
    this.connection.send({ type: 'message', id, content });
    if (this.options.config.faultAfterSend) {
      // Deterministic A05 harness: drop the attachment after the prompt is
      // written but before the daemon ack can be delivered to the phone.
      setTimeout(() => this.connection.close(), 0);
    }
    return { accepted: true };
  }

  softInterrupt(content: string, clientId: string): void {
    if (!this.connection.isOpen) return;
    this.connection.send({ type: 'soft_interrupt', id: this.nextId(), content, client_id: clientId });
  }

  cancelSoftInterrupts(clientIds: string[]): void {
    if (!this.connection.isOpen) return;
    this.connection.send({
      type: 'cancel_soft_interrupts',
      id: this.nextId(),
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
    this.connection.send({ type: 'cancel', id: this.nextId() });
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
    this.connection.send({
      type: 'set_session_saved',
      id: this.nextId(),
      saved,
      ...(label ? { label } : null),
    });
  }

  models(): Promise<{ models: string[]; current: string | null }> {
    return new Promise((resolve) => {
      if (!this.connection.isOpen) {
        resolve({ models: [], current: null });
        return;
      }
      const id = this.nextId();
      const timer = setTimeout(() => resolve({ models: [], current: null }), 4000);
      const previous = this.modelWaiter;
      this.modelWaiter = (models, current) => {
        clearTimeout(timer);
        this.modelWaiter = previous;
        resolve({ models, current });
      };
      this.connection.send({ type: 'get_model_catalog', id, subscribe_usage_updates: false });
    });
  }

  private modelWaiter: ((models: string[], current: string | null) => void) | null = null;

  setModel(model: string): void {
    if (!this.connection.isOpen) return;
    this.connection.send({ type: 'set_model', id: this.nextId(), model });
  }

  /** Handle the model catalog event that the generic switch ignores. */
  handleAuxEvent(event: Record<string, unknown>): boolean {
    if (event.type === 'available_models_updated' && this.modelWaiter) {
      const models = Array.isArray(event.available_models)
        ? event.available_models.filter((value): value is string => typeof value === 'string')
        : [];
      const current = typeof event.provider_model === 'string' ? event.provider_model : null;
      this.modelWaiter(models, current);
      return true;
    }
    return false;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
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
