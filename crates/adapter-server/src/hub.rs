use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use adapter_protocol::{OperationView, SessionEvent};
use tokio::sync::broadcast;

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
    Session(HubEvent),
    Operation(OperationView),
    SessionsChanged,
    Connection { connected: bool, message: String },
}

#[derive(Debug)]
struct SessionStream {
    seq: u64,
    buffer: VecDeque<HubEvent>,
}

/// One adapter-run ordering domain per session. `seq` is assigned when the
/// adapter observes an event, not by JCode. It is deliberately not presented as
/// a persisted daemon message id.
pub struct Hub {
    tx: broadcast::Sender<Broadcast>,
    streams: Mutex<HashMap<String, SessionStream>>,
    capacity: usize,
    epoch: String,
}

impl Hub {
    pub fn new(epoch: String, broadcast_capacity: usize, replay_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(broadcast_capacity.max(32));
        Self {
            tx,
            streams: Mutex::new(HashMap::new()),
            capacity: replay_capacity.clamp(32, 4096),
            epoch,
        }
    }

    pub fn epoch(&self) -> &str {
        &self.epoch
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
    ) -> HubEvent {
        let at_ms = crate::now_ms();
        let mut streams = self.streams.lock().expect("hub streams");
        let stream = streams
            .entry(session_id.to_string())
            .or_insert_with(|| SessionStream {
                seq: 0,
                buffer: VecDeque::with_capacity(self.capacity),
            });
        stream.seq += 1;
        let event = HubEvent {
            session_id: session_id.to_string(),
            seq: stream.seq,
            turn_id,
            operation_id,
            event,
            at_ms,
        };
        stream.buffer.push_back(event.clone());
        while stream.buffer.len() > self.capacity {
            stream.buffer.pop_front();
        }
        drop(streams);
        let _ = self.tx.send(Broadcast::Session(event.clone()));
        event
    }

    pub fn publish_operation(&self, operation: OperationView) {
        let _ = self.tx.send(Broadcast::Operation(operation));
    }

    pub fn sessions_changed(&self) {
        let _ = self.tx.send(Broadcast::SessionsChanged);
    }

    pub fn publish_connection(&self, connected: bool, message: String) {
        let _ = self.tx.send(Broadcast::Connection { connected, message });
    }

    pub fn current_seq(&self, session_id: &str) -> u64 {
        self.streams
            .lock()
            .expect("hub streams")
            .get(session_id)
            .map(|stream| stream.seq)
            .unwrap_or(0)
    }

    /// Returns replayable events and whether a gap was detected. A gap is
    /// reported, never hidden, when the requested cursor predates the ring.
    pub fn replay_after(&self, session_id: &str, after_seq: u64) -> (Vec<HubEvent>, bool) {
        let streams = self.streams.lock().expect("hub streams");
        let Some(stream) = streams.get(session_id) else {
            return (Vec::new(), after_seq > 0);
        };
        let first = stream.buffer.front().map(|event| event.seq);
        let gap = first
            .map(|first| after_seq > 0 && after_seq + 1 < first)
            .unwrap_or(false);
        let replay = stream
            .buffer
            .iter()
            .filter(|event| event.seq > after_seq)
            .cloned()
            .collect();
        (replay, gap)
    }

    pub fn forget_session(&self, session_id: &str) {
        self.streams.lock().expect("hub streams").remove(session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hub() -> Hub {
        Hub::new("epoch-1".into(), 32, 32)
    }

    #[test]
    fn sequences_are_monotonic_per_session() {
        let hub = hub();
        let a = hub.publish(
            "s1",
            None,
            None,
            SessionEvent::SessionStatus {
                status: "idle".into(),
                pending_soft_interrupts: None,
            },
        );
        let b = hub.publish(
            "s1",
            None,
            None,
            SessionEvent::TextDelta {
                text: "hi".into(),
                message_id: None,
            },
        );
        let c = hub.publish(
            "s2",
            None,
            None,
            SessionEvent::TextDelta {
                text: "other".into(),
                message_id: None,
            },
        );
        assert_eq!((a.seq, b.seq, c.seq), (1, 2, 1));
        assert_eq!(hub.current_seq("s1"), 2);
    }

    #[test]
    fn replay_reports_gaps_instead_of_inventing_events() {
        let hub = Hub::new("epoch".into(), 64, 32);
        for seq in 1..=40 {
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
        assert_eq!(events.len(), 32);
        assert_eq!(events.first().unwrap().seq, 9);
        assert_eq!(events.last().unwrap().seq, 40);
        let (events, gap) = hub.replay_after("s1", 8);
        assert!(!gap);
        assert_eq!(events.len(), 32);
    }
}
