import * as Crypto from 'expo-crypto';

import type { HistoryMessage, SessionInfo } from '../protocol/frames';

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
