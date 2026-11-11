use std::path::{Path, PathBuf};
use std::sync::Mutex;

use adapter_protocol::{DeviceInfo, OperationState, OperationView, Project};
use rusqlite::{Connection, OptionalExtension, params};
use tracing::info;

use crate::paths::{CoreError, CoreResult, ProjectRow, now_ms};

pub struct Store {
    conn: Mutex<Connection>,
    server_id: String,
    path: PathBuf,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store").field("path", &self.path).finish()
    }
}

impl Store {
    pub fn open(data_dir: &Path) -> CoreResult<std::sync::Arc<Self>> {
        std::fs::create_dir_all(data_dir)?;
        let path = data_dir.join("adapter-v2.sqlite3");
        let conn = Connection::open(&path)?;
        Self::initialize(conn, path)
    }

    pub fn open_in_memory() -> CoreResult<std::sync::Arc<Self>> {
        let conn = Connection::open_in_memory()?;
        Self::initialize(conn, PathBuf::from(":memory:"))
    }

    fn initialize(conn: Connection, path: PathBuf) -> CoreResult<std::sync::Arc<Self>> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                name TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                created_at_ms INTEGER NOT NULL,
                last_seen_at_ms INTEGER,
                revoked_at_ms INTEGER
             );
             CREATE INDEX IF NOT EXISTS idx_devices_server ON devices(server_id, revoked_at_ms);
             CREATE TABLE IF NOT EXISTS pairing_codes (
                code_hash TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                expires_at_ms INTEGER NOT NULL,
                used_at_ms INTEGER
             );
             CREATE TABLE IF NOT EXISTS operations (
                operation_id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                body TEXT NOT NULL,
                state TEXT NOT NULL,
                turn_id TEXT,
                expected_turn_id TEXT,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_operations_session ON operations(server_id, session_id, updated_at_ms DESC);
             CREATE TABLE IF NOT EXISTS session_create_requests (
                client_request_id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS projects (
                project_id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                label TEXT NOT NULL,
                path TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at_ms INTEGER NOT NULL,
                UNIQUE(server_id, path)
             );
             CREATE TABLE IF NOT EXISTS session_titles (
                session_id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                title TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS session_projects (
                session_id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                project_id TEXT NOT NULL
             );",
        )?;
        let server_id = match conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'server_id'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            Some(id) => id,
            None => {
                let id = format!("srv_{}", uuid::Uuid::new_v4().simple());
                conn.execute(
                    "INSERT INTO meta(key, value) VALUES('server_id', ?1)",
                    params![id],
                )?;
                id
            }
        };
        info!(path = %path.display(), server_id = %server_id, "adapter store ready");
        Ok(std::sync::Arc::new(Self {
            conn: Mutex::new(conn),
            server_id,
            path,
        }))
    }

    pub fn server_id(&self) -> &str {
        &self.server_id
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    // ------------------------------------------------------------------
    // Pairing and devices
    // ------------------------------------------------------------------

    pub fn replace_pairing_code(&self, code_hash: &str, ttl_ms: i64) -> CoreResult<()> {
        let conn = self.conn.lock().expect("store lock");
        let now = now_ms();
        conn.execute(
            "UPDATE pairing_codes SET used_at_ms = ?1 WHERE server_id = ?2 AND used_at_ms IS NULL",
            params![now, self.server_id],
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO pairing_codes(code_hash, server_id, created_at_ms, expires_at_ms, used_at_ms)
             VALUES(?1, ?2, ?3, ?4, NULL)",
            params![code_hash, self.server_id, now, now + ttl_ms],
        )?;
        Ok(())
    }

    /// Atomically consume a pairing code and create a device. The caller
    /// supplies an already-hashed code and token; secrets never enter SQLite.
    pub fn redeem_pairing_code(
        &self,
        code_hash: &str,
        token_hash: &str,
        device_name: &str,
    ) -> CoreResult<DeviceInfo> {
        let mut conn = self.conn.lock().expect("store lock");
        let tx = conn.transaction()?;
        let now = now_ms();
        let row: Option<(i64, Option<i64>)> = tx
            .query_row(
                "SELECT expires_at_ms, used_at_ms FROM pairing_codes WHERE code_hash = ?1 AND server_id = ?2",
                params![code_hash, self.server_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((expires, used)) = row else {
            return Err(CoreError::NotFound("pairing code".into()));
        };
        if used.is_some() {
            return Err(CoreError::Conflict("pairing code was already used".into()));
        }
        if expires <= now {
            return Err(CoreError::Conflict("pairing code expired".into()));
        }
        tx.execute(
            "UPDATE pairing_codes SET used_at_ms = ?1 WHERE code_hash = ?2",
            params![now, code_hash],
        )?;
        let device_id = format!("dev_{}", uuid::Uuid::new_v4().simple());
        let name: String = device_name.trim().chars().take(80).collect();
        let name = if name.is_empty() {
            "Mobile device".to_string()
        } else {
            name
        };
        tx.execute(
            "INSERT INTO devices(device_id, server_id, name, token_hash, created_at_ms, last_seen_at_ms, revoked_at_ms)
             VALUES(?1, ?2, ?3, ?4, ?5, ?5, NULL)",
            params![device_id, self.server_id, name, token_hash, now],
        )?;
        tx.commit()?;
        Ok(DeviceInfo {
            device_id,
            name,
            created_at_ms: now,
            last_seen_at_ms: Some(now),
        })
    }

    pub fn device_by_token_hash(&self, token_hash: &str) -> CoreResult<Option<DeviceInfo>> {
        let conn = self.conn.lock().expect("store lock");
        let device = conn
            .query_row(
                "SELECT device_id, name, created_at_ms, last_seen_at_ms FROM devices
                 WHERE token_hash = ?1 AND server_id = ?2 AND revoked_at_ms IS NULL",
                params![token_hash, self.server_id],
                |row| {
                    Ok(DeviceInfo {
                        device_id: row.get(0)?,
                        name: row.get(1)?,
                        created_at_ms: row.get(2)?,
                        last_seen_at_ms: row.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(device)
    }

    pub fn touch_device(&self, device_id: &str) -> CoreResult<()> {
        let conn = self.conn.lock().expect("store lock");
        conn.execute(
            "UPDATE devices SET last_seen_at_ms = ?1 WHERE device_id = ?2 AND server_id = ?3",
            params![now_ms(), device_id, self.server_id],
        )?;
        Ok(())
    }

    pub fn revoke_device(&self, device_id: &str) -> CoreResult<bool> {
        let conn = self.conn.lock().expect("store lock");
        let changed = conn.execute(
            "UPDATE devices SET revoked_at_ms = ?1 WHERE device_id = ?2 AND server_id = ?3 AND revoked_at_ms IS NULL",
            params![now_ms(), device_id, self.server_id],
        )?;
        Ok(changed > 0)
    }

    pub fn list_devices(&self) -> CoreResult<Vec<DeviceInfo>> {
        let conn = self.conn.lock().expect("store lock");
        let mut stmt = conn.prepare(
            "SELECT device_id, name, created_at_ms, last_seen_at_ms FROM devices
             WHERE server_id = ?1 AND revoked_at_ms IS NULL ORDER BY created_at_ms ASC",
        )?;
        let rows = stmt.query_map(params![self.server_id], |row| {
            Ok(DeviceInfo {
                device_id: row.get(0)?,
                name: row.get(1)?,
                created_at_ms: row.get(2)?,
                last_seen_at_ms: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn is_device_revoked(&self, device_id: &str) -> CoreResult<bool> {
        let conn = self.conn.lock().expect("store lock");
        let revoked: Option<Option<i64>> = conn
            .query_row(
                "SELECT revoked_at_ms FROM devices WHERE device_id = ?1 AND server_id = ?2",
                params![device_id, self.server_id],
                |row| row.get(0),
            )
            .optional()?;
        match revoked {
            None => Ok(true),
            Some(None) => Ok(false),
            Some(Some(_)) => Ok(true),
        }
    }

    // ------------------------------------------------------------------
    // Operations
    // ------------------------------------------------------------------

    fn operation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OperationView> {
        let state: String = row.get("state")?;
        Ok(OperationView {
            operation_id: row.get("operation_id")?,
            session_id: row.get("session_id")?,
            turn_id: row.get("turn_id")?,
            state: serde_json::from_value(serde_json::Value::String(state))
                .unwrap_or(OperationState::Unknown),
            error_code: row.get("error_code")?,
            error_message: row.get("error_message")?,
            created_at_ms: row.get("created_at_ms")?,
            updated_at_ms: row.get("updated_at_ms")?,
        })
    }

    pub fn reserve_operation(
        &self,
        operation_id: &str,
        session_id: &str,
        kind: &str,
        body: &str,
        expected_turn_id: Option<&str>,
    ) -> CoreResult<(OperationView, bool)> {
        let conn = self.conn.lock().expect("store lock");
        let existing = conn
            .query_row(
                "SELECT * FROM operations WHERE operation_id = ?1",
                params![operation_id],
                Self::operation_from_row,
            )
            .optional()?;
        if let Some(existing) = existing {
            let matches = existing.session_id == session_id;
            if !matches {
                return Err(CoreError::Conflict(
                    "operation id was already used for another session".into(),
                ));
            }
            let existing_body: String = conn.query_row(
                "SELECT body FROM operations WHERE operation_id = ?1",
                params![operation_id],
                |row| row.get(0),
            )?;
            if existing_body != body {
                return Err(CoreError::Conflict(
                    "operation id was already used with a different request body".into(),
                ));
            }
            return Ok((existing, true));
        }
        let existing_session_op: Option<String> = conn
            .query_row(
                "SELECT operation_id FROM operations WHERE server_id = ?1 AND session_id = ?2
                 AND state IN ('staged','reserved','dispatching','accepted') AND operation_id <> ?3
                 ORDER BY created_at_ms DESC LIMIT 1",
                params![self.server_id, session_id, operation_id],
                |row| row.get(0),
            )
            .optional()?;
        if existing_session_op.is_some() {
            return Err(CoreError::Conflict(
                "another operation is already in flight for this session".into(),
            ));
        }
        let now = now_ms();
        conn.execute(
            "INSERT INTO operations(operation_id, server_id, session_id, kind, body, state, turn_id,
                expected_turn_id, error_code, error_message, created_at_ms, updated_at_ms)
             VALUES(?1, ?2, ?3, ?4, ?5, 'staged', NULL, ?6, NULL, NULL, ?7, ?7)",
            params![
                operation_id,
                self.server_id,
                session_id,
                kind,
                body,
                expected_turn_id,
                now
            ],
        )?;
        let view = OperationView {
            operation_id: operation_id.to_string(),
            session_id: session_id.to_string(),
            turn_id: None,
            state: OperationState::Staged,
            error_code: None,
            error_message: None,
            created_at_ms: now,
            updated_at_ms: now,
        };
        Ok((view, false))
    }

    pub fn operation_body(&self, operation_id: &str) -> CoreResult<Option<(String, String)>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT body, session_id FROM operations WHERE operation_id = ?1 AND server_id = ?2",
                params![operation_id, self.server_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    pub fn operation(&self, operation_id: &str) -> CoreResult<Option<OperationView>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT * FROM operations WHERE operation_id = ?1 AND server_id = ?2",
                params![operation_id, self.server_id],
                Self::operation_from_row,
            )
            .optional()?)
    }

    pub fn transition_operation(
        &self,
        operation_id: &str,
        expected_from: OperationState,
        to: OperationState,
        error: Option<(&str, &str)>,
        turn_id: Option<&str>,
    ) -> CoreResult<OperationView> {
        let conn = self.conn.lock().expect("store lock");
        let current = conn
            .query_row(
                "SELECT * FROM operations WHERE operation_id = ?1 AND server_id = ?2",
                params![operation_id, self.server_id],
                Self::operation_from_row,
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound(operation_id.into()))?;
        if current.state == to && (turn_id.is_none() || current.turn_id.as_deref() == turn_id) {
            return Ok(current);
        }
        if !current.state.can_transition_to(to) {
            return Err(CoreError::InvalidTransition {
                from: current.state,
                to,
            });
        }
        if current.state != expected_from {
            return Err(CoreError::InvalidTransition {
                from: current.state,
                to,
            });
        }
        let now = now_ms();
        let state = serde_json::to_value(to)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".into());
        let changed = conn.execute(
            "UPDATE operations SET state = ?1, error_code = COALESCE(?2, error_code),
                error_message = COALESCE(?3, error_message), turn_id = COALESCE(?4, turn_id),
                updated_at_ms = ?5
             WHERE operation_id = ?6 AND state = ?7 AND server_id = ?8",
            params![
                state,
                error.map(|value| value.0),
                error.map(|value| value.1),
                turn_id,
                now,
                operation_id,
                serde_json::to_value(expected_from)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_default(),
                self.server_id
            ],
        )?;
        if changed == 0 {
            return Err(CoreError::Conflict(
                "operation state changed concurrently".into(),
            ));
        }
        conn.query_row(
            "SELECT * FROM operations WHERE operation_id = ?1",
            params![operation_id],
            Self::operation_from_row,
        )
        .map_err(CoreError::from)
    }

    /// Called once at startup. A process that died between a socket write and
    /// an acknowledgment leaves `dispatching`; that outcome is unknown and is
    /// never retried automatically.
    pub fn recover_inflight_operations(&self) -> CoreResult<usize> {
        let conn = self.conn.lock().expect("store lock");
        let changed = conn.execute(
            "UPDATE operations SET state = 'unknown',
                error_code = 'delivery_unconfirmed',
                error_message = 'adapter restarted before delivery was observed',
                updated_at_ms = ?1
             WHERE server_id = ?2 AND state IN ('staged','reserved','dispatching')",
            params![now_ms(), self.server_id],
        )?;
        Ok(changed)
    }

    pub fn dispatching_operations(&self) -> CoreResult<Vec<OperationView>> {
        let conn = self.conn.lock().expect("store lock");
        let mut stmt = conn.prepare(
            "SELECT * FROM operations WHERE server_id = ?1 AND state = 'dispatching' ORDER BY created_at_ms ASC",
        )?;
        let rows = stmt.query_map(params![self.server_id], Self::operation_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn pending_operation_for_session(
        &self,
        session_id: &str,
    ) -> CoreResult<Option<OperationView>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT * FROM operations WHERE server_id = ?1 AND session_id = ?2
                 AND state IN ('dispatching','accepted') ORDER BY created_at_ms DESC LIMIT 1",
                params![self.server_id, session_id],
                Self::operation_from_row,
            )
            .optional()?)
    }

    // ------------------------------------------------------------------
    // Session idempotency and metadata
    // ------------------------------------------------------------------

    pub fn session_for_create_request(
        &self,
        client_request_id: &str,
    ) -> CoreResult<Option<String>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT session_id FROM session_create_requests WHERE client_request_id = ?1 AND server_id = ?2",
                params![client_request_id, self.server_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn record_session_create(
        &self,
        client_request_id: &str,
        session_id: &str,
    ) -> CoreResult<()> {
        let conn = self.conn.lock().expect("store lock");
        conn.execute(
            "INSERT OR IGNORE INTO session_create_requests(client_request_id, server_id, session_id, created_at_ms)
             VALUES(?1, ?2, ?3, ?4)",
            params![client_request_id, self.server_id, session_id, now_ms()],
        )?;
        Ok(())
    }

    pub fn set_session_title(&self, session_id: &str, title: &str) -> CoreResult<()> {
        let conn = self.conn.lock().expect("store lock");
        conn.execute(
            "INSERT INTO session_titles(session_id, server_id, title, updated_at_ms)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, updated_at_ms = excluded.updated_at_ms",
            params![session_id, self.server_id, title, now_ms()],
        )?;
        Ok(())
    }

    pub fn session_title(&self, session_id: &str) -> CoreResult<Option<String>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT title FROM session_titles WHERE session_id = ?1 AND server_id = ?2",
                params![session_id, self.server_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn clear_session_title(&self, session_id: &str) -> CoreResult<()> {
        let conn = self.conn.lock().expect("store lock");
        conn.execute(
            "DELETE FROM session_titles WHERE session_id = ?1 AND server_id = ?2",
            params![session_id, self.server_id],
        )?;
        Ok(())
    }

    pub fn session_project(&self, session_id: &str) -> CoreResult<Option<String>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT project_id FROM session_projects WHERE session_id = ?1 AND server_id = ?2",
                params![session_id, self.server_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_session_project(&self, session_id: &str, project_id: &str) -> CoreResult<()> {
        let conn = self.conn.lock().expect("store lock");
        conn.execute(
            "INSERT INTO session_projects(session_id, server_id, project_id) VALUES(?1, ?2, ?3)
             ON CONFLICT(session_id) DO UPDATE SET project_id = excluded.project_id",
            params![session_id, self.server_id, project_id],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Projects
    // ------------------------------------------------------------------

    pub fn upsert_project(&self, label: &str, path: &str, pinned: bool) -> CoreResult<Project> {
        let conn = self.conn.lock().expect("store lock");
        let existing: Option<(String, i64)> = conn
            .query_row(
                "SELECT project_id, created_at_ms FROM projects WHERE server_id = ?1 AND path = ?2",
                params![self.server_id, path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (project_id, created_at_ms) = match existing {
            Some((id, created)) => (id, created),
            None => (format!("prj_{}", uuid::Uuid::new_v4().simple()), now_ms()),
        };
        conn.execute(
            "INSERT INTO projects(project_id, server_id, label, path, pinned, created_at_ms)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(project_id) DO UPDATE SET label = excluded.label, pinned = excluded.pinned",
            params![project_id, self.server_id, label, path, pinned as i64, created_at_ms],
        )?;
        Ok(Project {
            project_id,
            label: label.to_string(),
            path: path.to_string(),
            pinned,
            created_at_ms,
            session_count: 0,
        })
    }

    pub fn project(&self, project_id: &str) -> CoreResult<Option<ProjectRow>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT project_id, label, path, pinned, created_at_ms FROM projects
                 WHERE project_id = ?1 AND server_id = ?2",
                params![project_id, self.server_id],
                |row| {
                    Ok(ProjectRow {
                        project_id: row.get(0)?,
                        label: row.get(1)?,
                        path: row.get(2)?,
                        pinned: row.get::<_, i64>(3)? != 0,
                        created_at_ms: row.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn list_projects(&self) -> CoreResult<Vec<Project>> {
        let conn = self.conn.lock().expect("store lock");
        let mut stmt = conn.prepare(
            "SELECT p.project_id, p.label, p.path, p.pinned, p.created_at_ms,
                    (SELECT COUNT(*) FROM session_projects s WHERE s.project_id = p.project_id)
             FROM projects p WHERE p.server_id = ?1
             ORDER BY p.pinned DESC, p.created_at_ms ASC",
        )?;
        let rows = stmt.query_map(params![self.server_id], |row| {
            Ok(Project {
                project_id: row.get(0)?,
                label: row.get(1)?,
                path: row.get(2)?,
                pinned: row.get::<_, i64>(3)? != 0,
                created_at_ms: row.get(4)?,
                session_count: row.get::<_, i64>(5)? as u32,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn delete_project(&self, project_id: &str) -> CoreResult<bool> {
        let conn = self.conn.lock().expect("store lock");
        let changed = conn.execute(
            "DELETE FROM projects WHERE project_id = ?1 AND server_id = ?2",
            params![project_id, self.server_id],
        )?;
        Ok(changed > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> std::sync::Arc<Store> {
        Store::open_in_memory().unwrap()
    }

    #[test]
    fn pairing_code_is_single_use() {
        let store = store();
        store.replace_pairing_code("code-hash", 60_000).unwrap();
        let device = store
            .redeem_pairing_code("code-hash", "token-hash", "Phone")
            .unwrap();
        assert_eq!(device.name, "Phone");
        assert!(
            store
                .redeem_pairing_code("code-hash", "token-hash-2", "Other")
                .is_err()
        );
    }

    #[test]
    fn expired_pairing_code_is_rejected() {
        let store = store();
        store.replace_pairing_code("expired", -1).unwrap();
        assert!(store.redeem_pairing_code("expired", "t", "Phone").is_err());
    }

    #[test]
    fn token_lookup_respects_revocation() {
        let store = store();
        store.replace_pairing_code("code", 60_000).unwrap();
        let device = store.redeem_pairing_code("code", "token", "Phone").unwrap();
        assert!(store.device_by_token_hash("token").unwrap().is_some());
        assert!(store.revoke_device(&device.device_id).unwrap());
        assert!(store.device_by_token_hash("token").unwrap().is_none());
    }

    #[test]
    fn duplicate_reserve_is_idempotent_but_conflicts_are_not() {
        let store = store();
        let (op, duplicate) = store
            .reserve_operation("op-1", "session-1", "send", "hello", None)
            .unwrap();
        assert!(!duplicate);
        assert_eq!(op.state, OperationState::Staged);
        let (op, duplicate) = store
            .reserve_operation("op-1", "session-1", "send", "hello", None)
            .unwrap();
        assert!(duplicate);
        assert_eq!(op.state, OperationState::Staged);
        assert!(
            store
                .reserve_operation("op-1", "session-2", "send", "hello", None)
                .is_err()
        );
        assert!(
            store
                .reserve_operation("op-1", "session-1", "send", "different", None)
                .is_err()
        );
    }

    #[test]
    fn only_one_inflight_operation_per_session() {
        let store = store();
        store
            .reserve_operation("op-1", "session-1", "send", "one", None)
            .unwrap();
        assert!(
            store
                .reserve_operation("op-2", "session-1", "send", "two", None)
                .is_err()
        );
        assert!(
            store
                .reserve_operation("op-3", "session-2", "send", "two", None)
                .is_ok()
        );
    }

    #[test]
    fn dispatch_crash_becomes_unknown() {
        let store = store();
        store
            .reserve_operation("op-1", "session-1", "send", "hello", None)
            .unwrap();
        store
            .transition_operation(
                "op-1",
                OperationState::Staged,
                OperationState::Reserved,
                None,
                None,
            )
            .unwrap();
        store
            .transition_operation(
                "op-1",
                OperationState::Reserved,
                OperationState::Dispatching,
                None,
                Some("turn-1"),
            )
            .unwrap();
        assert_eq!(store.recover_inflight_operations().unwrap(), 1);
        let op = store.operation("op-1").unwrap().unwrap();
        assert_eq!(op.state, OperationState::Unknown);
        assert_eq!(op.error_code.as_deref(), Some("delivery_unconfirmed"));
    }

    #[test]
    fn state_cannot_move_backwards() {
        let store = store();
        store
            .reserve_operation("op-1", "session-1", "send", "hello", None)
            .unwrap();
        store
            .transition_operation(
                "op-1",
                OperationState::Staged,
                OperationState::Reserved,
                None,
                None,
            )
            .unwrap();
        assert!(
            store
                .transition_operation(
                    "op-1",
                    OperationState::Reserved,
                    OperationState::Staged,
                    None,
                    None
                )
                .is_err()
        );
    }

    #[test]
    fn session_create_is_idempotent() {
        let store = store();
        assert_eq!(store.session_for_create_request("req-1").unwrap(), None);
        store.record_session_create("req-1", "s1").unwrap();
        store.record_session_create("req-1", "s2").unwrap();
        assert_eq!(
            store
                .session_for_create_request("req-1")
                .unwrap()
                .as_deref(),
            Some("s1")
        );
    }

    #[test]
    fn project_paths_are_unique_per_server() {
        let store = store();
        let a = store.upsert_project("One", "/tmp/one", false).unwrap();
        let b = store
            .upsert_project("One renamed", "/tmp/one", true)
            .unwrap();
        assert_eq!(a.project_id, b.project_id);
        assert_eq!(store.list_projects().unwrap().len(), 1);
    }
}
