import * as SQLite from 'expo-sqlite';

import { budgets } from '../../design/tokens';
import type { HistoryMessage, SessionInfo } from '../protocol/frames';
import type { ComposerImage } from '../state/store';
import { splitLegacyReasoning } from '../protocol/reasoning';

const DB_NAME = 'jcode-mobile.db';
const MESSAGE_ROW_LIMIT = 500;

/** Max serialized bytes (content + images_json + meta) allowed per pending send. */
export const PENDING_SEND_PAYLOAD_LIMIT_BYTES = 1 * 1024 * 1024;
/** Durable unsent-work budget (pending_sends, all scopes) — separate from transcript cap. */
export const PENDING_SEND_BUDGET_BYTES = 2 * 1024 * 1024;

/** Typed admission error. Callers must preserve the draft and show the message. */
export class PendingAdmissionError extends Error {
  readonly code: 'PAYLOAD_TOO_LARGE' | 'PENDING_BUDGET_EXCEEDED';
  constructor(code: 'PAYLOAD_TOO_LARGE' | 'PENDING_BUDGET_EXCEEDED', message: string) {
    super(message);
    this.name = 'PendingAdmissionError';
    this.code = code;
  }
}

/**
 * Delivery lifecycle order for pending sends (R02/R04).
 * `accepted`/`rejected` are terminal — no later state may overwrite them.
 * `unconfirmed` ranks last (lost-after-write) so it can only be reached forward.
 * Unknown states stay unknown (rank -1 -> never advanced by the helper).
 */
export const DELIVERY_STATE_ORDER = [
  'draft',
  'sending',
  'sent_to_server',
  'queued',
  'added',
  'accepted',
  'rejected',
  'unconfirmed',
] as const;

export type DeliveryState = (typeof DELIVERY_STATE_ORDER)[number];

const TERMINAL_DELIVERY_STATES = new Set(['accepted', 'rejected']);

export function deliveryStateRank(state: string): number {
  const index = (DELIVERY_STATE_ORDER as readonly string[]).indexOf(state);
  return index === -1 ? -1 : index;
}

/**
 * Monotonic transition helper (R02). Never regresses: forward-only, terminal
 * states never move, unknown current/next stays unknown.
 */
export function nextDeliveryState(current: string, next: string): string {
  const currentRank = deliveryStateRank(current);
  const nextRank = deliveryStateRank(next);
  // Unknown stays unknown.
  if (currentRank === -1 || nextRank === -1) return current;
  // accepted/rejected are terminal.
  if (TERMINAL_DELIVERY_STATES.has(current)) return current;
  // No regression, no self-transition.
  return nextRank > currentRank ? next : current;
}

/** Exact UTF-8 byte length of a string (Hermes-safe, no TextEncoder needed). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Serialized byte cost of a messages row: text + stats + meta (incl. images). */
export function serializedMessagesRowBytes(
  content: string,
  statsJson: string | null | undefined,
  metaJson: string | null | undefined,
): number {
  return (
    utf8ByteLength(content) +
    utf8ByteLength(statsJson ?? '') +
    utf8ByteLength(metaJson ?? '')
  );
}

export interface PendingSendMeta {
  imageCount: number;
  imageNames: string[];
  imageMediaTypes: string[];
}

function pendingSendMetaOf(images: ComposerImage[] | undefined): PendingSendMeta | null {
  if (!images?.length) return null;
  return {
    imageCount: images.length,
    imageNames: images.map((image) => image.name),
    imageMediaTypes: images.map((image) => image.mediaType),
  };
}

