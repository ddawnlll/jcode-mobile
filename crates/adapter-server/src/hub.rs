use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use adapter_core::{JournalRecord, Store, now_ms};
use adapter_protocol::{OperationView, RuntimeIdentity, SessionEvent, SwarmAgentView};
use tokio::sync::broadcast;
use tracing::error;

use crate::faults::FaultInjection;

#[derive(Debug, Clone)]
pub struct HubEvent {
    pub session_id: String,
    pub seq: u64,
    pub turn_id: Option<String>,
    pub operation_id: Option<String>,
    pub event: SessionEvent,
    pub at_ms: i64,
}

#[derive(Debug, Clone)]
pub enum Broadcast {
    Session(Arc<HubEvent>),
    Runtime {
        session_id: String,
        runtime: Arc<RuntimeIdentity>,
        at_ms: i64,
    },
    Swarm {
        session_id: String,
        agents: Arc<Vec<SwarmAgentView>>,
    },
    Operation(OperationView),
    SessionsChanged,
    Connection {
        connected: bool,
        message: String,
    },
}

/// Fan-in for adapter-observed events.
///
/// `seq` is allocated by the durable SQLite journal, not by this in-memory
/// object. A process restart therefore continues the same per-session sequence
/// and a returning client can replay from its acknowledged cursor. The hub
/// carries no replay buffer of its own: the journal is the single source of
/// truth, and a replay gap is reported rather than filled from memory.
pub struct Hub {
    tx: broadcast::Sender<Broadcast>,
    store: Arc<Store>,
    epoch: String,
    publication: Mutex<()>,
    append_failures: AtomicU64,
    faults: Arc<FaultInjection>,
}

