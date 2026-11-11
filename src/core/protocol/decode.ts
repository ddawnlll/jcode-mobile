/**
 * Strict-ish decoding for adapter frames. The app never trusts shapes: a
 * malformed frame becomes `unknown`, which callers skip silently, and oversized
 * frames are rejected before JSON.parse.
 */
import { budgets } from '../../design/tokens';
import {
  CAPABILITY_NAMES,
  PROTOCOL_VERSION,
  type ErrorCode,
  type HistoryMessage,
  type MessageImage,
  type DirectoryEntry,
  type ModelRoute,
  type ServerEvent,
  type SessionInfo,
  type TodoSnapshot,
} from './frames';
import { splitLegacyReasoning } from './reasoning';

export type DecodeResult =
  | { ok: true; frame: ServerEvent & { reply_to?: number } }
  | { ok: false; reason: 'too_large' | 'not_json' | 'bad_envelope' | 'bad_event'; detail?: string };

const ERROR_CODES: ErrorCode[] = [
  'unsupported_version',
  'unknown_request',
  'unknown_session',
  'invalid_request',
  'internal',
  'unauthorized',
  'unsupported_capability',
  'daemon_unavailable',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function optionalStr(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}
function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function decodeStringListMap(value: unknown): Record<string, string[]> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (Array.isArray(entry)) out[key] = stringArray(entry);
  }
  return out;
}

function decodeModelRoutes(value: unknown): ModelRoute[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const routes: ModelRoute[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const model = str(record.model);
    const provider = str(record.provider);
    if (!model || !provider) continue;
    routes.push({ model, provider, available: record.available !== false });
  }
  return routes.length ? routes : undefined;
}

function decodeSession(value: unknown): SessionInfo | null {
  const record = asRecord(value);
  if (!record) return null;
  const session_id = str(record.session_id);
  if (!session_id) return null;
  const live = str(record.live_state);
  return {
    session_id,
    title: optionalStr(record.title),
    working_dir: optionalStr(record.working_dir),
    status: str(record.status),
    saved: bool(record.saved) ?? false,
    save_label: optionalStr(record.save_label),
    updated_at_ms: num(record.updated_at_ms) ?? null,
    last_active_at_ms: num(record.last_active_at_ms) ?? null,
    archived: bool(record.archived) ?? false,
    archived_at_ms: num(record.archived_at_ms) ?? null,
    transcript_bytes: num(record.transcript_bytes) ?? null,
    user_connected: bool(record.user_connected) ?? false,
    ...(live === 'working' || live === 'ready' ? { live_state: live } : null),
  };
}

export function decodeRecovery(value: unknown): { continuation_message: string; reconnect_notice?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const continuation = str(record.continuation_message);
  if (!continuation) return undefined;
  const notice = str(record.reconnect_notice);
  return {
    continuation_message: continuation.slice(0, 8192),
    ...(notice ? { reconnect_notice: notice.slice(0, 2048) } : null),
  };
}

function decodeHistoryMessage(value: unknown, fallbackIndex: number): HistoryMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  const role = str(record.role);
  const content = str(record.content);
  const index = num(record.index);
  if (!role || content === undefined) return null;
  const stats = asRecord(record.response_stats);
  const toolData = asRecord(record.tool_data);
  const toolId = toolData ? str(toolData.id) : undefined;
  const toolName = toolData ? str(toolData.name) : undefined;
  const legacy = role === 'assistant' && str(record.reasoning) === undefined
    ? splitLegacyReasoning(content)
    : null;
  return {
    index: index !== undefined ? index : fallbackIndex,
    ...(record.truncated === true ? { truncated: true as const } : null),
    role,
    content: legacy ? legacy.content : content,
    ...(str(record.reasoning)
      ? { reasoning: str(record.reasoning) }
      : legacy?.reasoning
        ? { reasoning: legacy.reasoning }
        : null),
    ...(Array.isArray(record.tool_calls)
      ? { tool_calls: stringArray(record.tool_calls) }
      : null),
    ...(toolData && toolId && toolName
      ? {
          tool_data: {
            id: toolId,
            name: toolName,
            input: toolData.input,
            intent: str(toolData.intent),
          },
        }
      : null),
    ...(stats
      ? {
          response_stats: {
            duration_secs: num(stats.duration_secs),
            input_tokens: num(stats.input_tokens),
            output_tokens: num(stats.output_tokens),
          },
        }
      : null),
  };
}

