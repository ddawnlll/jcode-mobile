import type {
  ActivitySnapshotPayload,
  Project,
  SessionSnapshot,
  SessionSummary,
} from './protocol';

const SESSION_CACHE_PREFIX = 'jcode.mobile.v3.sessionList.';
const SNAPSHOT_CACHE_PREFIX = 'jcode.mobile.v3.snapshot.';
const DRAFT_PREFIX = 'jcode.mobile.v3.draft.';
const PENDING_PREFIX = 'jcode.mobile.v3.pending.';
const LAST_SESSION_PREFIX = 'jcode.mobile.v3.lastSession.';
const MAX_CACHED_SNAPSHOT_BYTES = 3_000_000;

export interface CachedSessionList {
  sessions: SessionSummary[];
  projects: Project[];
  observed_at_ms: number;
  source: string;
}

export function loadSessionListCache(serverId: string): CachedSessionList | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_PREFIX + serverId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSessionList;
    if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.projects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSessionListCache(serverId: string, value: CachedSessionList) {
  try {
    localStorage.setItem(SESSION_CACHE_PREFIX + serverId, JSON.stringify(value));
  } catch {
    // A full quota must not break live state.
  }
}

export function loadSnapshotCache(serverId: string, sessionId: string): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_PREFIX + serverId + '.' + sessionId);
    if (!raw) return null;
    return JSON.parse(raw) as SessionSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshotCache(serverId: string, snapshot: SessionSnapshot) {
  try {
    const raw = JSON.stringify(snapshot);
    if (raw.length > MAX_CACHED_SNAPSHOT_BYTES) return;
    localStorage.setItem(
      SNAPSHOT_CACHE_PREFIX + serverId + '.' + snapshot.session.session_id,
      raw,
    );
  } catch {
    // Ignore quota errors; the authoritative snapshot is still on screen.
  }
}

export function saveDraft(serverId: string, sessionId: string, text: string) {
  const key = DRAFT_PREFIX + serverId + '.' + sessionId;
  if (text) localStorage.setItem(key, text);
  else localStorage.removeItem(key);
}

export function loadDraft(serverId: string, sessionId: string): string {
  return localStorage.getItem(DRAFT_PREFIX + serverId + '.' + sessionId) ?? '';
}

export interface StoredPendingOperation {
  operation_id: string;
  text: string;
  state: string;
  created_at_ms: number;
}

export function savePending(serverId: string, sessionId: string, pending: StoredPendingOperation | null) {
  const key = PENDING_PREFIX + serverId + '.' + sessionId;
  if (pending) localStorage.setItem(key, JSON.stringify(pending));
  else localStorage.removeItem(key);
}

export function loadPending(serverId: string, sessionId: string): StoredPendingOperation | null {
  try {
    const raw = localStorage.getItem(PENDING_PREFIX + serverId + '.' + sessionId);
    return raw ? (JSON.parse(raw) as StoredPendingOperation) : null;
  } catch {
    return null;
  }
}

export function setLastSession(serverId: string, sessionId: string | null) {
  const key = LAST_SESSION_PREFIX + serverId;
  if (sessionId) localStorage.setItem(key, sessionId);
  else localStorage.removeItem(key);
}

export function getLastSession(serverId: string): string | null {
  return localStorage.getItem(LAST_SESSION_PREFIX + serverId);
}

export function saveActivityCache(serverId: string, activity: ActivitySnapshotPayload) {
  try {
    localStorage.setItem(
      'jcode.mobile.v3.activity.' + serverId + '.' + activity.session_id,
      JSON.stringify(activity),
    );
  } catch {
    // ignore
  }
}

export function loadActivityCache(serverId: string, sessionId: string): ActivitySnapshotPayload | null {
  try {
    const raw = localStorage.getItem('jcode.mobile.v3.activity.' + serverId + '.' + sessionId);
    return raw ? (JSON.parse(raw) as ActivitySnapshotPayload) : null;
  } catch {
    return null;
  }
}
