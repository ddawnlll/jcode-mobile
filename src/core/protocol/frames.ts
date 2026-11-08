/**
 * Mobile adapter protocol v1.
 *
 * Envelope and vocabulary follow JCode's curated harness API
 * (`crates/jcode-harness-api`, API v1.11 at tag v0.99.1): every frame is one
 * JSON object, `{v, id, req}` client-to-server and `{v, reply_to?, ev}`
 * server-to-client. Streaming events omit `reply_to`.
 *
 * The mobile adapter adds a small, explicit set of fields (attachment_id,
 * turn_id, history indexes) required for identity fencing and bounded
 * reconciliation. They are additive and documented in
 * docs/ADAPTER_CONTRACT.md.
 */

export const PROTOCOL_VERSION = 1;

export interface ClientFrame {
  v: number;
  id: number;
  req: string;
  [key: string]: unknown;
}

export type ErrorCode =
  | 'unsupported_version'
  | 'unknown_request'
  | 'unknown_session'
  | 'invalid_request'
  | 'internal'
  | 'unauthorized'
  | 'unsupported_capability'
  | 'daemon_unavailable';

export interface SessionInfo {
  session_id: string;
  title?: string | null;
  working_dir?: string | null;
  status?: string;
  saved?: boolean;
  save_label?: string | null;
  updated_at_ms?: number | null;
  last_active_at_ms?: number | null;
  archived?: boolean;
  archived_at_ms?: number | null;
  transcript_bytes?: number | null;
  user_connected?: boolean;
  /** Adapter observation: only set when a live mobile attachment proves it. */
  live_state?: 'working' | 'ready';
}

