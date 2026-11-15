use std::sync::Arc;

use adapter_core::now_ms;
use adapter_protocol::{
    Envelope, Kind, OperationStatePayload, OperationView, ServerStatusPayload, SessionEvent,
};
use serde::Serialize;
use serde_json::json;

use crate::hub::HubEvent;
use crate::state::AppState;

pub fn encode_session(
    state: &AppState,
    event: &HubEvent,
    version: u32,
) -> serde_json::Result<String> {
    #[derive(Serialize)]
    struct SessionPayload<'a> {
        event: &'a SessionEvent,
        turn_id: Option<&'a str>,
        operation_id: Option<&'a str>,
        observed_at_ms: i64,
    }

    #[derive(Serialize)]
    struct SessionEnvelope<'a> {
        v: u32,
        kind: Kind,
        id: String,
        server_id: &'a str,
        session_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation_id: Option<&'a str>,
        epoch: &'a str,
        seq: u64,
        #[serde(rename = "type")]
        msg_type: &'static str,
        payload: SessionPayload<'a>,
    }

    serde_json::to_string(&SessionEnvelope {
        v: version,
        kind: Kind::Event,
        id: format!("evt_{}_{}", event.session_id, event.seq),
        server_id: state.store.server_id(),
        session_id: &event.session_id,
        operation_id: event.operation_id.as_deref(),
        epoch: state.hub.epoch(),
        seq: event.seq,
        msg_type: "session.event",
        payload: SessionPayload {
            event: &event.event,
            turn_id: event.turn_id.as_deref(),
            operation_id: event.operation_id.as_deref(),
            observed_at_ms: event.at_ms,
        },
    })
}

pub fn session_update(
    state: &AppState,
    session_id: String,
    msg_type: &str,
    payload: serde_json::Value,
) -> Envelope {
    Envelope {
        v: adapter_protocol::PROTOCOL_VERSION,
        kind: Kind::Event,
        id: format!("{msg_type}_{}", now_ms()),
        reply_to: None,
        server_id: Some(state.store.server_id().to_owned()),
        session_id: Some(session_id),
        operation_id: None,
        epoch: Some(state.hub.epoch().to_owned()),
        seq: None,
        msg_type: msg_type.into(),
        payload,
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
