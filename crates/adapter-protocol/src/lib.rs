//! Mobile Adapter v2 wire contract for the Stillness 12 client.
//!
//! This crate is deliberately independent of JCode and of the server. It
//! defines the authenticated mobile envelope, request payloads, snapshots and
//! stream events. JCode harness types are converted at the adapter boundary so
//! that an upstream protocol change cannot silently reshape the client API.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;
pub const MIN_PROTOCOL_VERSION: u32 = 2;
pub const WS_SUBPROTOCOL: &str = "jcode.mobile.v2";
pub const TOKEN_SUBPROTOCOL_PREFIX: &str = "token.";

/// Capabilities the adapter actually implements. Do not add a string here
/// until the corresponding request has a tested implementation.
pub const CAPABILITIES: &[&str] = &[
    "pairing",
    "device_revocation",
    "sessions.list",
    "sessions.create",
    "sessions.subscribe",
    "sessions.snapshot",
    "sessions.history",
    "sessions.rename",
    "operations.dispatch",
    "operations.lookup",
    "operations.cancel",
    "projects.list",
    "projects.create",
    "files.list_dir",
    "files.read_preview",
    "folders.create",
    "models.list",
    "models.set",
    "reasoning.set",
    "context.snapshot",
    "plan.snapshot",
    "activity.snapshot",
    "tool.permission_response",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Request,
    Response,
    Event,
}

/// One WebSocket frame. Optional scoping fields are present only when the
/// request or event belongs to that scope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Envelope {
    pub v: u32,
    pub kind: Kind,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub payload: serde_json::Value,
}

impl Envelope {
    pub fn request(
        id: impl Into<String>,
        msg_type: impl Into<String>,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            kind: Kind::Request,
            id: id.into(),
            reply_to: None,
            server_id: None,
            session_id: None,
            operation_id: None,
            epoch: None,
            seq: None,
            msg_type: msg_type.into(),
            payload,
        }
    }

    pub fn response(
        reply_to: impl Into<String>,
        msg_type: impl Into<String>,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            kind: Kind::Response,
            id: uuid_like(),
            reply_to: Some(reply_to.into()),
            server_id: None,
            session_id: None,
            operation_id: None,
            epoch: None,
            seq: None,
            msg_type: msg_type.into(),
            payload,
        }
    }

    pub fn error(reply_to: impl Into<String>, code: ErrorCode, message: impl Into<String>) -> Self {
        Self::response(
            reply_to,
            "error",
            serde_json::to_value(ErrorPayload {
                code,
                message: message.into(),
                retryable: false,
            })
            .unwrap_or_default(),
        )
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.v != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion(self.v));
        }
        if self.id.trim().is_empty() {
            return Err(ProtocolError::MissingId);
        }
        Ok(())
    }
}

fn uuid_like() -> String {
    // The protocol crate avoids a UUID dependency for pure serialization. The
    // server supplies real client ids; this fallback is only for responses.
    format!(
        "srv-{:x}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default(),
        rand_suffix()
    )
}

fn rand_suffix() -> u32 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::time::Instant::now().hash(&mut hasher);
    (hasher.finish() & 0xffff_ffff) as u32
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Unauthorized,
    Forbidden,
    BadRequest,
    UnsupportedVersion,
    NotFound,
    Conflict,
    NotSupported,
    ProviderUnavailable,
    AccountMissing,
    ModelUnavailable,
    DeliveryUnconfirmed,
    TurnMismatch,
    Backpressure,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorPayload {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    #[error("unsupported mobile protocol version {0}")]
    UnsupportedVersion(u32),
    #[error("envelope id is required")]
    MissingId,
}