/** Serialized byte cost of a pending-send row (content + images + meta). */
export function pendingSendRowBytes(row: {
  content: string;
  images?: ComposerImage[];
  meta?: PendingSendMeta | null;
}): number {
  return (
    utf8ByteLength(row.content) +
    (row.images?.length ? utf8ByteLength(JSON.stringify(row.images)) : 0) +
    (row.meta ? utf8ByteLength(JSON.stringify(row.meta)) : 0)
  );
}

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
        cached_total INTEGER,
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
        kind TEXT NOT NULL DEFAULT 'message',
        error TEXT,
        created_at INTEGER NOT NULL,
        images_json TEXT,
        PRIMARY KEY (server_id, session_id, client_message_id)
      );
      CREATE TABLE IF NOT EXISTS prefs (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 2;
    `);
  }
  try {
    await db.execAsync("ALTER TABLE pending_sends ADD COLUMN kind TEXT NOT NULL DEFAULT 'message'");
  } catch {
    // Existing database already has the column.
  }
  try {
    await db.execAsync('ALTER TABLE pending_sends ADD COLUMN images_json TEXT');
  } catch {
    // Existing database already has the column.
  }
  await migrateDatabase(db);
  const messageColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info('messages')",
  );
  if (!messageColumns.some((column) => column.name === 'meta_json')) {
    await db.execAsync('ALTER TABLE messages ADD COLUMN meta_json TEXT');
  }
  const sessionColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info('sessions')",
  );
  if (!sessionColumns.some((column) => column.name === 'cached_total')) {
    await db.execAsync('ALTER TABLE sessions ADD COLUMN cached_total INTEGER');
  }
  database = db;
  return db;
}

/** Test-only: replace the connection with an in-memory database. */
export async function openDatabaseForTests(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(':memory:');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  // Full post-migration schema (migrateDatabase is exercised separately).
  await db.execAsync(`
    CREATE TABLE servers (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, tls INTEGER NOT NULL, device_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_connected_at INTEGER, daemon_version TEXT, capabilities_json TEXT);
    CREATE TABLE sessions (server_id TEXT NOT NULL, session_id TEXT NOT NULL, title TEXT, working_dir TEXT, status TEXT, live_state TEXT, saved INTEGER NOT NULL DEFAULT 0, save_label TEXT, archived INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER, transcript_bytes INTEGER, cached_total INTEGER, last_synced_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE messages (server_id TEXT NOT NULL, session_id TEXT NOT NULL, idx INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, stats_json TEXT, meta_json TEXT, bytes INTEGER NOT NULL, cached_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id, idx));
    CREATE TABLE drafts (server_id TEXT NOT NULL, session_id TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE drafts_revisions (server_id TEXT NOT NULL, session_id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE bookmarks (server_id TEXT NOT NULL, session_id TEXT NOT NULL, message_index INTEGER NOT NULL, fingerprint TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE pending_sends (server_id TEXT NOT NULL, session_id TEXT NOT NULL, client_message_id TEXT NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'message', error TEXT, created_at INTEGER NOT NULL, images_json TEXT, transcript_ref TEXT, meta TEXT, payload_ref TEXT, PRIMARY KEY (server_id, session_id, client_message_id));
    CREATE TABLE history_revisions (server_id TEXT NOT NULL, session_id TEXT NOT NULL, revision INTEGER NOT NULL, total INTEGER NOT NULL, genesis_fingerprint TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (server_id, session_id));
    CREATE TABLE prefs (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);
  database = db;
  return db;
}

/* -------------------------------------------------------- schema migration */

/**
 * Additive migrations for reliability issues R05/R11/R17/R29. Idempotent:
 * each step checks column/table presence first, so re-running on an upgraded
 * database (or a database with inaccurate pre-fix byte counts) is safe.
 */
export async function migrateDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  const pendingColumns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info('pending_sends')",
  );
  const pendingNames = new Set(pendingColumns.map((column) => column.name));
  if (!pendingNames.has('transcript_ref')) {
    await db.execAsync('ALTER TABLE pending_sends ADD COLUMN transcript_ref TEXT');
  }
  if (!pendingNames.has('meta')) {
    await db.execAsync('ALTER TABLE pending_sends ADD COLUMN meta TEXT');
  }
  if (!pendingNames.has('payload_ref')) {
    await db.execAsync('ALTER TABLE pending_sends ADD COLUMN payload_ref TEXT');
  }
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS history_revisions (
      server_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      total INTEGER NOT NULL,
      genesis_fingerprint TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS drafts_revisions (
      server_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, session_id)
    );
  `);
  // Lazy byte recount (R29): recompute serialized lengths for pre-fix rows.
  // CAST_LENGTH counts bytes; running this twice yields the same result.
  await recountSerializedBytesOn(db);
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
      for (const table of [
        'sessions',
        'messages',
        'drafts',
        'drafts_revisions',
        'bookmarks',
        'pending_sends',
        'history_revisions',
      ]) {
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

/** Persist an authoritative title for the exact server/session. */
export async function updateSessionTitle(
  serverId: string,
  sessionId: string,
  title: string | null,
): Promise<void> {
  await db().runAsync(
    'UPDATE sessions SET title = ?, last_synced_at = ? WHERE server_id = ? AND session_id = ?',
    title,
    Date.now(),
    serverId,
    sessionId,
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
    meta_json: string | null;
  }>(
    'SELECT idx, role, content, stats_json, meta_json FROM messages WHERE server_id = ? AND session_id = ? ORDER BY idx DESC LIMIT ?',
    serverId,
    sessionId,
    limit,
  );
  const messages = rows
    .slice()
    .reverse()
    .map((row) => {
      const meta = row.meta_json
        ? (JSON.parse(row.meta_json) as Partial<HistoryMessage>)
        : null;
      const legacy =
        row.role === 'assistant' && !meta?.reasoning
          ? splitLegacyReasoning(row.content)
          : null;
      return {
        index: row.idx,
        role: row.role,
        content: legacy ? legacy.content : row.content,
        ...(row.stats_json
          ? { response_stats: JSON.parse(row.stats_json) as HistoryMessage['response_stats'] }
          : null),
        ...(meta ?? null),
        ...(legacy?.reasoning && !meta?.reasoning ? { reasoning: legacy.reasoning } : null),
      };
    });
  const cachedTotal = await db().getFirstAsync<{ cached_total: number | null }>(
    'SELECT cached_total FROM sessions WHERE server_id = ? AND session_id = ?',
    serverId,
    sessionId,
  );
  // The row count is not the transcript length: the cache keeps only the most
  // recent window. Prefer the authoritative total recorded with the snapshot.
  const total =
    typeof cachedTotal?.cached_total === 'number'
      ? Math.max(cachedTotal.cached_total, messages.length)
      : messages.length;
  return { messages, total };
}

export async function upsertMessages(
  serverId: string,
  sessionId: string,
  messages: HistoryMessage[],
  totalMessages?: number,
): Promise<void> {
  if (!messages.length) return;
  const now = Date.now();
  const maxIndex = messages.reduce((max, message) => Math.max(max, message.index), -1);
  await serialized(async () => {
    await db().withTransactionAsync(async () => {
      for (const message of messages) {
        const meta = {
          ...(message.reasoning ? { reasoning: message.reasoning } : null),
          ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : null),
          ...(message.tool_data ? { tool_data: message.tool_data } : null),
          ...(message.images?.length ? { images: message.images } : null),
        };
        const metaJson = Object.keys(meta).length ? JSON.stringify(meta) : null;
        const statsJson = message.response_stats
          ? JSON.stringify(message.response_stats)
          : null;
        const bytes = serializedMessagesRowBytes(message.content, statsJson, metaJson);
        await db().runAsync(
          `INSERT INTO messages (server_id, session_id, idx, role, content, stats_json, meta_json, bytes, cached_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id, session_id, idx) DO UPDATE SET
             role = excluded.role, content = excluded.content, stats_json = excluded.stats_json,
             meta_json = excluded.meta_json, bytes = excluded.bytes, cached_at = excluded.cached_at`,
          serverId,
          sessionId,
          message.index,
          message.role,
          message.content,
          statsJson,
          metaJson,
          bytes,
          now,
        );
      }
      // An authoritative snapshot also removes a deleted/rewound tail.
      await db().runAsync(
        'DELETE FROM messages WHERE server_id = ? AND session_id = ? AND idx > ?',
        serverId,
        sessionId,
        maxIndex,
      );
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
      if (typeof totalMessages === 'number') {
        await db().runAsync(
          'UPDATE sessions SET cached_total = ? WHERE server_id = ? AND session_id = ?',
          totalMessages,
          serverId,
          sessionId,
        );
      }
    });
    await trimGlobalCache();
  });
}

async function trimGlobalCache(): Promise<void> {
  // Two-tier budget (R29): evictable transcript pages share one 32 MiB cap
  // (budgets.textCacheBytes). Durable unsent work (pending_sends, drafts) is
  // capped separately at PENDING_SEND_BUDGET_BYTES and NEVER evicted here —
  // the trim only removes messages rows, oldest first, even for the active /
  // draft-bearing session (older cached pages are re-fetchable). Pending IDs
  // and their attachments survive every branch below.
  const cap = budgets.textCacheBytes;
  const snapshot = async (): Promise<{ bytes: number; sessions: Array<{
    server_id: string;
    session_id: string;
    bytes: number;
    newest: number;
    rows: number;
  }> }> => {
    const total = await db().getFirstAsync<{ bytes: number }>(
      'SELECT COALESCE(SUM(bytes), 0) as bytes FROM messages',
    );
    const sessions = await db().getAllAsync<{
      server_id: string;
      session_id: string;
      bytes: number;
      newest: number;
      rows: number;
    }>(
      `SELECT server_id, session_id, SUM(bytes) as bytes, MAX(cached_at) as newest, COUNT(*) as rows
       FROM messages GROUP BY server_id, session_id ORDER BY newest ASC`,
    );
    return { bytes: total?.bytes ?? 0, sessions };
  };
  let { bytes, sessions } = await snapshot();
  // Bounded batches: each iteration removes the oldest rows of the oldest
  // session, so the loop always makes progress and cannot spin on a session
  // that is entirely protected work (pending/draft rows are never here).
  for (let batch = 0; batch < 200 && bytes > cap && sessions.length > 0; batch += 1) {
    const target = sessions[0];
    const removeRows = Math.max(1, Math.ceil(target.rows / 4));
    await db().runAsync(
      `DELETE FROM messages WHERE server_id = ? AND session_id = ? AND idx IN (
         SELECT idx FROM messages WHERE server_id = ? AND session_id = ? ORDER BY idx ASC LIMIT ?
       )`,
      target.server_id,
      target.session_id,
      target.server_id,
      target.session_id,
      removeRows,
    );
    // Image payloads live inline in meta_json, so pruning the row also
    // removes its orphaned meta images — no separate blob cleanup needed.
    ({ bytes, sessions } = await snapshot());
  }
}

export async function clearCachedConversation(serverId: string, sessionId: string): Promise<void> {
  await db().runAsync('DELETE FROM messages WHERE server_id = ? AND session_id = ?', serverId, sessionId);
}

export async function clearServerCache(serverId: string): Promise<void> {
  await serialized(() =>
    db().withTransactionAsync(async () => {
      await db().runAsync('DELETE FROM messages WHERE server_id = ?', serverId);
      await db().runAsync('DELETE FROM history_revisions WHERE server_id = ?', serverId);
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

/**
 * Lazy recount of serialized message bytes (R29). Idempotent: recomputing
 * from the same content always yields the same stored value, so initDatabase
 * can call this on every upgrade without drifting.
 */
export async function recountSerializedBytes(): Promise<void> {
  await recountSerializedBytesOn(db());
}

async function recountSerializedBytesOn(handle: SQLite.SQLiteDatabase): Promise<void> {
  await handle.runAsync(
    `UPDATE messages SET bytes =
       length(CAST(content AS BLOB))
       + CASE WHEN stats_json IS NULL OR stats_json = '' THEN 0 ELSE length(CAST(stats_json AS BLOB)) END
       + CASE WHEN meta_json IS NULL OR meta_json = '' THEN 0 ELSE length(CAST(meta_json AS BLOB)) END`,
  );
}

/** Global cache accounting split by evictable vs durable-unsent work (R29). */
export async function cacheBytesDetailed(): Promise<{
  transcriptBytes: number;
  pendingBytes: number;
  pendingCount: number;
}> {
  const transcript = await db().getFirstAsync<{ bytes: number }>(
    'SELECT COALESCE(SUM(bytes), 0) as bytes FROM messages',
  );
  const pendingRows = await db().getAllAsync<{
    content: string;
    images_json: string | null;
  }>('SELECT content, images_json FROM pending_sends');
  let pendingBytes = 0;
  for (const row of pendingRows) {
    pendingBytes += utf8ByteLength(row.content) + utf8ByteLength(row.images_json ?? '');
  }
  return {
    transcriptBytes: transcript?.bytes ?? 0,
    pendingBytes,
    pendingCount: pendingRows.length,
  };
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

/* ----------------------------------------------------- draft revisions (R10) */

/**
 * Guarded draft revisions (R10): every draft write carries the revision it
 * was based on. A stale writer (e.g. a debounced save from a previously
 * active editor) cannot overwrite a newer draft.
 */
export async function getDraftRev(
  serverId: string,
  sessionId: string,
): Promise<{ content: string; revision: number }> {
  const row = await db().getFirstAsync<{ revision: number; content: string }>(
    'SELECT revision, content FROM drafts_revisions WHERE server_id = ? AND session_id = ?',
    serverId,
    sessionId,
  );
  if (row) return { content: row.content, revision: row.revision };
  // Fall back to the legacy drafts table so pre-revision drafts still load.
  const legacy = await getDraft(serverId, sessionId);
  return { content: legacy, revision: 0 };
}

/**
 * Guarded draft write. When `expectedRevision` is given and does not match
 * the stored revision, nothing is written and `false` is returned.
 */
export async function setDraftRev(
  serverId: string,
  sessionId: string,
  content: string,
  expectedRevision?: number,
): Promise<boolean> {
  const current = await getDraftRev(serverId, sessionId);
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    return false;
  }
  const revision = current.revision + 1;
  await serialized(() =>
    db().withTransactionAsync(async () => {
      if (content.trim().length === 0) {
        await db().runAsync(
          'DELETE FROM drafts WHERE server_id = ? AND session_id = ?',
          serverId,
          sessionId,
        );
        await db().runAsync(
          'DELETE FROM drafts_revisions WHERE server_id = ? AND session_id = ?',
          serverId,
          sessionId,
        );
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
      await db().runAsync(
        `INSERT INTO drafts_revisions (server_id, session_id, revision, content, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_id, session_id) DO UPDATE SET
           revision = excluded.revision, content = excluded.content, updated_at = excluded.updated_at`,
        serverId,
        sessionId,
        revision,
        content,
        Date.now(),
      );
    }),
  );
  return true;
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
  kind?: 'message' | 'guidance';
  error: string | null;
  created_at: number;
  images?: ComposerImage[];
  /** Authoritative committed transcript message id/index (R05); null on legacy rows. */
  transcript_ref?: string | null;
  /** Lightweight image metadata only — never image payload bytes. */
  meta?: PendingSendMeta | null;
  /** Inline-payload marker (`'inline'`) or null; reserved for external blobs. */
  payload_ref?: string | null;
}

interface PendingSendDbRow {
  client_message_id: string;
  content: string;
  state: string;
  kind: 'message' | 'guidance';
  error: string | null;
  created_at: number;
  images_json: string | null;
  transcript_ref: string | null;
  meta: string | null;
  payload_ref: string | null;
}

function mapPendingRow(row: PendingSendDbRow, withImages: boolean): PendingSendRow {
  let meta: PendingSendMeta | null = null;
  if (row.meta) {
    try {
      const parsed = JSON.parse(row.meta) as PendingSendMeta;
      meta = parsed && typeof parsed.imageCount === 'number' ? parsed : null;
    } catch {
      meta = null;
    }
  }
  let images: ComposerImage[] | undefined;
  if (withImages && row.images_json) {
    try {
      const parsed = JSON.parse(row.images_json) as ComposerImage[];
      images = Array.isArray(parsed) ? parsed : undefined;
    } catch {
      images = undefined;
    }
  }
  return {
    client_message_id: row.client_message_id,
    content: row.content,
    state: row.state,
    kind: row.kind,
    error: row.error,
    created_at: row.created_at,
    ...(images ? { images } : null),
    transcript_ref: row.transcript_ref ?? null,
    meta,
    payload_ref: row.payload_ref ?? null,
  };
}

/** Reject oversized payloads before anything is written (R29). */
function assertPendingSendWithinBudget(row: PendingSendRow): void {
  const size = pendingSendRowBytes({
    content: row.content,
    images: row.images,
    meta: pendingSendMetaOf(row.images),
  });
  if (size > PENDING_SEND_PAYLOAD_LIMIT_BYTES) {
    throw new PendingAdmissionError(
      'PAYLOAD_TOO_LARGE',
      `This message is too large to store safely on this phone (${size} bytes). Shorten it or remove images.`,
    );
  }
}

async function totalPendingBytesOn(handle: SQLite.SQLiteDatabase): Promise<number> {
  const rows = await handle.getAllAsync<{ content: string; images_json: string | null }>(
    'SELECT content, images_json FROM pending_sends',
  );
  let total = 0;
  for (const row of rows) {
    total += utf8ByteLength(row.content) + utf8ByteLength(row.images_json ?? '');
  }
  return total;
}

async function assertPendingBudgetAdmission(nextBytes: number): Promise<void> {
  const current = await totalPendingBytesOn(db());
  if (current + nextBytes > PENDING_SEND_BUDGET_BYTES) {
    throw new PendingAdmissionError(
      'PENDING_BUDGET_EXCEEDED',
      'Unsent messages on this phone are full. Review or dismiss them before sending more.',
    );
  }
}

export async function savePendingSend(
  serverId: string,
  sessionId: string,
  row: PendingSendRow,
): Promise<void> {
  assertPendingSendWithinBudget(row);
  const meta = pendingSendMetaOf(row.images);
  await db().runAsync(
    `INSERT INTO pending_sends (server_id, session_id, client_message_id, content, state, kind, error, created_at, images_json, transcript_ref, meta, payload_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, session_id, client_message_id) DO UPDATE SET
       state = excluded.state, kind = excluded.kind, error = excluded.error,
       images_json = COALESCE(excluded.images_json, pending_sends.images_json),
       transcript_ref = COALESCE(excluded.transcript_ref, pending_sends.transcript_ref),
       meta = COALESCE(excluded.meta, pending_sends.meta),
       payload_ref = COALESCE(excluded.payload_ref, pending_sends.payload_ref)`,
    serverId,
    sessionId,
    row.client_message_id,
    row.content,
    row.state,
    row.kind ?? 'message',
    row.error,
    row.created_at,
    row.images?.length ? JSON.stringify(row.images) : null,
    row.transcript_ref ?? null,
    meta ? JSON.stringify(meta) : null,
    row.images?.length ? 'inline' : null,
  );
}

/**
 * List pending sends WITHOUT image payloads (R04/R29): decoding stays bounded
 * when opening a conversation. Use getPendingSend for a single payload.
 */
export async function listPendingSends(serverId: string, sessionId: string): Promise<PendingSendRow[]> {
  const rows = await db().getAllAsync<PendingSendDbRow>(
    'SELECT client_message_id, content, state, kind, error, created_at, transcript_ref, meta, payload_ref, NULL AS images_json FROM pending_sends WHERE server_id = ? AND session_id = ? ORDER BY created_at ASC',
    serverId,
    sessionId,
  );
  return rows.map((row) => mapPendingRow(row, false));
}

/** Paged list variant — payload-free, bounded decode (R04/R29). */
export async function listPendingSendsPaged(
  serverId: string,
  sessionId: string,
  limit: number,
  offset: number,
): Promise<PendingSendRow[]> {
  const rows = await db().getAllAsync<PendingSendDbRow>(
    'SELECT client_message_id, content, state, kind, error, created_at, transcript_ref, meta, payload_ref, NULL AS images_json FROM pending_sends WHERE server_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?',
    serverId,
    sessionId,
    limit,
    offset,
  );
  return rows.map((row) => mapPendingRow(row, false));
}

/** Lazy single-row load including image payloads (R04/R29). */
export async function getPendingSend(
  serverId: string,
  sessionId: string,
  clientMessageId: string,
): Promise<PendingSendRow | null> {
  const row = await db().getFirstAsync<PendingSendDbRow>(
    'SELECT client_message_id, content, state, kind, error, created_at, images_json, transcript_ref, meta, payload_ref FROM pending_sends WHERE server_id = ? AND session_id = ? AND client_message_id = ?',
    serverId,
    sessionId,
    clientMessageId,
  );
  return row ? mapPendingRow(row, true) : null;
}

/** Persist the authoritative transcript reference for a receipt (R05). */
export async function setPendingSendTranscriptRef(
  serverId: string,
  sessionId: string,
  clientMessageId: string,
  transcriptRef: string,
): Promise<void> {
  await db().runAsync(
    'UPDATE pending_sends SET transcript_ref = ? WHERE server_id = ? AND session_id = ? AND client_message_id = ?',
    transcriptRef,
    serverId,
    sessionId,
    clientMessageId,
  );
}

/**
 * Monotonic state writer (R02/R04): applies nextDeliveryState so a late ACK
 * can never regress accepted/rejected back to sent_to_server. When
 * `expected` is given, the write is a compare-and-swap. Returns the resulting
 * state, or null when no such row exists (never creates).
 */
export async function setPendingSendStateGuarded(
  serverId: string,
  sessionId: string,
  clientMessageId: string,
  nextState: string,
  expected?: string,
): Promise<string | null> {
  return serialized(async () => {
    const current = await db().getFirstAsync<{ state: string }>(
      'SELECT state FROM pending_sends WHERE server_id = ? AND session_id = ? AND client_message_id = ?',
      serverId,
      sessionId,
      clientMessageId,
    );
    if (!current) return null;
    if (expected !== undefined && current.state !== expected) return current.state;
    const resolved = nextDeliveryState(current.state, nextState);
    if (resolved !== current.state) {
      await db().runAsync(
        'UPDATE pending_sends SET state = ? WHERE server_id = ? AND session_id = ? AND client_message_id = ?',
        resolved,
        serverId,
        sessionId,
        clientMessageId,
      );
    }
    return resolved;
  });
}

export interface StagePendingSendInput {
  clientMessageId: string;
  content: string;
  state: string;
  kind?: 'message' | 'guidance';
  createdAt: number;
  images?: ComposerImage[];
  transcriptRef?: string | null;
}

/**
 * Atomic stage (R02/R10): insert/update the pending row AND delete only the
 * draft for this exact (server, session) scope in ONE serialized transaction.
 * Payload/budget admission is checked first; on failure the draft is kept.
 */
export async function stagePendingSendTransaction(
  serverId: string,
  sessionId: string,
  row: StagePendingSendInput,
): Promise<void> {
  const pending: PendingSendRow = {
    client_message_id: row.clientMessageId,
    content: row.content,
    state: row.state,
    kind: row.kind,
    error: null,
    created_at: row.createdAt,
    ...(row.images ? { images: row.images } : null),
    transcript_ref: row.transcriptRef ?? null,
  };
  assertPendingSendWithinBudget(pending);
  await assertPendingBudgetAdmission(
    pendingSendRowBytes({ content: row.content, images: row.images, meta: pendingSendMetaOf(row.images) }),
  );
  const meta = pendingSendMetaOf(row.images);
  await serialized(() =>
    db().withTransactionAsync(async () => {
      await db().runAsync(
        `INSERT INTO pending_sends (server_id, session_id, client_message_id, content, state, kind, error, created_at, images_json, transcript_ref, meta, payload_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, session_id, client_message_id) DO UPDATE SET
           state = excluded.state, kind = excluded.kind,
           images_json = COALESCE(excluded.images_json, pending_sends.images_json),
           transcript_ref = COALESCE(excluded.transcript_ref, pending_sends.transcript_ref),
           meta = COALESCE(excluded.meta, pending_sends.meta),
           payload_ref = COALESCE(excluded.payload_ref, pending_sends.payload_ref)`,
        serverId,
        sessionId,
        pending.client_message_id,
        pending.content,
        pending.state,
        pending.kind ?? 'message',
        pending.error,
        pending.created_at,
        pending.images?.length ? JSON.stringify(pending.images) : null,
        pending.transcript_ref ?? null,
        meta ? JSON.stringify(meta) : null,
        pending.images?.length ? 'inline' : null,
      );
      // Only THIS scoped draft is cleared — other sessions/profiles keep theirs.
      await db().runAsync(
        'DELETE FROM drafts WHERE server_id = ? AND session_id = ?',
        serverId,
        sessionId,
      );
      await db().runAsync(
        'DELETE FROM drafts_revisions WHERE server_id = ? AND session_id = ?',
        serverId,
        sessionId,
      );
    }),
  );
}

export interface StageSendInput {
  clientMessageId: string;
  content: string;
  images?: ComposerImage[];
  kind?: 'message' | 'guidance';
  createdAt: number;
}

/**
 * Stage a new send atomically (R10): pending INSERT + scoped draft DELETE in
 * one serialized transaction BEFORE network dispatch. Throws
 * PendingAdmissionError when the payload exceeds 1 MiB or the 2 MiB durable
 * budget is full — in both cases the draft is preserved and nothing is sent.
 */
export async function stageSend(
  serverId: string,
  sessionId: string,
  input: StageSendInput,
): Promise<{ clientMessageId: string }> {
  await stagePendingSendTransaction(serverId, sessionId, {
    clientMessageId: input.clientMessageId,
    content: input.content,
    state: 'sending',
    kind: input.kind,
    createdAt: input.createdAt,
    ...(input.images ? { images: input.images } : null),
  });
  return { clientMessageId: input.clientMessageId };
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

/* ------------------------------------------------------- history revisions */

/**
 * Transcript lineage versions (R11). Each authoritative snapshot/page row
 * records its revision + total + genesis fingerprint so a delayed older
 * write can never overwrite the latest state.
 */
export async function getHistoryRevision(
  serverId: string,
  sessionId: string,
): Promise<{ revision: number; total: number; genesisFingerprint: string | null } | null> {
  const row = await db().getFirstAsync<{
    revision: number;
    total: number;
    genesis_fingerprint: string | null;
  }>('SELECT revision, total, genesis_fingerprint FROM history_revisions WHERE server_id = ? AND session_id = ?', serverId, sessionId);
  return row
    ? { revision: row.revision, total: row.total, genesisFingerprint: row.genesis_fingerprint }
    : null;
}

/**
 * Apply a history revision only when strictly newer than stored (R11).
 * Returns true when applied, false when the write was stale/duplicate.
 * On reset (newer total smaller than stored total, or genesis line changed)
 * cached rows beyond the new total are deleted.
 */
export async function upsertHistoryRevisionIfNewer(
  serverId: string,
  sessionId: string,
  revision: number,
  total: number,
  genesisFingerprint?: string | null,
): Promise<boolean> {
  return serialized(async () => {
    let applied = false;
    await db().withTransactionAsync(async () => {
      const stored = await db().getFirstAsync<{
        revision: number;
        total: number;
        genesis_fingerprint: string | null;
      }>('SELECT revision, total, genesis_fingerprint FROM history_revisions WHERE server_id = ? AND session_id = ?', serverId, sessionId);
      if (stored && revision <= stored.revision) return;
      // A genesis fingerprint change means a new lineage (compaction/clear):
      // rows past the authoritative total no longer describe this transcript.
      const lineChanged =
        !!stored &&
        !!stored.genesis_fingerprint &&
        !!genesisFingerprint &&
        stored.genesis_fingerprint !== genesisFingerprint;
      const reset = !!stored && (lineChanged || total < stored.total);
      await db().runAsync(
        `INSERT INTO history_revisions (server_id, session_id, revision, total, genesis_fingerprint, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, session_id) DO UPDATE SET
           revision = excluded.revision, total = excluded.total,
           genesis_fingerprint = excluded.genesis_fingerprint, updated_at = excluded.updated_at`,
        serverId,
        sessionId,
        revision,
        total,
        genesisFingerprint ?? null,
        Date.now(),
      );
      if (reset) {
        await db().runAsync(
          'DELETE FROM messages WHERE server_id = ? AND session_id = ? AND idx > ?',
          serverId,
          sessionId,
          total - 1,
        );
      }
      applied = true;
    });
    return applied;
  });
}

/** Drop the revision row only (messages/bookmarks are left to the caller). */
export async function clearTranscriptRevision(serverId: string, sessionId: string): Promise<void> {
  await serialized(() =>
    db().withTransactionAsync(async () => {
      await db().runAsync(
        'DELETE FROM history_revisions WHERE server_id = ? AND session_id = ?',
        serverId,
        sessionId,
      );
    }),
  );
}

/**
 * Invalidate an incompatible lineage after compaction/clear (R11): revision,
 * cached transcript rows and bookmarks are all cleared so nothing from the
 * old lineage can be merged into the new one. Pending sends are NOT touched
 * (durable unsent work survives lineage invalidation).
 */
export async function invalidateTranscriptLineage(serverId: string, sessionId: string): Promise<void> {
  await serialized(() =>
    db().withTransactionAsync(async () => {
      await db().runAsync(
        'DELETE FROM history_revisions WHERE server_id = ? AND session_id = ?',
        serverId,
        sessionId,
      );
      await db().runAsync(
        'DELETE FROM messages WHERE server_id = ? AND session_id = ?',
        serverId,
        sessionId,
      );
      await db().runAsync(
        'DELETE FROM bookmarks WHERE server_id = ? AND session_id = ?',
        serverId,
        sessionId,
      );
    }),
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
