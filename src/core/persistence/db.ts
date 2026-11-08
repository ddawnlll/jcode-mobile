import * as SQLite from 'expo-sqlite';

import { budgets } from '../../design/tokens';
import type { HistoryMessage, SessionInfo } from '../protocol/frames';

const DB_NAME = 'jcode-mobile.db';
const MESSAGE_ROW_LIMIT = 500;

export interface ServerProfileRow {
  id: string;
  label: string;
  host: string;
  port: number;
  tls: number;
  device_id: string;
  created_at: number;
  last_connected_at: number | null;
  daemon_version: string | null;
  capabilities_json: string | null;
}

let database: SQLite.SQLiteDatabase | null = null;

/**
 * SQLite has no nested transactions and expo-sqlite's async transactions are
 * not mutually exclusive. Serialize transaction-writers so a session refresh
 * and a transcript cache cannot overlap.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = writeChain.then(work, work);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        tls INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_connected_at INTEGER,
        daemon_version TEXT,
        capabilities_json TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        server_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT,
        working_dir TEXT,
        status TEXT,
        live_state TEXT,
        saved INTEGER NOT NULL DEFAULT 0,
        save_label TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER,
        transcript_bytes INTEGER,
        last_synced_at INTEGER NOT NULL,
        PRIMARY KEY (server_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS sessions_recent ON sessions(server_id, updated_at_ms DESC);
      CREATE TABLE IF NOT EXISTS messages (
        server_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        stats_json TEXT,
        bytes INTEGER NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (server_id, session_id, idx)
      );
      CREATE INDEX IF NOT EXISTS messages_session ON messages(server_id, session_id, idx);
      CREATE TABLE IF NOT EXISTS drafts (
        server_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (server_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        server_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (server_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS pending_sends (
        server_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        client_message_id TEXT NOT NULL,
        content TEXT NOT NULL,
        state TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (server_id, session_id, client_message_id)
      );
      CREATE TABLE IF NOT EXISTS prefs (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }
  database = db;
  return db;
}

/** Test-only: replace the connection with an in-memory database. */
export async function openDatabaseForTests(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(':memory:');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(`
    CREATE TABLE servers (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, tls INTEGER NOT NULL, device_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_connected_at INTEGER, daemon_version TEXT, capabilities_json TEXT);
    CREATE TABLE sessions (server_id TEXT NOT NULL, session_id TEXT NOT NULL, title TEXT, working_dir TEXT, status TEXT, live_state TEXT, saved INTEGER NOT NULL DEFAULT 0, save_label TEXT, archived INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER, transcript_bytes INTEGER, last_synced_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE messages (server_id TEXT NOT NULL, session_id TEXT NOT NULL, idx INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, stats_json TEXT, bytes INTEGER NOT NULL, cached_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id, idx));
    CREATE TABLE drafts (server_id TEXT NOT NULL, session_id TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE bookmarks (server_id TEXT NOT NULL, session_id TEXT NOT NULL, message_index INTEGER NOT NULL, fingerprint TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE pending_sends (server_id TEXT NOT NULL, session_id TEXT NOT NULL, client_message_id TEXT NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id, client_message_id));
    CREATE TABLE prefs (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);
  database = db;
  return db;
}

function db(): SQLite.SQLiteDatabase {
  if (!database) throw new Error('Database not initialized');
  return database;
}

/* ---------------------------------------------------------------- profiles */

export async function listServers(): Promise<ServerProfileRow[]> {
  return db().getAllAsync<ServerProfileRow>('SELECT * FROM servers ORDER BY last_connected_at DESC, created_at DESC');
}

export async function saveServer(profile: ServerProfileRow): Promise<void> {
  await db().runAsync(
    `INSERT INTO servers (id, label, host, port, tls, device_id, created_at, last_connected_at, daemon_version, capabilities_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label, host = excluded.host, port = excluded.port, tls = excluded.tls,
       device_id = excluded.device_id, last_connected_at = excluded.last_connected_at,
       daemon_version = excluded.daemon_version, capabilities_json = excluded.capabilities_json`,
    profile.id,
    profile.label,
    profile.host,
    profile.port,
    profile.tls,
    profile.device_id,
    profile.created_at,
    profile.last_connected_at,
    profile.daemon_version,
    profile.capabilities_json,
  );
}

export async function deleteServer(profileId: string): Promise<void> {
  await serialized(() =>
    db().withTransactionAsync(async () => {
      for (const table of ['sessions', 'messages', 'drafts', 'bookmarks', 'pending_sends']) {
        await db().runAsync(`DELETE FROM ${table} WHERE server_id = ?`, profileId);
      }
      await db().runAsync('DELETE FROM servers WHERE id = ?', profileId);
    }),
  );
}

/* ---------------------------------------------------------------- sessions */

export async function loadCachedSessions(serverId: string): Promise<SessionInfo[]> {
  const rows = await db().getAllAsync<{
    session_id: string;
    title: string | null;
    working_dir: string | null;
    status: string | null;
    live_state: string | null;
    saved: number;
    save_label: string | null;
    archived: number;
    updated_at_ms: number | null;
    transcript_bytes: number | null;
    last_synced_at: number;
  }>('SELECT * FROM sessions WHERE server_id = ? ORDER BY saved DESC, updated_at_ms DESC', serverId);
  return rows.map((row) => ({
    session_id: row.session_id,
    title: row.title,
    working_dir: row.working_dir,
    status: row.status ?? undefined,
    live_state: row.live_state === 'working' || row.live_state === 'ready' ? row.live_state : undefined,
    saved: row.saved === 1,
    save_label: row.save_label,
    archived: row.archived === 1,
    updated_at_ms: row.updated_at_ms,
    transcript_bytes: row.transcript_bytes,
  }));
}

export async function upsertSessions(serverId: string, sessions: SessionInfo[]): Promise<void> {
  if (!sessions.length) return;
  const now = Date.now();
  await serialized(() =>
    db().withTransactionAsync(async () => {
      for (const session of sessions) {
      await db().runAsync(
        `INSERT INTO sessions (server_id, session_id, title, working_dir, status, live_state, saved, save_label, archived, updated_at_ms, transcript_bytes, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, session_id) DO UPDATE SET
           title = excluded.title, working_dir = excluded.working_dir, status = excluded.status,
           live_state = excluded.live_state, saved = excluded.saved, save_label = excluded.save_label,
           archived = excluded.archived, updated_at_ms = excluded.updated_at_ms,
           transcript_bytes = excluded.transcript_bytes, last_synced_at = excluded.last_synced_at`,
        serverId,
        session.session_id,
        session.title ?? null,
        session.working_dir ?? null,
        session.status ?? null,
        session.live_state ?? null,
        session.saved ? 1 : 0,
        session.save_label ?? null,
        session.archived ? 1 : 0,
        session.updated_at_ms ?? null,
        session.transcript_bytes ?? null,
          now,
        );
      }
    }),
  );
}

export async function updateSessionLiveState(
  serverId: string,
  sessionId: string,
  liveState: 'working' | 'ready' | null,
  title?: string,
): Promise<void> {
  await db().runAsync(
    `UPDATE sessions SET live_state = ?, last_synced_at = ?${title ? ', title = ?' : ''}
     WHERE server_id = ? AND session_id = ?`,
    ...(title
      ? [liveState, Date.now(), title, serverId, sessionId]
      : [liveState, Date.now(), serverId, sessionId]),
  );
}

/* ---------------------------------------------------------------- messages */

export async function loadCachedMessages(
  serverId: string,
  sessionId: string,
  limit = 200,
): Promise<{ messages: HistoryMessage[]; total: number }> {
  const rows = await db().getAllAsync<{
    idx: number;
    role: string;
    content: string;
    stats_json: string | null;
  }>(
    'SELECT idx, role, content, stats_json FROM messages WHERE server_id = ? AND session_id = ? ORDER BY idx DESC LIMIT ?',
    serverId,
    sessionId,
    limit,
  );
  const messages = rows
    .slice()
    .reverse()
    .map((row) => ({
      index: row.idx,
      role: row.role,
      content: row.content,
      ...(row.stats_json ? { response_stats: JSON.parse(row.stats_json) as HistoryMessage['response_stats'] } : null),
    }));
  const count = await db().getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM messages WHERE server_id = ? AND session_id = ?',
    serverId,
    sessionId,
  );
  return { messages, total: count?.count ?? messages.length };
}

export async function upsertMessages(
  serverId: string,
  sessionId: string,
  messages: HistoryMessage[],
): Promise<void> {
  if (!messages.length) return;
  const now = Date.now();
  await serialized(async () => {
    await db().withTransactionAsync(async () => {
      for (const message of messages) {
      const bytes = roughBytes(message.content);
        await db().runAsync(
          `INSERT INTO messages (server_id, session_id, idx, role, content, stats_json, bytes, cached_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id, session_id, idx) DO UPDATE SET
             role = excluded.role, content = excluded.content, stats_json = excluded.stats_json,
             bytes = excluded.bytes, cached_at = excluded.cached_at`,
          serverId,
          sessionId,
          message.index,
          message.role,
          message.content,
          message.response_stats ? JSON.stringify(message.response_stats) : null,
          bytes,
          now,
        );
      }
      // Per-session bound: keep only the most recent rows.
      await db().runAsync(
        `DELETE FROM messages WHERE server_id = ? AND session_id = ? AND idx NOT IN (
           SELECT idx FROM messages WHERE server_id = ? AND session_id = ? ORDER BY idx DESC LIMIT ?
         )`,
        serverId,
        sessionId,
        serverId,
        sessionId,
        MESSAGE_ROW_LIMIT,
      );
    });
    await trimGlobalCache(serverId, sessionId);
  });
}

async function trimGlobalCache(protectedServerId: string, protectedSessionId: string): Promise<void> {
  const total = await db().getFirstAsync<{ bytes: number }>(
    'SELECT COALESCE(SUM(bytes), 0) as bytes FROM messages',
  );
  if ((total?.bytes ?? 0) <= budgets.textCacheBytes) return;
  const sessions = await db().getAllAsync<{
    server_id: string;
    session_id: string;
    bytes: number;
    newest: number;
  }>(
    `SELECT server_id, session_id, SUM(bytes) as bytes, MAX(cached_at) as newest
     FROM messages GROUP BY server_id, session_id ORDER BY newest ASC`,
  );
  let remaining = total?.bytes ?? 0;
  for (const session of sessions) {
    if (remaining <= budgets.textCacheBytes) break;
    if (session.server_id === protectedServerId && session.session_id === protectedSessionId) continue;
    const protectedDraft = await db().getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM drafts WHERE server_id = ? AND session_id = ?',
      session.server_id,
      session.session_id,
    );
    const protectedPending = await db().getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM pending_sends WHERE server_id = ? AND session_id = ?',
      session.server_id,
      session.session_id,
    );
    if ((protectedDraft?.count ?? 0) > 0 || (protectedPending?.count ?? 0) > 0) continue;
    await db().runAsync(
      'DELETE FROM messages WHERE server_id = ? AND session_id = ?',
      session.server_id,
      session.session_id,
    );
    remaining -= session.bytes;
  }
}

export async function clearCachedConversation(serverId: string, sessionId: string): Promise<void> {
  await db().runAsync('DELETE FROM messages WHERE server_id = ? AND session_id = ?', serverId, sessionId);
}

export async function clearServerCache(serverId: string): Promise<void> {
  await serialized(() =>
    db().withTransactionAsync(async () => {
      await db().runAsync('DELETE FROM messages WHERE server_id = ?', serverId);
      await db().runAsync('DELETE FROM sessions WHERE server_id = ?', serverId);
    }),
  );
}

export async function cacheStats(): Promise<{ bytes: number; sessions: number }> {
  const row = await db().getFirstAsync<{ bytes: number }>('SELECT COALESCE(SUM(bytes), 0) as bytes FROM messages');
  const sessions = await db().getFirstAsync<{ count: number }>(
    'SELECT COUNT(DISTINCT server_id || session_id) as count FROM messages',
  );
  return { bytes: row?.bytes ?? 0, sessions: sessions?.count ?? 0 };
}

/* ------------------------------------------------------------------ drafts */

export async function getDraft(serverId: string, sessionId: string): Promise<string> {
  const row = await db().getFirstAsync<{ content: string }>(
    'SELECT content FROM drafts WHERE server_id = ? AND session_id = ?',
    serverId,
    sessionId,
  );
  return row?.content ?? '';
}

export async function setDraft(serverId: string, sessionId: string, content: string): Promise<void> {
  if (content.trim().length === 0) {
    await db().runAsync('DELETE FROM drafts WHERE server_id = ? AND session_id = ?', serverId, sessionId);
    return;
  }
  await db().runAsync(
    `INSERT INTO drafts (server_id, session_id, content, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(server_id, session_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    serverId,
    sessionId,
    content,
    Date.now(),
  );
}

/* --------------------------------------------------------------- bookmarks */

export async function getBookmark(
  serverId: string,
  sessionId: string,
): Promise<{ messageIndex: number; fingerprint: string } | null> {
  const row = await db().getFirstAsync<{ message_index: number; fingerprint: string }>(
    'SELECT message_index, fingerprint FROM bookmarks WHERE server_id = ? AND session_id = ?',
    serverId,
    sessionId,
  );
  return row ? { messageIndex: row.message_index, fingerprint: row.fingerprint } : null;
}

export async function setBookmark(
  serverId: string,
  sessionId: string,
  messageIndex: number,
  fingerprint: string,
): Promise<void> {
  await db().runAsync(
    `INSERT INTO bookmarks (server_id, session_id, message_index, fingerprint, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_id, session_id) DO UPDATE SET
       message_index = excluded.message_index, fingerprint = excluded.fingerprint, updated_at = excluded.updated_at`,
    serverId,
    sessionId,
    messageIndex,
    fingerprint,
    Date.now(),
  );
}

/* ---------------------------------------------------------- pending sends */

export interface PendingSendRow {
  client_message_id: string;
  content: string;
  state: string;
  error: string | null;
  created_at: number;
}

export async function savePendingSend(
  serverId: string,
  sessionId: string,
  row: PendingSendRow,
): Promise<void> {
  await db().runAsync(
    `INSERT INTO pending_sends (server_id, session_id, client_message_id, content, state, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, session_id, client_message_id) DO UPDATE SET
       state = excluded.state, error = excluded.error`,
    serverId,
    sessionId,
    row.client_message_id,
    row.content,
    row.state,
    row.error,
    row.created_at,
  );
}

export async function listPendingSends(serverId: string, sessionId: string): Promise<PendingSendRow[]> {
  return db().getAllAsync<PendingSendRow>(
    'SELECT client_message_id, content, state, error, created_at FROM pending_sends WHERE server_id = ? AND session_id = ? ORDER BY created_at ASC',
    serverId,
    sessionId,
  );
}

export async function deletePendingSend(
  serverId: string,
  sessionId: string,
  clientMessageId: string,
): Promise<void> {
  await db().runAsync(
    'DELETE FROM pending_sends WHERE server_id = ? AND session_id = ? AND client_message_id = ?',
    serverId,
    sessionId,
    clientMessageId,
  );
}

/* ------------------------------------------------------------------- prefs */

export async function getPref(key: string): Promise<string | null> {
  const row = await db().getFirstAsync<{ value: string }>('SELECT value FROM prefs WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setPref(key: string, value: string): Promise<void> {
  await db().runAsync(
    `INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

function roughBytes(value: string): number {
  return value.length * 2 + 64;
}
