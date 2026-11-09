import * as Crypto from 'expo-crypto';

import type { HistoryMessage, MessageImage, SessionInfo } from '../protocol/frames';
import type { ChangeRecord, ToolRow } from '../state/store';

export function newClientId(prefix: string): string {
  return `${prefix}_${Crypto.randomUUID()}`;
}

/** Stable anchor fingerprint for a committed message. */
export function messageFingerprint(message: Pick<HistoryMessage, 'role' | 'content'>): string {
  let hash = 5381;
  const value = `${message.role}\u0000${message.content}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function findMessageByIndex(
  messages: HistoryMessage[],
  index: number,
): HistoryMessage | undefined {
  return messages.find((message) => message.index === index);
}

export interface SeamResult {
  index: number | null;
  count: number | null;
  /** True when the stored anchor could not be reconciled. */
  anchorLost: boolean;
  /** New bookmark to persist after displaying the seam. */
  seenIndex: number;
}

/**
 * Derive the return seam from the local bookmark against authoritative history.
 * A count is only reported when the bookmark index still exists in the loaded
 * window; otherwise the copy says "since your last visit" without a number.
 */
export function deriveSeam(
  messages: HistoryMessage[],
  total: number,
  baseIndex: number,
  bookmark: { messageIndex: number; fingerprint: string } | null,
  firstVisit: boolean,
): SeamResult {
  if (firstVisit || !bookmark) {
    return { index: null, count: null, anchorLost: false, seenIndex: total };
  }
  if (bookmark.messageIndex >= total) {
    return { index: null, count: null, anchorLost: false, seenIndex: total };
  }
  const anchor = findMessageByIndex(messages, bookmark.messageIndex);
  if (anchor && messageFingerprint(anchor) === bookmark.fingerprint) {
    return {
      index: bookmark.messageIndex,
      count: total - bookmark.messageIndex,
      anchorLost: false,
      seenIndex: bookmark.messageIndex,
    };
  }
  // The exact message changed or was compacted. Try to recover the fingerprint
  // among loaded committed items before giving up on an exact count.
  const recovered = messages.find((message) => messageFingerprint(message) === bookmark.fingerprint);
  if (recovered) {
    return {
      index: recovered.index,
      count: total - recovered.index,
      anchorLost: false,
      seenIndex: recovered.index,
    };
  }
  return {
    index: Math.max(baseIndex, Math.min(bookmark.messageIndex, total)),
    count: null,
    anchorLost: true,
    seenIndex: Math.max(baseIndex, Math.min(bookmark.messageIndex, total)),
  };
}

export type SessionGroup = 'needs_you' | 'saved' | 'working' | 'recent';

export function groupSessions(sessions: SessionInfo[]): Array<{
  key: SessionGroup;
  title: string;
  sessions: SessionInfo[];
}> {
  const sorted = [...sessions].sort((a, b) => {
    if (a.saved !== b.saved) return a.saved ? -1 : 1;
    return (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0);
  });
  const working = sorted.filter((session) => session.live_state === 'working');
  const saved = sorted.filter((session) => session.saved && session.live_state !== 'working');
  const used = new Set([...working, ...saved].map((session) => session.session_id));
  const recent = sorted.filter((session) => !used.has(session.session_id));
  const groups: Array<{ key: SessionGroup; title: string; sessions: SessionInfo[] }> = [
    { key: 'working', title: 'Working', sessions: working },
    { key: 'saved', title: 'Saved', sessions: saved },
    { key: 'recent', title: 'Recent', sessions: recent },
  ];
  return groups.filter((group) => group.sessions.length > 0);
}

export function basename(path: string | null | undefined): string {
  if (!path) return '';
  const trimmed = path.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

export function formatTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '';
  const date = new Date(ms);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  if (sameDay) {
    return `${date.getHours().toString().padStart(2, '0')}:${date
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }
  const yesterday = new Date(now - 86_400_000);
  if (yesterday.toDateString() === date.toDateString()) return 'Yesterday';
  if (now - ms < 7 * 86_400_000) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  }
  return `${date.getDate()} ${date.toLocaleString('en', { month: 'short' })}`;
}