impl Hub {
    pub fn new(
        epoch: String,
        broadcast_capacity: usize,
        store: Arc<Store>,
        faults: Arc<FaultInjection>,
    ) -> Self {
        let (tx, _) = broadcast::channel(broadcast_capacity.max(32));
        Self {
            tx,
            store,
            epoch,
            publication: Mutex::new(()),
            append_failures: AtomicU64::new(0),
            faults,
        }
    }

    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    pub fn append_failures(&self) -> u64 {
        self.append_failures.load(Ordering::Relaxed)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Broadcast> {
        self.tx.subscribe()
    }

    pub fn publish(
        &self,
        session_id: &str,
        turn_id: Option<String>,
        operation_id: Option<String>,
        event: SessionEvent,
    ) -> Arc<HubEvent> {
        // Keep SQLite allocation and broadcast in the same order, including
        // when a request publishes a turn boundary alongside the event pump.
        let _guard = self.publication.lock().expect("event publication");
        let at_ms = now_ms();
        if self.faults.journal_fail {
            return self.degraded(session_id, turn_id, operation_id, at_ms, "fault injection");
        }
        match self.store.append_event(
            session_id,
            &self.epoch,
            turn_id.as_deref(),
            operation_id.as_deref(),
            &event,
            at_ms,
        ) {
            Ok(record) => {
                let event = Arc::new(hub_event(record));
                let _ = self.tx.send(Broadcast::Session(event.clone()));
                event
            }
            Err(error) => {
                error!(%error, session = session_id, "event journal append failed; live event was not broadcast");
                self.degraded(
                    session_id,
                    turn_id,
                    operation_id,
                    at_ms,
                    "the journal rejected the write",
                )
            }
        }
    }

    /// Do not pretend an unpersisted event has a durable sequence. Tell the
    /// client the stream is degraded so it reconciles from an authoritative
    /// snapshot instead of trusting a gap.
    fn degraded(
        &self,
        session_id: &str,
        turn_id: Option<String>,
        operation_id: Option<String>,
        at_ms: i64,
        reason: &str,
    ) -> Arc<HubEvent> {
        self.append_failures.fetch_add(1, Ordering::Relaxed);
        let degraded = Arc::new(HubEvent {
            session_id: session_id.to_string(),
            seq: 0,
            turn_id,
            operation_id,
            event: SessionEvent::AdapterError {
                code: "journal_unavailable".into(),
                message: format!(
                    "the adapter could not persist this event ({reason}); reconcile from a snapshot"
                ),
                retryable: true,
            },
            at_ms,
        });
        let _ = self.tx.send(Broadcast::Session(degraded.clone()));
        degraded
    }

    pub fn publish_operation(&self, operation: OperationView) {
        let _ = self.tx.send(Broadcast::Operation(operation));
    }

    pub fn sessions_changed(&self) {
        let _ = self.tx.send(Broadcast::SessionsChanged);
    }

    pub fn publish_runtime(&self, session_id: String, runtime: RuntimeIdentity) {
        let _ = self.tx.send(Broadcast::Runtime {
            session_id,
            runtime: Arc::new(runtime),
            at_ms: now_ms(),
        });
    }

    pub fn publish_swarm(&self, session_id: String, agents: Vec<SwarmAgentView>) {
        let _ = self.tx.send(Broadcast::Swarm {
            session_id,
            agents: Arc::new(agents),
        });
    }

    pub fn publish_connection(&self, connected: bool, message: String) {
        let _ = self.tx.send(Broadcast::Connection { connected, message });
    }

    pub fn current_seq(&self, session_id: &str) -> u64 {
        self.store
            .journal_bounds(session_id)
            .map(|(_, latest)| latest)
            .unwrap_or(0)
    }

    /// Replay durably persisted events after a cursor. The second value is the
    /// gap flag: true when the requested cursor predates the retained floor.
    pub fn replay_after(&self, session_id: &str, after_seq: u64) -> (Vec<HubEvent>, bool) {
        match self.store.replay_events(session_id, after_seq, 512) {
            Ok(replay) => (
                replay.events.into_iter().map(hub_event).collect(),
                replay.gap,
            ),
            Err(error) => {
                error!(%error, session = session_id, "journal replay failed");
                (Vec::new(), after_seq > 0)
            }
        }
    }

    /// Session subscriptions are per connection; the journal intentionally
    /// outlives them so a returning client can still replay.
    pub fn forget_session(&self, _session_id: &str) {}
}

fn hub_event(record: JournalRecord) -> HubEvent {
    HubEvent {
        session_id: record.session_id,
        seq: record.seq,
        turn_id: record.turn_id,
        operation_id: record.operation_id,
        event: record.event,
        at_ms: record.observed_at_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hub(store: Arc<Store>) -> Hub {
        Hub::new(
            "epoch-1".into(),
            32,
            store,
            Arc::new(FaultInjection::default()),
        )
    }

    #[test]
    fn sequences_are_durable_and_per_session() {
        let store = Store::open_in_memory().unwrap();
        let hub = hub(store);
        let idle = SessionEvent::SessionStatus {
            status: "idle".into(),
            pending_soft_interrupts: None,
        };
        let a = hub.publish("s1", None, None, idle.clone());
        let b = hub.publish(
            "s1",
            None,
            None,
            SessionEvent::TextDelta {
                text: "hi".into(),
                message_id: None,
            },
        );
        let c = hub.publish("s2", None, None, idle);
        assert_eq!((a.seq, b.seq, c.seq), (1, 2, 1));
        assert_eq!(hub.current_seq("s1"), 2);
    }

    #[test]
    fn replay_reports_gaps_instead_of_inventing_events() {
        let store = Store::open_in_memory().unwrap();
        let hub = hub(Arc::clone(&store));
        // Push beyond the retention floor so an old cursor is a real gap.
        let total = store.journal_retention() as u64 + 10;
        for seq in 0..total {
            hub.publish(
                "s1",
                None,
                None,
                SessionEvent::TextDelta {
                    text: seq.to_string(),
                    message_id: None,
                },
            );
        }
        let (events, gap) = hub.replay_after("s1", 1);
        assert!(gap);
        assert!(events.len() <= 512);
        let floor = events.first().map(|event| event.seq).unwrap_or(0);
        assert!(floor > 2);
        let (events, gap) = hub.replay_after("s1", floor - 1);
        assert!(!gap);
        assert_eq!(events.first().map(|event| event.seq), Some(floor));
    }

    #[test]
    fn journal_failure_is_surfaced_not_faked() {
        // The fault-injected journal rejects the append. The hub must not
        // broadcast the original event with a fabricated sequence.
        let store = Store::open_in_memory().unwrap();
        let hub = Hub::new(
            "epoch-1".into(),
            32,
            store,
            Arc::new(FaultInjection {
                journal_fail: true,
                ..FaultInjection::default()
            }),
        );
        let event = hub.publish(
            "s1",
            None,
            None,
            SessionEvent::TextDelta {
                text: "lost".into(),
                message_id: None,
            },
        );
        assert_eq!(event.seq, 0);
        assert!(matches!(
            event.event,
            SessionEvent::AdapterError { ref code, .. } if code == "journal_unavailable"
        ));
        assert_eq!(hub.append_failures(), 1);
    }
}
