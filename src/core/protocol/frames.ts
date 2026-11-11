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

export interface MessageImage {
  media_type: string;
  /** Base64 payload, without a data: prefix. */
  data: string;
  /** Local or remote URI when a prompt image is not carried as base64. */
  uri?: string;
  label?: string | null;
  alt?: string | null;
  source?: string;
  anchor?: { kind: string; ordinal?: number; id?: string } | null;
  /** Insert before this index in the accompanying history window. */
  history_message_index?: number;
}

export interface ModelRoute {
  model: string;
  provider: string;
  available: boolean;
}

export interface HistoryMessage {
  /** Stable zero-based position in the persisted transcript. */
  index: number;
  /** True when the preview was shortened by the adapter cap. */
  truncated?: boolean;
  role: 'user' | 'assistant' | 'tool' | string;
  content: string;
  /** Tool names called by this assistant turn, when the daemon reports them. */
  tool_calls?: string[];
  /** One structured tool call recorded with this assistant message. */
  tool_data?: { id: string; name: string; input?: unknown; intent?: string };
  /** Images attached to this prompt or produced by this turn. */
  images?: MessageImage[];
  /** Server-exposed reasoning recovered from the persisted markup. */
  reasoning?: string;
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
  /** Authenticated read-only server directory browsing. */
  directory_browse?: boolean;
  /** Create one folder inside a permitted server root. */
  directory_create?: boolean;
  /** Session model/effort configuration with correlated confirmation. */
  session_config?: boolean;
  /** Authoritative last-request context occupancy. */
  context_snapshot?: boolean;
  /** User-prompt image input forwarded to the daemon. */
  image_input?: boolean;
  /** Structured tool-reported file changes. */
  changes?: boolean;
  /** Bounded full-message chunk reads. */
  message_full_read?: boolean;
  /** Interactive tool is blocked waiting for input. */
  stdin_input?: boolean;
  /** Turn-safe Stop supported (atomic precondition at daemon). */
  turn_safe_stop?: boolean;
  /** Exact provider route selection (same model name via two providers). */
  exact_route?: boolean;
  /** Persisted empty session support. */
  persist_session?: boolean;
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
  'directory_browse',
  'directory_create',
  'session_config',
  'context_snapshot',
  'image_input',
  'changes',
  'message_full_read',
  'stdin_input',
  'turn_safe_stop',
  'exact_route',
  'persist_session',
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/* ------------------------------------------------------------------ events */

export type ServerEvent =
  | {
      ev: 'hello_ok';
      version: number;
      server: string;
      /** Exact adapter build, e.g. jcode-mobile-adapter/0.2.2. */
      adapter_version?: string;
      capabilities: string[];
      daemon_version?: string;
      server_name?: string;
    }
  | {
      ev: 'ok';
      session_id?: string;
      /** Custom title; null means the custom title was cleared. */
      title?: string | null;
      /** Derived title the server will display. */
      display_title?: string;
    }
  | { ev: 'error'; code: ErrorCode; message: string; detail?: string }
  | { ev: 'sessions'; sessions: SessionInfo[]; partial: boolean; cursor?: string | null; end?: boolean }
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
      has_older?: boolean;
      history_revision?: number;
      history_genesis?: string;
      /** Images anchored to this bounded history window. */
      images?: MessageImage[];
      /** Non-zero when the adapter withheld oversized media from this frame. */
      images_omitted?: number;
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
  | {
      ev: 'reasoning_done';
      session_id: string;
      attachment_id: string;
      turn_id: number;
      duration_secs?: number;
    }
  | { ev: 'text_done'; session_id: string; attachment_id: string; turn_id: number }
  | {
      ev: 'message_end';
      session_id: string;
      attachment_id: string;
      turn_id: number;
      stop_reason?: string;
    }
  | {
      ev: 'retry_rollback';
      session_id: string;
      attachment_id: string;
      turn_id: number;
      attempt: number;
      max: number;
    }
  | { ev: 'control_error'; session_id?: string; attachment_id?: string; message: string }
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
  | { ev: 'turn_done'; session_id: string; attachment_id: string; turn_id: number; pending_soft_interrupts?: number; stop_reason?: string }
  | { ev: 'stdin_request'; session_id: string; attachment_id: string; request_id: string; tool: string; prompt: string; is_password?: boolean }
  | { ev: 'stdin_response'; session_id: string; attachment_id: string; request_id: string; delivered: boolean; message?: string }
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
  | {
      ev: 'models';
      session_id: string;
      models: string[];
      current?: string | null;
      efforts?: string[];
      efforts_by_model?: Record<string, string[]>;
      routes?: ModelRoute[];
      current_effort?: string | null;
    }
  | {
      ev: 'context_snapshot';
      session_id: string;
      attachment_id: string;
      used_tokens: number | null;
      limit_tokens: number | null;
      basis: 'last_request' | 'current_prompt' | 'unknown';
      model: string | null;
      observed_at_ms: number;
      /** True when this is the adapter's last-known observation, not live. */
      cached?: boolean;
    }
  | {
      ev: 'session_config';
      session_id: string;
      model: string | null;
      effort: string | null;
      efforts: string[];
      efforts_by_model?: Record<string, string[]>;
      confirmed: boolean;
      source: string;
    }
  | {
      ev: 'directory';
      path: string;
      canonical_path: string;
      parent: string | null;
      entries: DirectoryEntry[];
      cursor: string | null;
      roots: string[];
      error?: string | null;
    }
  | { ev: 'image_ack'; session_id: string; client_message_id: string; accepted: boolean }
  | { ev: 'history_revision'; session_id: string; revision: number; total_messages: number; genesis: string }
  | { ev: 'message_chunk'; session_id: string; message_index: number; offset: number; text: string; total_bytes: number; done: boolean; revision?: number }
  | {
      ev: 'server_info';
      server: string;
      adapter_version?: string;
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

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  hidden?: boolean;
  readable?: boolean;
}

/* --------------------------------------------------------------- requests */

export type ClientRequest =
  | {
      req: 'hello';
      min_version: number;
      max_version: number;
      client: string;
      /** Largest JSON frame this client can decode; the adapter budgets to it. */
      max_frame_bytes?: number;
    }
  | { req: 'list_sessions'; include_archived?: boolean; limit?: number; cursor?: string }
  | { req: 'attach_session'; session_id: string }
  | { req: 'detach_session'; session_id: string }
  | { req: 'create_session'; working_dir: string; client_request_id: string }
  | { req: 'get_history'; session_id: string; limit?: number }
  | { req: 'get_history_before'; session_id: string; before_index: number; limit?: number }
  | {
      req: 'send_message';
      session_id: string;
      content: string;
      client_message_id: string;
      images?: Array<[string, string]>;
    }
  | {
      req: 'soft_interrupt';
      session_id: string;
      content: string;
      client_id: string;
      images?: Array<[string, string]>;
    }
  | { req: 'cancel_soft_interrupts'; session_id: string; client_ids: string[] }
  | { req: 'cancel'; session_id: string; turn_id?: number; attachment_id?: string; stop_request_id?: string }
  | { req: 'stdin_response'; session_id: string; request_id: string; value: string }
  | { req: 'get_full_message'; session_id: string; message_index: number; offset?: number; limit?: number; revision?: number }
  | { req: 'archive_session'; session_id: string }
  | { req: 'restore_session'; session_id: string }
  | { req: 'rename_session'; session_id: string; title?: string | null }
  | { req: 'set_session_saved'; session_id: string; saved: boolean; label?: string | null }
  | { req: 'get_todo_state'; session_id: string }
  | { req: 'list_models'; session_id: string }
  | { req: 'set_model'; session_id: string; model: string }
  | { req: 'set_effort'; session_id: string; effort: string | null }
  | { req: 'get_context_snapshot'; session_id: string }
  | { req: 'list_directories'; path: string; cursor?: string; limit?: number; show_hidden?: boolean }
  | { req: 'validate_directory'; path: string }
  | { req: 'create_directory'; path: string; name: string }
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
  'stdin_response',
  'get_full_message',
  'archive_session',
  'restore_session',
  'rename_session',
  'set_session_saved',
  'get_todo_state',
  'list_models',
  'set_model',
  'set_effort',
  'get_context_snapshot',
  'list_directories',
  'validate_directory',
  'create_directory',
  'read_file',
  'get_server_info',
  'ping',
]);
