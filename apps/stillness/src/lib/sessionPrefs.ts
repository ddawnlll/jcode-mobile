/**
 * Phone-local session preferences: pinned and archived shelves.
 *
 * These are not server mutations. The protocol exposes no favorite or archive
 * verb, so pinning is labelled "on this phone" and archiving is an undoable
 * local shelf. Everything is keyed by the paired server id so two servers never
 * share a pinned or hidden list.
 */
import { useSyncExternalStore } from 'react';
import type { SessionSummary } from './protocol';

const KEY = 'jcode.mobile.v3.sessionPrefs';

export interface SessionPrefs {
  pinned: string[];
  archived: string[];
}

const EMPTY: SessionPrefs = { pinned: [], archived: [] };
let store: Record<string, SessionPrefs> | null = null;
const listeners = new Set<() => void>();

function read(): Record<string, SessionPrefs> {
  if (store) return store;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, SessionPrefs>) : {};
    const next: Record<string, SessionPrefs> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [serverId, value] of Object.entries(parsed)) {
        next[serverId] = normalize(value);
      }
    }
    store = next;
  } catch {
    store = {};
  }
  return store;
}

function write() {
  if (!store) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // A full quota keeps the in-memory shelf; it never touches server state.
  }
  for (const listener of listeners) listener();
}

function normalize(value: Partial<SessionPrefs> | undefined): SessionPrefs {
  return {
    pinned: Array.isArray(value?.pinned) ? value!.pinned.filter((id) => typeof id === 'string') : [],
    archived: Array.isArray(value?.archived) ? value!.archived.filter((id) => typeof id === 'string') : [],
  };
}

export function getSessionPrefs(serverId: string | null | undefined): SessionPrefs {
  if (!serverId) return EMPTY;
  return read()[serverId] ?? EMPTY;
}

export function togglePinned(serverId: string | null | undefined, sessionId: string): boolean {
  if (!serverId) return false;
  const all = read();
  const current = normalize(all[serverId]);
  const pinned = current.pinned.includes(sessionId)
    ? current.pinned.filter((id) => id !== sessionId)
    : [...current.pinned, sessionId];
  all[serverId] = { ...current, pinned };
  write();
  return pinned.includes(sessionId);
}

export function archiveSessionPref(serverId: string | null | undefined, sessionId: string) {
  if (!serverId) return;
  const all = read();
  const current = normalize(all[serverId]);
  if (current.archived.includes(sessionId)) return;
  all[serverId] = { ...current, archived: [...current.archived, sessionId] };
  write();
}

export function restoreSessionPref(serverId: string | null | undefined, sessionId: string) {
  if (!serverId) return;
  const all = read();
  const current = normalize(all[serverId]);
  if (!current.archived.includes(sessionId)) return;
  all[serverId] = {
    ...current,
    archived: current.archived.filter((id) => id !== sessionId),
  };
  write();
}

export function clearSessionPrefs(serverId: string | null | undefined) {
  if (!serverId) return;
  const all = read();
  delete all[serverId];
  write();
}

export function subscribeSessionPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionPrefs(serverId: string | null | undefined): SessionPrefs {
  return useSyncExternalStore(
    subscribeSessionPrefs,
    // `read()` stores one normalized object per server, so the snapshot keeps
    // its identity between notifications and React does not loop.
    () => getSessionPrefs(serverId),
    () => EMPTY,
  );
}

/**
 * Deterministic order: pinned first, then most recently updated. Stable for
 * equal timestamps so the list does not reshuffle on every render.
 */
export function sortSessions(
  sessions: SessionSummary[],
  prefs: SessionPrefs,
): SessionSummary[] {
  const pinned = new Set(prefs.pinned);
  return [...sessions].sort((a, b) => {
    const pa = pinned.has(a.session_id) ? 0 : 1;
    const pb = pinned.has(b.session_id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ta = a.updated_at_ms ?? 0;
    const tb = b.updated_at_ms ?? 0;
    if (ta !== tb) return tb - ta;
    return a.session_id.localeCompare(b.session_id);
  });
}

export function pinnedSessions(
  sessions: SessionSummary[],
  prefs: SessionPrefs,
): SessionSummary[] {
  const pinned = new Set(prefs.pinned);
  return sortSessions(
    sessions.filter((session) => pinned.has(session.session_id)),
    prefs,
  );
}

export function visibleSessions(
  sessions: SessionSummary[],
  prefs: SessionPrefs,
): SessionSummary[] {
  const archived = new Set(prefs.archived);
  return sortSessions(
    sessions.filter((session) => !archived.has(session.session_id)),
    prefs,
  );
}