export interface HistoryMessage {
  /** Stable zero-based position in the persisted transcript. */
  index: number;
  role: 'user' | 'assistant' | 'tool' | string;
  content: string;
  /** Present when the daemon reports a completed stored turn. */
  response_stats?: {
    duration_secs?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface TodoItem {
  id: string;
  content: string;
  status: string;
  priority?: string;
  group?: string | null;
  blocked_by?: string[];
}

export interface TodoSnapshot {
  todos: TodoItem[];
  plan?: { user_intention?: string | null };
  goals?: unknown[];
}

export interface ToolActivity {
  call_id: string;
  name: string;
  /** Parsed tool input when available, bounded by the adapter. */
  input?: unknown;
  output?: string;
  error?: string | null;
  started_at_ms?: number;
  completed_at_ms?: number;
}

export interface ServerCapabilities {
  /** Every session attachment sets continue_on_disconnect: true. */
  mobile_continuation: boolean;
  /** Bounded recent-history windows with base index and tail fingerprint. */
  bounded_history: boolean;
  /** Per-attachment/turn identity on streaming events. */
  identity_fencing: boolean;
  /** Agent-level MessageAccepted correlated to a client message id. */
  delivery_receipts: boolean;
  /** Soft interrupt caller ids echoed on injection. */
  soft_interrupt_ids: boolean;
  /** Server-published todo/plan state. */
  todo_state: boolean;
  /** Read-only bounded current-file reads. */
  file_read: boolean;
  /** Archive and restore. */
  archive_restore: boolean;
  /** Model catalog for a session. */
  models: boolean;
  /** No permissions capability is advertised: the bridge does not implement one. */
  permissions: false;
  /** No push capability is advertised. */
  push: false;
}

export const CAPABILITY_NAMES = [
  'mobile_continuation',
  'bounded_history',
  'identity_fencing',
  'delivery_receipts',
  'soft_interrupt_ids',
  'todo_state',
  'file_read',
  'archive_restore',
  'models',
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/* ------------------------------------------------------------------ events */

export type ServerEvent =
  | { ev: 'hello_ok'; version: number; server: string; capabilities: string[]; daemon_version?: string; server_name?: string }
  | { ev: 'ok' }
  | { ev: 'error'; code: ErrorCode; message: string; detail?: string }
  | { ev: 'sessions'; sessions: SessionInfo[]; partial: boolean }
  | {
      ev: 'attached';
      session: SessionInfo;
      attachment_id: string;
      capabilities: string[];
      /** True only when the adapter actually set continue_on_disconnect. */
      continuation: boolean;
    }
  | {
      ev: 'history';
      session_id: string;
      attachment_id: string;
      messages: HistoryMessage[];
      /** Position of messages[0] in the persisted transcript. */
      base_index: number;
      total_messages: number;
      /** Hash of the last committed messages; reconciliation base. */
      tail_fingerprint: string;
      /** Client message ids the agent accepted, retained by the adapter. */
      accepted_client_ids: string[];
      /** True when the persisted session was interrupted mid-generation. */
      interrupted_at_attach?: boolean;
      /** Server-owned recovery intent, when the daemon reports one. */
      recovery?: { continuation_message: string; reconnect_notice?: string };
    }
  | { ev: 'text_delta'; session_id: string; attachment_id: string; turn_id: number; text: string }
  | { ev: 'text_replace'; session_id: string; attachment_id: string; turn_id: number; text: string }
  | {
      ev: 'text_suffix_replace';
      session_id: string;
      attachment_id: string;
      turn_id: number;
      old_text: string;
      new_text: string;
    }
  | { ev: 'reasoning_delta'; session_id: string; attachment_id: string; turn_id: number; text: string }
  | { ev: 'reasoning_done'; session_id: string; attachment_id: string; turn_id: number }
  | { ev: 'text_done'; session_id: string; attachment_id: string; turn_id: number }
  | { ev: 'message_accepted'; session_id: string; attachment_id: string; client_message_id: string; turn_id: number }
  | {
      ev: 'send_rejected';
      session_id: string;
      attachment_id: string;
      client_message_id: string;
      message: string;
    }
  | { ev: 'peer_user_message'; session_id: string; attachment_id: string; content: string }
  | { ev: 'session_closed'; session_id: string; attachment_id: string; reason: string }
  | { ev: 'tool_start'; session_id: string; attachment_id: string; turn_id: number; call_id: string; name: string }
  | {
      ev: 'tool_exec';
      session_id: string;
      attachment_id: string;
      turn_id: number;
      call_id: string;
      name: string;
      input?: unknown;
    }
  | {
      ev: 'tool_done';
      session_id: string;
      attachment_id: string;
      turn_id: number;
      call_id: string;
      name: string;
      output?: string;
      error?: string | null;
      truncated?: boolean;
    }
  | {
      ev: 'turn_stopped';
      session_id: string;
      attachment_id: string;
      turn_id: number;
      reason: string;
      message: string;
    }
  | { ev: 'turn_done'; session_id: string; attachment_id: string; turn_id: number; pending_soft_interrupts?: number }
  | { ev: 'session_status'; session_id: string; attachment_id: string; status: string; pending_soft_interrupts?: number }
  | { ev: 'connection_phase'; session_id: string; attachment_id: string; phase: string }
  | {
      ev: 'soft_interrupt_injected';
      session_id: string;
      attachment_id: string;
      client_ids: string[];
      point: string;
    }
  | { ev: 'soft_interrupts_cancelled'; cancelled: string[]; not_queued: string[] }
  | { ev: 'session_renamed'; session_id: string; title?: string | null; display_title: string }
  | {
      ev: 'todo_state';
      session_id: string;
      state: TodoSnapshot;
      observed_at_ms: number;
    }
  | { ev: 'models'; session_id: string; models: string[]; current?: string | null }
  | {
      ev: 'server_info';
      server: string;
      daemon_version?: string;
      continuation: boolean;
      capabilities: string[];
      observed_at_ms: number;
    }
  | {
      ev: 'file_content';
      session_id: string;
      path: string;
      content: string;
      size: number;
      truncated: boolean;
    }
  | { ev: 'unknown'; kind?: string };

/* --------------------------------------------------------------- requests */

export type ClientRequest =
  | { req: 'hello'; min_version: number; max_version: number; client: string }
  | { req: 'list_sessions'; include_archived?: boolean; limit?: number }
  | { req: 'attach_session'; session_id: string }
  | { req: 'detach_session'; session_id: string }
  | { req: 'create_session'; working_dir: string; client_request_id: string }
  | { req: 'get_history'; session_id: string; limit?: number }
  | { req: 'get_history_before'; session_id: string; before_index: number; limit?: number }
  | { req: 'send_message'; session_id: string; content: string; client_message_id: string }
  | { req: 'soft_interrupt'; session_id: string; content: string; client_id: string }
  | { req: 'cancel_soft_interrupts'; session_id: string; client_ids: string[] }
  | { req: 'cancel'; session_id: string }
  | { req: 'archive_session'; session_id: string }
  | { req: 'restore_session'; session_id: string }
  | { req: 'rename_session'; session_id: string; title?: string | null }
  | { req: 'set_session_saved'; session_id: string; saved: boolean; label?: string | null }
  | { req: 'get_todo_state'; session_id: string }
  | { req: 'list_models'; session_id: string }
  | { req: 'set_model'; session_id: string; model: string }
  | { req: 'read_file'; session_id: string; path: string; max_bytes?: number }
  | { req: 'get_server_info' }
  | { req: 'ping' };

export type ClientRequestName = ClientRequest['req'];

export function isKnownRequest(name: string): name is ClientRequestName {
  return KNOWN_REQUESTS.has(name as ClientRequestName);
}

const KNOWN_REQUESTS = new Set<ClientRequestName>([
  'hello',
  'list_sessions',
  'attach_session',
  'detach_session',
  'create_session',
  'get_history',
  'get_history_before',
  'send_message',
  'soft_interrupt',
  'cancel_soft_interrupts',
  'cancel',
  'archive_session',
  'restore_session',
  'rename_session',
  'set_session_saved',
  'get_todo_state',
  'list_models',
  'set_model',
  'read_file',
  'get_server_info',
  'ping',
]);