// ---------------------------------------------------------------------------
// Handshake and pairing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClientHello {
    pub client_name: String,
    pub client_version: String,
    pub min_version: u32,
    pub max_version: u32,
    #[serde(default)]
    pub supports: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerInfo {
    pub server_id: String,
    pub name: String,
    pub adapter_version: String,
    pub protocol_version: u32,
    pub min_protocol_version: u32,
    pub jcode_version: String,
    pub jcode_protocol_version: u32,
    pub jcode_capabilities: Vec<String>,
    pub healthy: bool,
    pub capabilities: Vec<String>,
    pub started_at_ms: i64,
    /// `None` until a real runtime/model response proves availability.
    pub command_code_available: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceInfo {
    pub device_id: String,
    pub name: String,
    pub created_at_ms: i64,
    pub last_seen_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerHelloPayload {
    pub server: ServerInfo,
    pub device: DeviceInfo,
    pub resumed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairRedeemRequest {
    pub code: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairRedeemResponse {
    pub token: String,
    pub device: DeviceInfo,
    pub server: ServerInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceRevokeRequest {
    pub device_id: String,
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionSummary {
    pub session_id: String,
    pub title: Option<String>,
    pub title_source: String,
    pub status: String,
    pub working_dir: Option<String>,
    pub project_id: Option<String>,
    pub updated_at_ms: Option<i64>,
    pub transcript_bytes: Option<u64>,
    pub saved: bool,
    pub archived: bool,
    pub parent_session_id: Option<String>,
    pub agent_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionsListPayload {
    pub sessions: Vec<SessionSummary>,
    pub projects: Vec<Project>,
    pub source: String,
    pub observed_at_ms: i64,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub project_id: String,
    pub label: String,
    pub path: String,
    pub pinned: bool,
    pub created_at_ms: i64,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateSessionRequest {
    /// Client-generated idempotency key. A retry with the same id returns the
    /// same session instead of creating a second one.
    pub client_request_id: String,
    pub project_id: Option<String>,
    pub working_dir: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateSessionResponse {
    pub session: SessionSummary,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionRef {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryMessageView {
    pub index: usize,
    pub role: String,
    pub content: String,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub response_stats: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeView {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub auth_method: Option<String>,
    pub account_label: Option<String>,
    pub providers: Vec<String>,
    pub routes: Vec<ModelRouteView>,
    pub observed_at_ms: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelRouteView {
    pub model: String,
    pub provider: String,
    pub api_method: String,
    pub available: bool,
    pub detail: String,
    pub is_command_code: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContextView {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_input: Option<u64>,
    pub cache_creation_input: Option<u64>,
    pub effective_budget: Option<u64>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub observed_at_ms: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActiveTurnView {
    pub turn_id: String,
    pub operation_id: String,
    pub status: String,
    pub started_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionSnapshotPayload {
    pub session: SessionSummary,
    pub messages: Vec<HistoryMessageView>,
    pub runtime: Option<RuntimeView>,
    pub plan: Option<serde_json::Value>,
    pub context: Option<ContextView>,
    /// Present when this adapter still has an active turn for the session. A
    /// returning client can show Stop without inventing completion or text.
    #[serde(default)]
    pub active_turn: Option<ActiveTurnView>,
    pub epoch: String,
    pub last_seq: u64,
    pub revision: u64,
    pub authoritative_at_ms: i64,
    pub stale: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionsSubscribeRequest {
    pub session_id: String,
    #[serde(default = "default_tail")]
    pub tail: u32,
    #[serde(default)]
    pub after_seq: Option<u64>,
}

fn default_tail() -> u32 {
    80
}

// ---------------------------------------------------------------------------
// Streaming events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionEvent {
    TurnStarted {
        turn_id: String,
        operation_id: String,
    },
    TextDelta {
        text: String,
        message_id: Option<String>,
    },
    TextDone {
        message_id: Option<String>,
    },
    TextReplace {
        text: String,
        message_id: Option<String>,
    },
    ReasoningDelta {
        text: String,
    },
    ReasoningDone {
        duration_secs: Option<f64>,
    },
    ToolStart {
        call_id: String,
        name: String,
    },
    ToolInputDelta {
        call_id: String,
        delta: String,
    },
    ToolExec {
        call_id: String,
        name: String,
    },
    ToolDone {
        call_id: String,
        name: String,
        output: String,
        error: Option<String>,
    },
    PermissionRequest {
        request_id: String,
        tool_name: String,
        description: String,
    },
    TokenUsage {
        input: u64,
        output: u64,
        cache_read_input: Option<u64>,
        cache_creation_input: Option<u64>,
        effective_budget: Option<u64>,
    },
    SessionStatus {
        status: String,
        pending_soft_interrupts: Option<u32>,
    },
    ConnectionPhase {
        phase: String,
    },
    SessionRecovery {
        continuation_message: String,
        reconnect_notice: Option<String>,
    },
    /// The daemon's persisted title changed. `title` is absent when the user
    /// cleared a custom title and the generated display title is in use.
    TitleChanged {
        title: Option<String>,
        display_title: String,
    },
    PlanUpdated {
        plan: serde_json::Value,
    },
    ContextCapChanged {
        max_context_tokens: Option<u64>,
        effective_budget: u64,
    },
    AdapterError {
        code: String,
        message: String,
        retryable: bool,
    },
    TurnStopped {
        turn_id: Option<String>,
        reason: String,
        message: String,
        provider_stop_reason: Option<String>,
    },
    TurnDone {
        turn_id: Option<String>,
    },
    NeedsReconcile {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionEventPayload {
    pub event: SessionEvent,
    pub turn_id: Option<String>,
    pub operation_id: Option<String>,
    pub observed_at_ms: i64,
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationState {
    Staged,
    Reserved,
    Dispatching,
    Accepted,
    Rejected,
    Unknown,
    ObservedInHistory,
    Cancelled,
}

impl OperationState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Accepted
                | Self::Rejected
                | Self::Unknown
                | Self::ObservedInHistory
                | Self::Cancelled
        )
    }

    /// Monotonic transition check. `Unknown` is a terminal *observation* state
    /// for this attempt; a later history observation may promote it to
    /// `ObservedInHistory` without claiming an acknowledgment.
    pub fn can_transition_to(self, next: Self) -> bool {
        use OperationState::*;
        match (self, next) {
            (a, b) if a == b => true,
            (Staged, Reserved) => true,
            (Staged, Cancelled) => true,
            (Reserved, Dispatching) => true,
            (Reserved, Cancelled) => true,
            (Reserved, Rejected) => true,
            (Dispatching, Accepted) => true,
            (Dispatching, Rejected) => true,
            (Dispatching, Unknown) => true,
            (Accepted, ObservedInHistory) => true,
            (Unknown, ObservedInHistory) => true,
            // A late acknowledgment is authoritative evidence even after the
            // adapter stopped waiting for it. Never resend, but resolve the
            // observation honestly.
            (Unknown, Accepted) => true,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OperationView {
    pub operation_id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub state: OperationState,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OperationReserveRequest {
    pub operation_id: String,
    pub session_id: String,
    pub kind: String,
    pub body: String,
    pub expected_turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OperationDispatchRequest {
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OperationLookupRequest {
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OperationStatePayload {
    pub operation: OperationView,
    #[serde(default)]
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CancelTurnRequest {
    pub session_id: String,
    pub operation_id: Option<String>,
    pub expected_turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CancelTurnResponse {
    pub cancelled: bool,
    pub turn_id: Option<String>,
    /// The upstream harness only has session-scoped cancellation. The adapter
    /// verifies the expected turn before cancelling and reports that residual
    /// race explicitly rather than claiming atomic turn cancellation.
    pub atomic_turn_scope: bool,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RenameSessionRequest {
    pub session_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SetModelRequest {
    pub session_id: String,
    pub model: String,
    /// Confirm the route belongs to this provider before applying it.
    pub expected_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SetReasoningRequest {
    pub session_id: String,
    pub effort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelsListPayload {
    pub runtime: RuntimeView,
    pub models: Vec<ModelRouteView>,
    pub source: String,
    pub observed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerStatusPayload {
    pub jcode_connected: bool,
    pub message: Option<String>,
    pub observed_at_ms: i64,
}

// ---------------------------------------------------------------------------
// Workspace files
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ListDirRequest {
    pub project_id: String,
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_page")]
    pub limit: u32,
    #[serde(default)]
    pub cursor: Option<String>,
}

fn default_page() -> u32 {
    200
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified_at_ms: Option<i64>,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DirListing {
    pub project_id: String,
    pub path: String,
    pub entries: Vec<DirEntry>,
    pub next_cursor: Option<String>,
    pub truncated: bool,
    pub observed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReadPreviewRequest {
    pub project_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FilePreview {
    pub project_id: String,
    pub path: String,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
    pub binary: bool,
    pub observed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateFolderRequest {
    pub project_id: String,
    pub parent: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateFolderResponse {
    pub project_id: String,
    pub path: String,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateProjectRequest {
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub pinned: bool,
}

// ---------------------------------------------------------------------------
// Plan / activity / tool responses
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanSnapshotPayload {
    pub session_id: String,
    pub plan: Option<serde_json::Value>,
    pub source: String,
    pub observed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityItem {
    pub at_ms: i64,
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivitySnapshotPayload {
    pub session_id: String,
    pub items: Vec<ActivityItem>,
    pub truncated: bool,
    pub source: String,
    pub observed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PermissionResponseRequest {
    pub session_id: String,
    pub request_id: String,
    pub decision: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_round_trips() {
        let envelope = Envelope::request("req-1", "server.hello", serde_json::json!({"x": 1}));
        let text = serde_json::to_string(&envelope).unwrap();
        let parsed: Envelope = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed, envelope);
        assert_eq!(parsed.validate(), Ok(()));
    }

    #[test]
    fn wrong_version_is_rejected() {
        let mut envelope = Envelope::request("req-1", "x", serde_json::json!({}));
        envelope.v = 1;
        assert!(matches!(
            envelope.validate(),
            Err(ProtocolError::UnsupportedVersion(1))
        ));
    }

    #[test]
    fn operation_states_are_monotonic() {
        use OperationState::*;
        assert!(Staged.can_transition_to(Reserved));
        assert!(Reserved.can_transition_to(Dispatching));
        assert!(Dispatching.can_transition_to(Accepted));
        assert!(Dispatching.can_transition_to(Unknown));
        assert!(Unknown.can_transition_to(ObservedInHistory));
        assert!(!Accepted.can_transition_to(Dispatching));
        assert!(!Rejected.can_transition_to(Accepted));
        assert!(!Staged.can_transition_to(Accepted));
    }

    #[test]
    fn session_event_is_tagged() {
        let event = SessionEvent::ToolDone {
            call_id: "c1".into(),
            name: "bash".into(),
            output: "ok".into(),
            error: None,
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["kind"], "tool_done");
        assert_eq!(value["call_id"], "c1");
    }
}
