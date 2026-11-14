/**
 * Phone-local session preferences: an ordering and offline fallback cache.
 *
 * The adapter is now authoritative for favorites and archive state through
 * `SessionSummary.favorite` and `SessionSummary.archived`. Local pins and
 * archive marks are only used when the adapter is offline (or when an older
 * adapter does not report a favorite flag). Everything is keyed by the paired
 * server id so two servers never share a pinned or hidden list.
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
  const current = getSessionPrefs(serverId);
  const pinned = !current.pinned.includes(sessionId);
  setPinnedPref(serverId, sessionId, pinned);
  return pinned;
}

/** Sets (never toggles) the local fallback pin, used to mirror server favorites. */
export function setPinnedPref(
  serverId: string | null | undefined,
  sessionId: string,
  pinned: boolean,
) {
  if (!serverId) return;
  const all = read();
  const current = normalize(all[serverId]);
  const has = current.pinned.includes(sessionId);
  if (pinned === has) return;
  all[serverId] = {
    ...current,
    pinned: pinned
      ? [...current.pinned, sessionId]
      : current.pinned.filter((id) => id !== sessionId),
  };
  write();
}

export function archiveSessionPref(serverId: string | null | undefined, sessionId: string) {
  setArchivedPref(serverId, sessionId, true);
}

export function restoreSessionPref(serverId: string | null | undefined, sessionId: string) {
  setArchivedPref(serverId, sessionId, false);
}

/** Sets (never toggles) the local offline archive fallback. */
export function setArchivedPref(
  serverId: string | null | undefined,
  sessionId: string,
  archived: boolean,
) {
  if (!serverId) return;
  const all = read();
  const current = normalize(all[serverId]);
  const has = current.archived.includes(sessionId);
  if (archived === has) return;
  all[serverId] = {
    ...current,
    archived: archived
      ? [...current.archived, sessionId]
      : current.archived.filter((id) => id !== sessionId),
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

export type FavoriteSource = 'server' | 'local';

export interface FavoriteView {
  favorite: boolean;
  /** Where the visible state came from, so the UI can label it honestly. */
  source: FavoriteSource;
}

/**
 * Server favorite wins while the adapter is connected. Offline, a phone pin is
 * used first, then the last server summary so a known favorite is not lost.
 */
export function favoriteView(
  session: Pick<SessionSummary, 'session_id' | 'favorite'>,
  prefs: SessionPrefs,
  online: boolean,
): FavoriteView {
  if (online) {
    if (typeof session.favorite === 'boolean') {
      return { favorite: session.favorite, source: 'server' };
    }
    return { favorite: prefs.pinned.includes(session.session_id), source: 'local' };
  }
  // A known server favorite cannot be changed offline. A phone pin only
  // applies to sessions the server does not report as favorites.
  if (session.favorite === true) return { favorite: true, source: 'server' };
  if (prefs.pinned.includes(session.session_id)) {
    return { favorite: true, source: 'local' };
  }
  return { favorite: false, source: 'local' };
}

export function sessionFavorite(
  session: Pick<SessionSummary, 'session_id' | 'favorite'>,
  prefs: SessionPrefs,
  online: boolean,
): boolean {
  return favoriteView(session, prefs, online).favorite;
}

/**
 * Online, the server archive flag is authoritative. Offline, a local archive
 * fallback and the last cached server flag both hide the row.
 */
export function sessionIsArchived(
  session: Pick<SessionSummary, 'session_id' | 'archived'>,
  prefs: SessionPrefs,
  online: boolean,
): boolean {
  if (!online && prefs.archived.includes(session.session_id)) return true;
  return session.archived === true;
}

/**
 * Deterministic order: favorites first, then most recently updated. Stable for
 * equal timestamps so the list does not reshuffle on every render.
 */
export function sortSessions(
  sessions: SessionSummary[],
  prefs: SessionPrefs,
  online = true,
): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const pa = sessionFavorite(a, prefs, online) ? 0 : 1;
    const pb = sessionFavorite(b, prefs, online) ? 0 : 1;
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
  online = true,
): SessionSummary[] {
  return sortSessions(
    sessions.filter((session) => sessionFavorite(session, prefs, online)),
    prefs,
    online,
  );
}

export function visibleSessions(
  sessions: SessionSummary[],
  prefs: SessionPrefs,
  online = true,
): SessionSummary[] {
  return sortSessions(
    sessions.filter((session) => !sessionIsArchived(session, prefs, online)),
    prefs,
    online,
  );
}
