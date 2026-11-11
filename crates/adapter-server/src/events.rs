use std::sync::Arc;

use adapter_core::now_ms;
use adapter_protocol::{
    Envelope, Kind, OperationStatePayload, OperationView, ServerStatusPayload, SessionEventPayload,
};
use serde_json::json;

use crate::hub::HubEvent;
use crate::state::AppState;

pub fn session_envelope(state: &AppState, event: &HubEvent) -> Envelope {
    Envelope {
        v: adapter_protocol::PROTOCOL_VERSION,
        kind: Kind::Event,
        id: format!("evt_{}_{}", event.session_id, event.seq),
        reply_to: None,
        server_id: Some(state.store.server_id().to_string()),
        session_id: Some(event.session_id.clone()),
        operation_id: event.operation_id.clone(),
        epoch: Some(state.hub.epoch().to_string()),
        seq: Some(event.seq),
        msg_type: "session.event".into(),
        payload: serde_json::to_value(SessionEventPayload {
            event: event.event.clone(),
            turn_id: event.turn_id.clone(),
            operation_id: event.operation_id.clone(),
            observed_at_ms: event.at_ms,
        })
        .unwrap_or_default(),
    }
}

pub fn operation_envelope(state: &AppState, operation: &OperationView) -> Envelope {
    Envelope {
        v: adapter_protocol::PROTOCOL_VERSION,
        kind: Kind::Event,
        id: format!("op_{}", operation.operation_id),
        reply_to: None,
        server_id: Some(state.store.server_id().to_string()),
        session_id: Some(operation.session_id.clone()),
        operation_id: Some(operation.operation_id.clone()),
        epoch: Some(state.hub.epoch().to_string()),
        seq: None,
        msg_type: "operations.state".into(),
        payload: serde_json::to_value(OperationStatePayload {
            operation: operation.clone(),
            duplicate: false,
        })
        .unwrap_or_default(),
    }
}

pub fn connection_envelope(state: &AppState, connected: bool, message: String) -> Envelope {
    Envelope {
        v: adapter_protocol::PROTOCOL_VERSION,
        kind: Kind::Event,
        id: format!("conn_{}", now_ms()),
        reply_to: None,
        server_id: Some(state.store.server_id().to_string()),
        session_id: None,
        operation_id: None,
        epoch: Some(state.hub.epoch().to_string()),
        seq: None,
        msg_type: "server.connection".into(),
        payload: serde_json::to_value(ServerStatusPayload {
            jcode_connected: connected,
            message: Some(message),
            observed_at_ms: now_ms(),
        })
        .unwrap_or_default(),
    }
}

pub fn broadcast_connection(state: &Arc<AppState>, connected: bool, message: String) {
    state.hub.publish_connection(connected, message);
}

pub fn sessions_changed_envelope(state: &AppState) -> Envelope {
    Envelope {
        v: adapter_protocol::PROTOCOL_VERSION,
        kind: Kind::Event,
        id: format!("sessions_{}", now_ms()),
        reply_to: None,
        server_id: Some(state.store.server_id().to_string()),
        session_id: None,
        operation_id: None,
        epoch: Some(state.hub.epoch().to_string()),
        seq: None,
        msg_type: "sessions.changed".into(),
        payload: json!({"observed_at_ms": now_ms()}),
    }
}