export function formatClock(ms: number | null | undefined): string {
  if (!ms) return '';
  const date = new Date(ms);
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

const EDIT_TOOLS = /(^|[_-])(edit|write|apply_patch|patch|str_replace|create_file|delete_file)([_-]|$)/i;

function changeFromInput(
  key: string,
  callId: string,
  name: string,
  input: unknown,
): ChangeRecord | null {
  if (!EDIT_TOOLS.test(name)) return null;
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const path =
    (typeof record.path === 'string' && record.path) ||
    (typeof record.file_path === 'string' && record.file_path) ||
    (typeof record.target === 'string' && record.target) ||
    (typeof record.filename === 'string' && record.filename) ||
    '';
  if (!path) return null;
  const patch =
    (typeof record.patch === 'string' && record.patch) ||
    (typeof record.diff === 'string' && record.diff) ||
    (typeof record.new_string === 'string' && record.old_string !== undefined
      ? `- ${String(record.old_string)}\n+ ${record.new_string}`
      : '');
  const lowered = name.toLowerCase();
  const operation: ChangeRecord['operation'] = lowered.includes('delete')
    ? 'delete'
    : lowered.includes('write') || lowered.includes('create')
      ? 'write'
      : lowered.includes('rename')
        ? 'rename'
        : 'edit';
  const lines = patch ? patch.split('\n') : [];
  const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  return {
    key,
    callId,
    path,
    operation,
    ...(patch
      ? { diff: patch.slice(0, 24_000), added, removed, evidence: 'diff' as const }
      : { evidence: 'path' as const }),
  };
}

/** Confirmed file changes only; never infer a diff from assistant prose. */
export function deriveChanges(messages: HistoryMessage[], tools: ToolRow[]): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (tool.state === 'failed' || tool.state === 'running') continue;
    const change = changeFromInput(`t-${tool.callId}`, tool.callId, tool.name, tool.input);
    if (change && !seen.has(change.callId)) {
      seen.add(change.callId);
      changes.push(change);
    }
  }
  for (const message of messages) {
    if (!message.tool_data) continue;
    if (seen.has(message.tool_data.id)) continue;
    const change = changeFromInput(
      `h-${message.index}`,
      message.tool_data.id,
      message.tool_data.name,
      message.tool_data.input,
    );
    if (change) {
      seen.add(change.callId);
      changes.push(change);
    }
  }
  return changes.slice(-80);
}

/**
 * Daemon history carries images beside the message array. Anchor them to the
 * prompt, tool call or insertion boundary the server reports; never invent an
 * association from prose.
 */
export function attachHistoryImages(
  messages: HistoryMessage[],
  images: MessageImage[] | undefined,
): HistoryMessage[] {
  if (!images || images.length === 0) return messages;
  const copy = messages.map((message) => ({ ...message }));
  const userMessages = copy.filter((message) => message.role === 'user');
  for (const image of images) {
    let target: HistoryMessage | undefined;
    if (typeof image.history_message_index === 'number') {
      const boundary = Math.max(0, Math.min(copy.length - 1, image.history_message_index - 1));
      target = copy[boundary];
    } else if (image.anchor?.kind === 'user_prompt' && typeof image.anchor.ordinal === 'number') {
      target = userMessages[image.anchor.ordinal - 1];
    } else if (image.anchor?.kind === 'tool_call' && typeof image.anchor.id === 'string') {
      target = copy.find((message) => message.tool_data?.id === image.anchor?.id);
    }
    if (!target) target = copy[copy.length - 1];
    if (!target) continue;
    target.images = [...(target.images ?? []), image];
  }
  return copy;
}
