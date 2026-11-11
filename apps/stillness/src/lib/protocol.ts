export const PROTOCOL_VERSION = 2;
export const WS_SUBPROTOCOL = 'jcode.mobile.v2';

export type Kind = 'request' | 'response' | 'event';

export interface Envelope<T = unknown> {
  v: number;
  kind: Kind;
  id: string;
  reply_to?: string;
  server_id?: string;
  session_id?: string;
  operation_id?: string;
  epoch?: string;
  seq?: number;
  type: string;
  payload: T;
}

export interface ErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ServerInfo {
  server_id: string;
  name: string;
  adapter_version: string;
  protocol_version: number;
  min_protocol_version: number;
  jcode_version: string;
  jcode_protocol_version: number;
  jcode_capabilities: string[];
  healthy: boolean;
  capabilities: string[];
  started_at_ms: number;
  command_code_available: boolean | null;
}

export interface DeviceInfo {
  device_id: string;
  name: string;
  created_at_ms: number;
  last_seen_at_ms: number | null;
}

export interface ServerHelloPayload {
  server: ServerInfo;
  device: DeviceInfo;
  resumed: boolean;
}

export interface PairRedeemResponse {
  token: string;
  device: DeviceInfo;
  server: ServerInfo;
}

export interface SessionSummary {
  session_id: string;
  title: string | null;
  title_source: string;
  status: string;
  working_dir: string | null;
  project_id: string | null;
  updated_at_ms: number | null;
  transcript_bytes: number | null;
  saved: boolean;
  archived: boolean;
  parent_session_id: string | null;
  agent_label: string | null;
}

export interface Project {
  project_id: string;
  label: string;
  path: string;
  pinned: boolean;
  created_at_ms: number;
  session_count: number;
}

export interface SessionsListPayload {
  sessions: SessionSummary[];
  projects: Project[];
  source: string;
  observed_at_ms: number;
  stale: boolean;
}

export interface HistoryMessageView {
  index: number;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
  tool_input: unknown;
  response_stats: Record<string, unknown> | null;
}

export interface ModelRouteView {
  model: string;
  provider: string;
  api_method: string;
  available: boolean;
  detail: string;
  is_command_code: boolean;
}

export interface RuntimeView {
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  auth_method: string | null;
  account_label: string | null;
  providers: string[];
  routes: ModelRouteView[];
  observed_at_ms: number;
  source: string;
}

export interface ContextView {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input: number | null;
  cache_creation_input: number | null;
  effective_budget: number | null;
  provider: string | null;
  model: string | null;
  observed_at_ms: number;
  source: string;
}

export interface ActiveTurnView {
  turn_id: string;
  operation_id: string;
  status: string;
  started_at_ms: number;
}

export interface SessionSnapshot {
  session: SessionSummary;
  messages: HistoryMessageView[];
  runtime: RuntimeView | null;
  plan: unknown | null;
  context: ContextView | null;
  active_turn?: ActiveTurnView | null;
  epoch: string;
  last_seq: number;
  revision: number;
  authoritative_at_ms: number;
  stale: boolean;
  source: string;
}

export interface OperationView {
  operation_id: string;
  session_id: string;
  turn_id: string | null;
  state:
    | 'staged'
    | 'reserved'
    | 'dispatching'
    | 'accepted'
    | 'rejected'
    | 'unknown'
    | 'observed_in_history'
    | 'cancelled';
  error_code: string | null;
  error_message: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface OperationStatePayload {
  operation: OperationView;
  duplicate: boolean;
}

export type SessionEvent =
  | { kind: 'turn_started'; turn_id: string; operation_id: string }
  | { kind: 'text_delta'; text: string; message_id: string | null }
  | { kind: 'text_done'; message_id: string | null }
  | { kind: 'text_replace'; text: string; message_id: string | null }
  | { kind: 'reasoning_delta'; text: string }
  | { kind: 'reasoning_done'; duration_secs: number | null }
  | { kind: 'tool_start'; call_id: string; name: string }
  | { kind: 'tool_input_delta'; call_id: string; delta: string }
  | { kind: 'tool_exec'; call_id: string; name: string }
  | { kind: 'tool_done'; call_id: string; name: string; output: string; error: string | null }
  | { kind: 'permission_request'; request_id: string; tool_name: string; description: string }
  | {
      kind: 'token_usage';
      input: number;
      output: number;
      cache_read_input: number | null;
      cache_creation_input: number | null;
      effective_budget: number | null;
    }
  | { kind: 'session_status'; status: string; pending_soft_interrupts: number | null }
  | { kind: 'connection_phase'; phase: string }
  | { kind: 'session_recovery'; continuation_message: string; reconnect_notice: string | null }
  | { kind: 'title_changed'; title: string | null; display_title: string }
  | { kind: 'plan_updated'; plan: unknown }
  | { kind: 'context_cap_changed'; max_context_tokens: number | null; effective_budget: number }
  | { kind: 'adapter_error'; code: string; message: string; retryable: boolean }
  | {
      kind: 'turn_stopped';
      turn_id: string | null;
      reason: string;
      message: string;
      provider_stop_reason: string | null;
    }
  | { kind: 'turn_done'; turn_id: string | null }
  | { kind: 'needs_reconcile'; reason: string };

export interface SessionEventPayload {
  event: SessionEvent;
  turn_id: string | null;
  operation_id: string | null;
  observed_at_ms: number;
}

export interface ActivityItem {
  at_ms: number;
  kind: string;
  title: string;
  detail: string | null;
  turn_id: string | null;
}

export interface ActivitySnapshotPayload {
  session_id: string;
  items: ActivityItem[];
  truncated: boolean;
  source: string;
  observed_at_ms: number;
}

export interface ModelsListPayload {
  runtime: RuntimeView;
  models: ModelRouteView[];
  source: string;
  observed_at_ms: number;
}

export interface ServerStatusPayload {
  jcode_connected: boolean;
  message: string | null;
  observed_at_ms: number;
}

export interface DirEntry {
  name: string;
  kind: string;
  size: number | null;
  modified_at_ms: number | null;
  hidden: boolean;
}

export interface DirListing {
  project_id: string;
  path: string;
  entries: DirEntry[];
  next_cursor: string | null;
  truncated: boolean;
  observed_at_ms: number;
}

export interface FilePreview {
  project_id: string;
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  observed_at_ms: number;
}

export interface CreateSessionResponse {
  session: SessionSummary;
  created: boolean;
}

export interface CancelTurnResponse {
  cancelled: boolean;
  turn_id: string | null;
  atomic_turn_scope: boolean;
  note: string;
}

export interface PlanSnapshotPayload {
  session_id: string;
  plan: unknown | null;
  source: string;
  observed_at_ms: number;
}