function decodeImages(value: unknown): MessageImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const media_type = str(record.media_type);
    const data = str(record.data);
    if (!media_type || !data) return [];
    const anchor = asRecord(record.anchor);
    const anchorKind = anchor ? str(anchor.kind) : undefined;
    return [
      {
        media_type,
        data,
        label: optionalStr(record.label) ?? null,
        alt: optionalStr(record.alt) ?? null,
        source: str(record.source),
        ...(anchorKind
          ? {
              anchor: {
                kind: anchorKind,
                ordinal: num(anchor?.ordinal),
                id: str(anchor?.id),
              },
            }
          : null),
        ...(num(record.history_message_index) !== undefined
          ? { history_message_index: num(record.history_message_index) }
          : null),
      },
    ];
  });
}

function decodeTodoSnapshot(value: unknown): TodoSnapshot {
  const record = asRecord(value) ?? {};
  const todos = Array.isArray(record.todos) ? record.todos : [];
  return {
    todos: todos
      .map((item) => {
        const entry = asRecord(item);
        if (!entry) return null;
        const id = str(entry.id);
        const content = str(entry.content);
        const status = str(entry.status);
        if (!id || !content || !status) return null;
        return {
          id,
          content,
          status,
          priority: str(entry.priority),
          group: optionalStr(entry.group) ?? null,
          blocked_by: stringArray(entry.blocked_by),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    plan: asRecord(record.plan)
      ? { user_intention: optionalStr((record.plan as Record<string, unknown>).user_intention) ?? null }
      : undefined,
    goals: Array.isArray(record.goals) ? record.goals : [],
  };
}

export function decodeFrame(raw: string, maxBytes = budgets.maxFrameBytes): DecodeResult {
  if (raw.length > maxBytes) return { ok: false, reason: 'too_large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  const record = asRecord(parsed);
  if (!record) return { ok: false, reason: 'bad_envelope' };
  if (record.v !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'bad_envelope', detail: `unsupported v ${String(record.v)}` };
  }
  const ev = str(record.ev);
  if (!ev) return { ok: false, reason: 'bad_envelope' };
  const reply_to = num(record.reply_to);
  const base = reply_to !== undefined ? { reply_to } : {};

  const session = () => {
    const id = str(record.session_id);
    const attachment = str(record.attachment_id);
    const turn = num(record.turn_id);
    if (!id || !attachment || turn === undefined) return null;
    return { session_id: id, attachment_id: attachment, turn_id: turn };
  };

  switch (ev) {
    case 'hello_ok': {
      const version = num(record.version);
      const server = str(record.server);
      if (version === undefined || !server) break;
      return {
        ok: true,
        frame: {
          ev,
          version,
          server,
          adapter_version: str(record.adapter_version),
          capabilities: stringArray(record.capabilities).filter((name) =>
            (CAPABILITY_NAMES as readonly string[]).includes(name),
          ),
          daemon_version: str(record.daemon_version),
          server_name: str(record.server_name),
          ...base,
        },
      };
    }
    case 'ok':
      return {
        ok: true,
        frame: {
          ev,
          ...base,
          ...(str(record.session_id) ? { session_id: str(record.session_id)! } : null),
          ...('title' in record ? { title: optionalStr(record.title) ?? null } : null),
          ...(str(record.display_title) ? { display_title: str(record.display_title)! } : null),
        },
      };
    case 'error': {
      const code = str(record.code) as ErrorCode | undefined;
      const message = str(record.message);
      if (!code || !ERROR_CODES.includes(code) || !message) break;
      return { ok: true, frame: { ev, code, message, detail: str(record.detail), ...base } };
    }
    case 'sessions': {
      const sessions = Array.isArray(record.sessions)
        ? record.sessions.map(decodeSession).filter((item): item is SessionInfo => item !== null)
        : null;
      if (!sessions) break;
      return {
        ok: true,
        frame: {
          ev,
          sessions,
          partial: bool(record.partial) ?? false,
          cursor: optionalStr(record.cursor) ?? null,
          end: bool(record.end) ?? false,
          ...base,
        },
      };
    }
    case 'attached': {
      const info = decodeSession(record.session);
      const attachment_id = str(record.attachment_id);
      if (!info || !attachment_id) break;
      return {
        ok: true,
        frame: {
          ev,
          session: info,
          attachment_id,
          capabilities: stringArray(record.capabilities),
          continuation: bool(record.continuation) ?? false,
          ...base,
        },
      };
    }
    case 'history': {
      const id = str(record.session_id);
      const attachment = str(record.attachment_id);
      const total = num(record.total_messages);
      const baseIndex = num(record.base_index);
      if (!id || !attachment || total === undefined || baseIndex === undefined) break;
      if (!Array.isArray(record.messages)) break;
      const messages = record.messages
        .map((message, offset) => decodeHistoryMessage(message, baseIndex + offset))
        .filter((message): message is HistoryMessage => message !== null);
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          attachment_id: attachment,
          messages,
          base_index: baseIndex,
          total_messages: total,
          tail_fingerprint: str(record.tail_fingerprint) ?? '',
          accepted_client_ids: stringArray(record.accepted_client_ids),
          interrupted_at_attach: bool(record.interrupted_at_attach) ?? false,
          images: decodeImages(record.images),
          ...(num(record.images_omitted) !== undefined
            ? { images_omitted: num(record.images_omitted) }
            : null),
          ...(typeof record.has_older === 'boolean' ? { has_older: record.has_older } : null),
          ...(decodeRecovery(record.recovery) ? { recovery: decodeRecovery(record.recovery) } : null),
          ...(num(record.history_revision) !== undefined ? { history_revision: num(record.history_revision) } : null),
          ...(str(record.history_genesis) !== undefined ? { history_genesis: str(record.history_genesis) } : null),
          ...base,
        },
      };
    }
    case 'text_delta':
    case 'text_replace': {
      const identity = session();
      const text = str(record.text);
      if (!identity || text === undefined) break;
      return { ok: true, frame: { ev, ...identity, text, ...base } };
    }
    case 'text_suffix_replace': {
      const identity = session();
      const old_text = str(record.old_text);
      const new_text = str(record.new_text);
      if (!identity || old_text === undefined || new_text === undefined) break;
      return { ok: true, frame: { ev, ...identity, old_text, new_text, ...base } };
    }
    case 'reasoning_delta': {
      const identity = session();
      const text = str(record.text);
      if (!identity || text === undefined) break;
      return { ok: true, frame: { ev, ...identity, text, ...base } };
    }
    case 'reasoning_done': {
      const identity = session();
      if (!identity) break;
      return {
        ok: true,
        frame: {
          ev,
          ...identity,
          ...(num(record.duration_secs) !== undefined ? { duration_secs: num(record.duration_secs) } : null),
          ...base,
        },
      };
    }
    case 'text_done': {
      const identity = session();
      if (!identity) break;
      return { ok: true, frame: { ev, ...identity, ...base } };
    }
    case 'message_end': {
      const identity = session();
      if (!identity) break;
      return {
        ok: true,
        frame: { ev, ...identity, stop_reason: str(record.stop_reason), ...base },
      };
    }
    case 'retry_rollback': {
      const identity = session();
      if (!identity) break;
      return {
        ok: true,
        frame: {
          ev,
          ...identity,
          attempt: num(record.attempt) ?? 0,
          max: num(record.max) ?? 0,
          ...base,
        },
      };
    }
    case 'control_error': {
      const message = str(record.message);
      if (!message) break;
      return {
        ok: true,
        frame: {
          ev,
          message,
          session_id: str(record.session_id),
          attachment_id: str(record.attachment_id),
          ...base,
        },
      };
    }
    case 'message_accepted': {
      const identity = session();
      const client_message_id = str(record.client_message_id);
      if (!identity || !client_message_id) break;
      return { ok: true, frame: { ev, ...identity, client_message_id, ...base } };
    }
    case 'tool_start': {
      const identity = session();
      const call_id = str(record.call_id);
      const name = str(record.name);
      if (!identity || !call_id || !name) break;
      return { ok: true, frame: { ev, ...identity, call_id, name, ...base } };
    }
    case 'tool_exec': {
      const identity = session();
      const call_id = str(record.call_id);
      const name = str(record.name);
      if (!identity || !call_id || !name) break;
      return { ok: true, frame: { ev, ...identity, call_id, name, input: record.input, ...base } };
    }
    case 'tool_done': {
      const identity = session();
      const call_id = str(record.call_id);
      const name = str(record.name);
      if (!identity || !call_id || !name) break;
      return {
        ok: true,
        frame: {
          ev,
          ...identity,
          call_id,
          name,
          output: str(record.output),
          error: optionalStr(record.error),
          truncated: bool(record.truncated),
          ...base,
        },
      };
    }
    case 'turn_stopped': {
      const identity = session();
      const reason = str(record.reason);
      const message = str(record.message);
      if (!identity || !reason || !message) break;
      return { ok: true, frame: { ev, ...identity, reason, message, ...base } };
    }
    case 'turn_done': {
      const identity = session();
      if (!identity) break;
      return {
        ok: true,
        frame: {
          ev,
          ...identity,
          pending_soft_interrupts: num(record.pending_soft_interrupts),
          stop_reason: str(record.stop_reason),
          ...base,
        },
      };
    }
    case 'stdin_request': {
      const id = str(record.session_id);
      const attachment = str(record.attachment_id);
      const request_id = str(record.request_id);
      if (!id || !attachment || !request_id) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          attachment_id: attachment,
          request_id,
          tool: str(record.tool) ?? 'tool',
          prompt: str(record.prompt) ?? 'Waiting for input.',
          is_password: bool(record.is_password) ?? false,
          ...base,
        },
      };
    }
    case 'stdin_response': {
      const id = str(record.session_id);
      const attachment = str(record.attachment_id);
      const request_id = str(record.request_id);
      if (!id || !attachment || !request_id) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          attachment_id: attachment,
          request_id,
          delivered: bool(record.delivered) ?? false,
          message: str(record.message),
          ...base,
        },
      };
    }
    case 'history_revision': {
      const id = str(record.session_id);
      const revision = num(record.revision);
      const total = num(record.total_messages);
      if (!id || revision === undefined || total === undefined) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          revision,
          total_messages: total,
          genesis: str(record.genesis) ?? '',
          ...base,
        },
      };
    }
    case 'message_chunk': {
      const id = str(record.session_id);
      const message_index = num(record.message_index);
      const offset = num(record.offset);
      const text = str(record.text);
      const total_bytes = num(record.total_bytes);
      if (!id || message_index === undefined || offset === undefined || text === undefined || total_bytes === undefined) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          message_index,
          offset,
          text,
          total_bytes,
          done: bool(record.done) ?? false,
          revision: num(record.revision),
          ...base,
        },
      };
    }
    case 'session_status': {
      const id = str(record.session_id);
      const attachment = str(record.attachment_id);
      const status = str(record.status);
      if (!id || !attachment || !status) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          attachment_id: attachment,
          status,
          pending_soft_interrupts: num(record.pending_soft_interrupts),
          ...base,
        },
      };
    }
    case 'connection_phase': {
      const id = str(record.session_id);
      const attachment = str(record.attachment_id);
      const phase = str(record.phase);
      if (!id || !attachment || !phase) break;
      return { ok: true, frame: { ev, session_id: id, attachment_id: attachment, phase, ...base } };
    }
    case 'soft_interrupt_injected': {
      const id = str(record.session_id);
      const attachment = str(record.attachment_id);
      if (!id || !attachment) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          attachment_id: attachment,
          client_ids: stringArray(record.client_ids),
          point: str(record.point) ?? 'unknown',
          ...base,
        },
      };
    }
    case 'soft_interrupts_cancelled':
      return {
        ok: true,
        frame: {
          ev,
          cancelled: stringArray(record.cancelled),
          not_queued: stringArray(record.not_queued),
          ...base,
        },
      };
    case 'session_renamed': {
      const id = str(record.session_id);
      const display_title = str(record.display_title);
      if (!id || !display_title) break;
      return {
        ok: true,
        frame: { ev, session_id: id, title: optionalStr(record.title), display_title, ...base },
      };
    }
    case 'todo_state': {
      const id = str(record.session_id);
      if (!id) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          state: decodeTodoSnapshot(record.state),
          observed_at_ms: num(record.observed_at_ms) ?? Date.now(),
          ...base,
        },
      };
    }
    case 'models': {
      const id = str(record.session_id);
      if (!id) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          models: stringArray(record.models),
          current: optionalStr(record.current) ?? null,
          efforts: stringArray(record.efforts),
          efforts_by_model: decodeStringListMap(record.efforts_by_model),
          routes: decodeModelRoutes(record.routes),
          ...(optionalStr(record.current_effort) !== undefined
            ? { current_effort: optionalStr(record.current_effort) }
            : null),
          ...base,
        },
      };
    }
    case 'context_snapshot': {
      const id = str(record.session_id);
      const attachment = str(record.attachment_id);
      if (!id || !attachment) break;
      const basis = str(record.basis);
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          attachment_id: attachment,
          used_tokens: num(record.used_tokens) ?? null,
          limit_tokens: num(record.limit_tokens) ?? null,
          basis:
            basis === 'last_request' || basis === 'current_prompt' ? basis : 'unknown',
          model: optionalStr(record.model) ?? null,
          observed_at_ms: num(record.observed_at_ms) ?? Date.now(),
          cached: bool(record.cached) ?? false,
          ...base,
        },
      };
    }
    case 'session_config': {
      const id = str(record.session_id);
      if (!id) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          model: optionalStr(record.model) ?? null,
          effort: optionalStr(record.effort) ?? null,
          efforts: stringArray(record.efforts),
          efforts_by_model: decodeStringListMap(record.efforts_by_model),
          confirmed: bool(record.confirmed) ?? false,
          source: str(record.source) ?? 'unknown',
          ...base,
        },
      };
    }
    case 'directory': {
      const path = str(record.path);
      const canonical = str(record.canonical_path);
      if (!path || !canonical) break;
      const entries: DirectoryEntry[] = Array.isArray(record.entries)
        ? record.entries.flatMap((item) => {
            const entry = asRecord(item);
            if (!entry) return [];
            const name = str(entry.name);
            const entryPath = str(entry.path);
            const kind = str(entry.kind);
            if (!name || !entryPath) return [];
            return [
              {
                name,
                path: entryPath,
                kind:
                  kind === 'directory' || kind === 'file' || kind === 'symlink'
                    ? kind
                    : 'other',
                hidden: bool(entry.hidden),
                readable: bool(entry.readable),
              },
            ];
          })
        : [];
      return {
        ok: true,
        frame: {
          ev,
          path,
          canonical_path: canonical,
          parent: optionalStr(record.parent) ?? null,
          entries,
          cursor: optionalStr(record.cursor) ?? null,
          roots: stringArray(record.roots),
          error: optionalStr(record.error) ?? null,
          ...base,
        },
      };
    }
    case 'image_ack': {
      const id = str(record.session_id);
      const clientMessageId = str(record.client_message_id);
      if (!id || !clientMessageId) break;
      return {
        ok: true,
        frame: {
          ev,
          session_id: id,
          client_message_id: clientMessageId,
          accepted: bool(record.accepted) ?? false,
          ...base,
        },
      };
    }
    case 'server_info': {
      const server = str(record.server);
      if (!server) break;
      return {
        ok: true,
        frame: {
          ev,
          server,
          adapter_version: str(record.adapter_version),
          daemon_version: str(record.daemon_version),
          continuation: bool(record.continuation) ?? false,
          capabilities: stringArray(record.capabilities),
          observed_at_ms: num(record.observed_at_ms) ?? Date.now(),
          ...base,
        },
      };
    }
    case 'file_content': {
      const id = str(record.session_id);
      const path = str(record.path);
      const content = str(record.content);
      const size = num(record.size);
      if (!id || !path || content === undefined || size === undefined) break;
      return {
        ok: true,
        frame: { ev, session_id: id, path, content, size, truncated: bool(record.truncated) ?? false, ...base },
      };
    }
    default:
      return { ok: true, frame: { ev: 'unknown', kind: ev } };
  }
  return { ok: false, reason: 'bad_event', detail: ev };
}

export function encodeFrame(id: number, request: Record<string, unknown>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, id, ...request });
}
