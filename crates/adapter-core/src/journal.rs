//! Adapter v3 durable event journal and session delta index.
//!
//! Event sequence numbers are allocated inside the SQLite insert transaction,
//! so a restart cannot reuse or skip a number. Retention trims each session to
//! a bounded window; a replay from below the retained floor reports a gap
//! instead of pretending the events were delivered. Nothing here promises
//! exactly-once *agent execution*: that guarantee lives in the operation
//! journal and is never inferred from an event cursor.

use adapter_protocol::{SessionEvent, SessionSummary, SessionsDeltaPayload};
use rusqlite::{OptionalExtension, params};

use crate::paths::{CoreError, CoreResult, now_ms};
use crate::store::Store;

/// Hard cap on one replay response. The client pages with `has_more`.
pub const MAX_REPLAY_LIMIT: u32 = 2_000;
const MAX_REPLAY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct JournalRecord {
    pub session_id: String,
    pub seq: u64,
    pub epoch: String,
    pub turn_id: Option<String>,
    pub operation_id: Option<String>,
    pub event: SessionEvent,
    pub observed_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JournalReplay {
    pub events: Vec<JournalRecord>,
    /// Oldest retained sequence, or 0 when the journal has no rows.
    pub floor_seq: u64,
    /// Highest assigned sequence, or 0 when the journal has no rows.
    pub latest_seq: u64,
    /// The requested cursor is older than the retention floor.
    pub gap: bool,
    pub has_more: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct JournalStats {
    pub events: u64,
    pub bytes: u64,
    pub sessions: u64,
    pub oldest_observed_at_ms: Option<i64>,
    pub newest_observed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionIndexStats {
    pub sessions: u64,
    pub removed: u64,
    pub revision: u64,
}

fn corrupt(row: usize, error: impl std::fmt::Display) -> CoreError {
    CoreError::Message(format!("corrupt journal row {row}: {error}"))
}

fn journal_bounds(conn: &rusqlite::Connection, session_id: &str) -> CoreResult<(u64, u64)> {
    let (floor, latest): (Option<i64>, Option<i64>) = conn.query_row(
        "SELECT
            (SELECT seq FROM event_journal WHERE session_id = ?1 ORDER BY seq LIMIT 1),
            (SELECT seq FROM event_journal WHERE session_id = ?1 ORDER BY seq DESC LIMIT 1)",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok((
        floor.unwrap_or(0).max(0) as u64,
        latest.unwrap_or(0).max(0) as u64,
    ))
}

impl Store {
    pub fn journal_retention(&self) -> u32 {
        self.journal_retention
    }

    /// Append one event and return the durable record. The insert and the
    /// sequence allocation share a transaction; a crash before commit leaves
    /// no half-assigned sequence.
    pub fn append_event(
        &self,
        session_id: &str,
        epoch: &str,
        turn_id: Option<&str>,
        operation_id: Option<&str>,
        event: &SessionEvent,
        observed_at_ms: i64,
    ) -> CoreResult<JournalRecord> {
        let event_json = serde_json::to_string(event)
            .map_err(|error| CoreError::Message(format!("event serialization failed: {error}")))?;
        let mut conn = self.conn.lock().expect("store lock");
        let tx = conn.transaction()?;
        let seq: i64 = tx.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM event_journal WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO event_journal(session_id, seq, epoch, turn_id, operation_id, event_json, observed_at_ms)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session_id,
                seq,
                epoch,
                turn_id,
                operation_id,
                event_json,
                observed_at_ms
            ],
        )?;
        let retention = i64::from(self.journal_retention());
        if seq > retention {
            // Keep exactly `retention` rows per session. The index makes this
            // a bounded range delete, not a table scan.
            tx.execute(
                "DELETE FROM event_journal WHERE session_id = ?1 AND seq <= ?2",
                params![session_id, seq - retention],
            )?;
        }
        tx.commit()?;
        Ok(JournalRecord {
            session_id: session_id.to_string(),
            seq: seq as u64,
            epoch: epoch.to_string(),
            turn_id: turn_id.map(str::to_owned),
            operation_id: operation_id.map(str::to_owned),
            event: event.clone(),
            observed_at_ms,
        })
    }

    pub fn journal_bounds(&self, session_id: &str) -> CoreResult<(u64, u64)> {
        let conn = self.conn.lock().expect("store lock");
        journal_bounds(&conn, session_id)
    }

    pub fn replay_events(
        &self,
        session_id: &str,
        after_seq: u64,
        limit: u32,
    ) -> CoreResult<JournalReplay> {
        let limit = limit.clamp(1, MAX_REPLAY_LIMIT);
        let conn = self.conn.lock().expect("store lock");
        let (floor_seq, latest_seq) = journal_bounds(&conn, session_id)?;
        let mut stmt = conn.prepare(
            "SELECT seq, epoch, turn_id, operation_id, event_json, observed_at_ms
             FROM event_journal WHERE session_id = ?1 AND seq > ?2
             ORDER BY seq ASC LIMIT ?3",
        )?;
        let sql_cursor = i64::try_from(after_seq).unwrap_or(i64::MAX);
        let rows = stmt.query_map(params![session_id, sql_cursor, limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;
        let mut events = Vec::new();
        let mut bytes = 0;
        for (index, row) in rows.enumerate() {
            let (seq, epoch, turn_id, operation_id, event_json, observed_at_ms) = row?;
            // A single large event still fits on its own page. Subsequent
            // events wait for the next cursor instead of inflating this page.
            if !events.is_empty() && bytes + event_json.len() > MAX_REPLAY_BYTES {
                break;
            }
            bytes += event_json.len();
            let event: SessionEvent =
                serde_json::from_str(&event_json).map_err(|error| corrupt(index, error))?;
            events.push(JournalRecord {
                session_id: session_id.to_string(),
                seq: seq as u64,
                epoch,
                turn_id,
                operation_id,
                event,
                observed_at_ms,
            });
        }
        // A gap exists only when the client asked to resume from a real point
        // and the retained floor starts later than that point's successor.
        let gap = after_seq > 0 && floor_seq > 0 && after_seq.saturating_add(1) < floor_seq;
        let has_more = events.last().is_some_and(|event| event.seq < latest_seq);
        Ok(JournalReplay {
            events,
            floor_seq,
            latest_seq,
            gap,
            has_more,
        })
    }

    /// Persist the highest sequence a device has acknowledged. The cursor only
    /// moves forward; an out-of-order ack is ignored.
    pub fn ack_event_cursor(&self, device_id: &str, session_id: &str, seq: u64) -> CoreResult<u64> {
        let conn = self.conn.lock().expect("store lock");
        conn.execute(
            "INSERT INTO event_cursors(device_id, session_id, acked_seq, updated_at_ms)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(device_id, session_id) DO UPDATE SET
                acked_seq = MAX(event_cursors.acked_seq, excluded.acked_seq),
                updated_at_ms = excluded.updated_at_ms",
            params![device_id, session_id, seq as i64, now_ms()],
        )?;
        Ok(conn
            .query_row(
                "SELECT acked_seq FROM event_cursors WHERE device_id = ?1 AND session_id = ?2",
                params![device_id, session_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            .max(0) as u64)
    }

    pub fn acked_event_cursor(&self, device_id: &str, session_id: &str) -> CoreResult<Option<u64>> {
        let conn = self.conn.lock().expect("store lock");
        Ok(conn
            .query_row(
                "SELECT acked_seq FROM event_cursors WHERE device_id = ?1 AND session_id = ?2",
                params![device_id, session_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .map(|seq| seq.max(0) as u64))
    }

    pub fn journal_stats(&self) -> CoreResult<JournalStats> {
        let conn = self.conn.lock().expect("store lock");
        let (events, bytes, sessions, oldest, newest) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(event_json)), 0),
                    COUNT(DISTINCT session_id), MIN(observed_at_ms), MAX(observed_at_ms)
             FROM event_journal",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )?;
        Ok(JournalStats {
            events: events.max(0) as u64,
            bytes: bytes.max(0) as u64,
            sessions: sessions.max(0) as u64,
            oldest_observed_at_ms: oldest,
            newest_observed_at_ms: newest,
        })
    }

    /// Time-based retention for rows that outlive their usefulness even when a
    /// session's count is below the per-session cap. Returns rows removed.
    pub fn compact_journal_older_than(&self, max_age_ms: i64) -> CoreResult<usize> {
        let cutoff = now_ms().saturating_sub(max_age_ms.max(0));
        let conn = self.conn.lock().expect("store lock");
        Ok(conn.execute(
            "DELETE FROM event_journal WHERE observed_at_ms < ?1",
            params![cutoff],
        )?)
    }

    // ------------------------------------------------------------------
    // Session delta index
    // ------------------------------------------------------------------

    fn session_revision(conn: &rusqlite::Connection) -> CoreResult<u64> {
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'session_revision'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0))
    }

    /// Reconcile the durable index with an authoritative daemon listing.
    /// Returns the revision the listing was observed at. Unchanged sessions do
    /// not bump the revision, so a delta stays small.
    pub fn reconcile_session_index(&self, summaries: &[SessionSummary]) -> CoreResult<u64> {
        let mut conn = self.conn.lock().expect("store lock");
        let tx = conn.transaction()?;
        let current = Self::session_revision(&tx)?;
        let mut next_revision = current;
        let mut changed = false;
        let now = now_ms();
        for summary in summaries {
            let summary_json = serde_json::to_string(summary)
                .map_err(|error| CoreError::Message(format!("summary serialization: {error}")))?;
            let existing: Option<(String, i64)> = tx
                .query_row(
                    "SELECT summary_json, removed FROM session_index WHERE session_id = ?1 AND server_id = ?2",
                    params![summary.session_id, self.server_id()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let needs_write = match existing {
                Some((json, removed)) => json != summary_json || removed != 0,
                None => true,
            };
            if !needs_write {
                continue;
            }
            if !changed {
                next_revision = current + 1;
                changed = true;
            }
            tx.execute(
                "INSERT INTO session_index(session_id, server_id, summary_json, revision, removed, updated_at_ms)
                 VALUES(?1, ?2, ?3, ?4, 0, ?5)
                 ON CONFLICT(session_id) DO UPDATE SET
                    summary_json = excluded.summary_json,
                    revision = excluded.revision,
                    removed = 0,
                    updated_at_ms = excluded.updated_at_ms",
                params![summary.session_id, self.server_id(), summary_json, next_revision as i64, now],
            )?;
        }
        // Anything still marked present but absent from the authoritative list
        // is retained as a removal tombstone so an offline client converges.
        let known: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT session_id FROM session_index
                 WHERE server_id = ?1 AND removed = 0",
            )?;
            let rows = stmt.query_map(params![self.server_id()], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for session_id in known {
            let still_present = summaries
                .iter()
                .any(|summary| summary.session_id == session_id);
            if still_present {
                continue;
            }
            if !changed {
                next_revision = current + 1;
                changed = true;
            }
            tx.execute(
                "UPDATE session_index SET removed = 1, revision = ?1, updated_at_ms = ?2
                 WHERE session_id = ?3 AND server_id = ?4",
                params![next_revision as i64, now, session_id, self.server_id()],
            )?;
        }
        if changed {
            tx.execute(
                "INSERT INTO meta(key, value) VALUES('session_revision', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![next_revision.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(next_revision)
    }

    pub fn sessions_delta(&self, since_revision: u64) -> CoreResult<SessionsDeltaPayload> {
        let conn = self.conn.lock().expect("store lock");
        let revision = Self::session_revision(&conn)?;
        let full = since_revision == 0 || since_revision > revision;
        let since = if full { 0 } else { since_revision };
        let mut sessions = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT summary_json FROM session_index
                 WHERE server_id = ?1 AND removed = 0 AND revision > ?2
                 ORDER BY revision ASC, session_id ASC",
            )?;
            let rows = stmt.query_map(params![self.server_id(), since as i64], |row| {
                row.get::<_, String>(0)
            })?;
            for row in rows {
                let json = row?;
                let summary: SessionSummary = serde_json::from_str(&json).map_err(|error| {
                    CoreError::Message(format!("corrupt session index row: {error}"))
                })?;
                sessions.push(summary);
            }
        }
        let mut removed = Vec::new();
        if !full {
            let mut stmt = conn.prepare(
                "SELECT session_id FROM session_index
                 WHERE server_id = ?1 AND removed = 1 AND revision > ?2
                 ORDER BY revision ASC",
            )?;
            let rows = stmt.query_map(params![self.server_id(), since as i64], |row| {
                row.get::<_, String>(0)
            })?;
            for row in rows {
                removed.push(row?);
            }
        }
        drop(conn);
        let projects = if full {
            self.list_projects()?
        } else {
            Vec::new()
        };
        Ok(SessionsDeltaPayload {
            revision,
            full,
            sessions,
            removed,
            projects,
            source: "adapter.sqlite.session_index".into(),
            observed_at_ms: now_ms(),
            stale: false,
        })
    }

    pub fn session_index_stats(&self) -> CoreResult<SessionIndexStats> {
        let conn = self.conn.lock().expect("store lock");
        let (sessions, removed) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(removed), 0) FROM session_index WHERE server_id = ?1",
            params![self.server_id()],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let revision = Self::session_revision(&conn)?;
        Ok(SessionIndexStats {
            sessions: sessions.max(0) as u64,
            removed: removed.max(0) as u64,
            revision,
        })
    }

    /// Compact the index itself. Removed tombstones older than the window are
    /// dropped, which means a client offline longer than the tombstone window
    /// must take a full listing instead of trusting its own cache.
    pub fn compact_session_index(&self, max_age_ms: i64) -> CoreResult<usize> {
        let cutoff = now_ms().saturating_sub(max_age_ms.max(0));
        let conn = self.conn.lock().expect("store lock");
        Ok(conn.execute(
            "DELETE FROM session_index WHERE server_id = ?1 AND removed = 1 AND updated_at_ms < ?2",
            params![self.server_id(), cutoff],
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adapter_protocol::{Project, SessionSummary};

    fn store() -> std::sync::Arc<Store> {
        Store::open_in_memory().unwrap()
    }

    fn delta(text: &str) -> SessionEvent {
        SessionEvent::TextDelta {
            text: text.into(),
            message_id: None,
        }
    }

    fn summary(id: &str, status: &str) -> SessionSummary {
        SessionSummary {
            session_id: id.into(),
            title: Some(format!("Session {id}")),
            title_source: "jcode".into(),
            status: status.into(),
            working_dir: Some("/work".into()),
            project_id: None,
            updated_at_ms: Some(1),
            transcript_bytes: Some(10),
            saved: true,
            archived: false,
            parent_session_id: None,
            agent_label: None,
            swarm_status: None,
            favorite: false,
        }
    }

    #[test]
    fn sequence_is_per_session_and_monotonic() {
        let store = store();
        let a = store
            .append_event("s1", "e", None, None, &delta("1"), 1)
            .unwrap();
        let b = store
            .append_event("s1", "e", None, None, &delta("2"), 2)
            .unwrap();
        let c = store
            .append_event("s2", "e", None, None, &delta("3"), 3)
            .unwrap();
        assert_eq!((a.seq, b.seq, c.seq), (1, 2, 1));
        assert_eq!(store.journal_bounds("s1").unwrap(), (1, 2));
    }

    #[test]
    fn replay_is_ordered_and_exclusive_of_cursor() {
        let store = store();
        for index in 0..5 {
            store
                .append_event(
                    "s1",
                    "e",
                    Some("t1"),
                    None,
                    &delta(&index.to_string()),
                    index,
                )
                .unwrap();
        }
        let replay = store.replay_events("s1", 2, 100).unwrap();
        assert_eq!(replay.events.len(), 3);
        assert_eq!(replay.events.first().unwrap().seq, 3);
        assert_eq!(replay.events.last().unwrap().seq, 5);
        assert!(!replay.gap);
        assert!(!replay.has_more);
    }

    #[test]
    fn replay_reports_paging() {
        let store = store();
        for index in 0..10 {
            store
                .append_event("s1", "e", None, None, &delta(&index.to_string()), index)
                .unwrap();
        }
        let first = store.replay_events("s1", 0, 4).unwrap();
        assert_eq!(first.events.len(), 4);
        assert!(first.has_more);
        let second = store.replay_events("s1", 4, 100).unwrap();
        assert_eq!(second.events.len(), 6);
        assert!(!second.has_more);
    }

    #[test]
    fn retention_bounds_storage_and_marks_a_gap() {
        let store = store();
        let total = store.journal_retention() as u64 + 25;
        for index in 0..total {
            store
                .append_event(
                    "s1",
                    "e",
                    None,
                    None,
                    &delta(&index.to_string()),
                    index as i64,
                )
                .unwrap();
        }
        let (floor, latest) = store.journal_bounds("s1").unwrap();
        assert_eq!(latest, total);
        assert_eq!(latest - floor + 1, u64::from(store.journal_retention()));
        let replay = store.replay_events("s1", 1, 10).unwrap();
        assert!(replay.gap, "a cursor below the floor is a gap");
        // Starting from the floor is not a gap.
        let replay = store.replay_events("s1", floor - 1, 10).unwrap();
        assert!(!replay.gap);
        assert_eq!(replay.events.first().unwrap().seq, floor);
    }

    #[test]
    fn ten_thousand_events_stay_bounded() {
        let store = store();
        for index in 0..10_000u32 {
            store
                .append_event(
                    "s1",
                    "e",
                    None,
                    None,
                    &SessionEvent::TextDelta {
                        text: "x".into(),
                        message_id: Some(index.to_string()),
                    },
                    i64::from(index),
                )
                .unwrap();
        }
        let stats = store.journal_stats().unwrap();
        assert_eq!(stats.events, u64::from(store.journal_retention()));
        assert_eq!(stats.sessions, 1);
        let (_, latest) = store.journal_bounds("s1").unwrap();
        assert_eq!(latest, 10_000);
    }

    #[test]
    fn cursor_only_moves_forward() {
        let store = store();
        assert_eq!(store.ack_event_cursor("d1", "s1", 5).unwrap(), 5);
        assert_eq!(store.ack_event_cursor("d1", "s1", 3).unwrap(), 5);
        assert_eq!(store.ack_event_cursor("d1", "s1", 9).unwrap(), 9);
        assert_eq!(store.acked_event_cursor("d1", "s1").unwrap(), Some(9));
        assert_eq!(store.acked_event_cursor("d2", "s1").unwrap(), None);
    }

    #[test]
    fn journal_survives_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        {
            let store = Store::open(path).unwrap();
            for index in 0..3 {
                store
                    .append_event(
                        "s1",
                        "epoch_1",
                        None,
                        None,
                        &delta(&index.to_string()),
                        index,
                    )
                    .unwrap();
            }
        }
        let store = Store::open(path).unwrap();
        let replay = store.replay_events("s1", 0, 10).unwrap();
        assert_eq!(replay.events.len(), 3);
        assert_eq!(replay.latest_seq, 3);
        assert_eq!(
            replay.events[2].event,
            SessionEvent::TextDelta {
                text: "2".into(),
                message_id: None
            }
        );
        // The next append continues the durable sequence.
        let next = store
            .append_event("s1", "epoch_2", None, None, &delta("after"), 4)
            .unwrap();
        assert_eq!(next.seq, 4);
    }

    #[test]
    fn session_index_delta_converges() {
        let store = store();
        let revision = store
            .reconcile_session_index(&[summary("s1", "idle"), summary("s2", "idle")])
            .unwrap();
        assert!(revision > 0);
        let full = store.sessions_delta(0).unwrap();
        assert!(full.full);
        assert_eq!(full.sessions.len(), 2);
        assert_eq!(full.revision, revision);

        // No change, no new revision.
        let same = store
            .reconcile_session_index(&[summary("s1", "idle"), summary("s2", "idle")])
            .unwrap();
        assert_eq!(same, revision);
        let empty = store.sessions_delta(revision).unwrap();
        assert!(!empty.full);
        assert!(empty.sessions.is_empty());

        // One changed, one removed.
        let next = store
            .reconcile_session_index(&[summary("s1", "working")])
            .unwrap();
        assert!(next > revision);
        let delta_payload = store.sessions_delta(revision).unwrap();
        assert!(!delta_payload.full);
        assert_eq!(delta_payload.sessions.len(), 1);
        assert_eq!(delta_payload.sessions[0].session_id, "s1");
        assert_eq!(delta_payload.removed, vec!["s2".to_string()]);
        assert_eq!(delta_payload.revision, next);

        // A client from the future cannot trust its cache.
        let future = store.sessions_delta(next + 100).unwrap();
        assert!(future.full);
    }

    #[test]
    fn empty_index_is_reported_as_full() {
        let store = store();
        let payload = store.sessions_delta(9).unwrap();
        assert!(payload.full);
        assert_eq!(payload.revision, 0);
    }

    #[test]
    fn projects_are_only_sent_on_full_sync() {
        let store = store();
        store.upsert_project("One", "/tmp/one", false).unwrap();
        let revision = store
            .reconcile_session_index(&[summary("s1", "idle")])
            .unwrap();
        let full = store.sessions_delta(0).unwrap();
        assert_eq!(full.projects.len(), 1);
        let delta = store.sessions_delta(revision).unwrap();
        assert!(delta.projects.is_empty());
        let _unused: Project = full.projects[0].clone();
    }
}
