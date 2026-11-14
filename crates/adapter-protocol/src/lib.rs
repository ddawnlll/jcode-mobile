//! Mobile Adapter v3 wire contract for the Stillness client.
//!
//! This crate is deliberately independent of JCode and of the server. It
//! defines the authenticated mobile envelope, request payloads, snapshots and
//! stream events. JCode harness types are converted at the adapter boundary so
//! that an upstream protocol change cannot silently reshape the client API.
//!
//! Version 3 keeps every v2 request and event shape intact. It adds negotiated
//! protocol versions, a durable event journal with cursor replay, delta session
//! sync and diagnostics. A v2 client still connects: the adapter normalizes
//! outbound frames to the version the client negotiated and only emits v3-only
//! message types in reply to a v3-only request.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 3;
pub const MIN_PROTOCOL_VERSION: u32 = 2;
pub const WS_SUBPROTOCOL: &str = "jcode.mobile.v3";
pub const LEGACY_WS_SUBPROTOCOL: &str = "jcode.mobile.v2";
pub const TOKEN_SUBPROTOCOL_PREFIX: &str = "token.";

/// Every wire version this adapter can speak. The set is intentionally small:
/// a new version is added only with request-level conformance fixtures.
pub const SUPPORTED_PROTOCOL_VERSIONS: &[u32] = &[MIN_PROTOCOL_VERSION, PROTOCOL_VERSION];

pub fn supports_protocol_version(version: u32) -> bool {
    SUPPORTED_PROTOCOL_VERSIONS.contains(&version)
}

/// Negotiate the highest mutually supported version. Returns `None` when the
/// client range and the adapter range do not overlap.
pub fn negotiate_protocol_version(min_version: u32, max_version: u32) -> Option<u32> {
    let highest = max_version.min(PROTOCOL_VERSION);
    if highest < MIN_PROTOCOL_VERSION || min_version > highest {
        return None;
    }
    Some(highest.max(MIN_PROTOCOL_VERSION))
}

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
    // v3 additions. Each one has a dispatch arm and a conformance test.
    "protocol.v3",
    "events.journal",
    "events.subscribe",
    "events.ack",
    "sessions.delta",
    "diagnostics.snapshot",
    "attachments.images",
    "push.register_v1",
    "push.preferences",
];

/// Bounded image attachment limits. A larger request is rejected before it can
/// consume adapter memory.
pub const MAX_IMAGE_ATTACHMENTS: usize = 4;
pub const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;
pub const ALLOWED_IMAGE_MEDIA_TYPES: &[&str] =
    &["image/png", "image/jpeg", "image/webp", "image/gif"];

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
        if !supports_protocol_version(self.v) {
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
    UnsupportedCapability,
    NotFound,
    Conflict,
    NotSupported,
    NotConfigured,
    RateLimited,
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
    /// The version selected for this connection. Outbound frames use it.
    #[serde(default = "legacy_protocol_version")]
    pub negotiated_version: u32,
    /// Highest version this adapter implements, independent of negotiation.
    #[serde(default = "default_protocol_version")]
    pub max_protocol_version: u32,
    #[serde(default)]
    pub resumed_from_epoch: Option<String>,
}

const fn default_protocol_version() -> u32 {
    PROTOCOL_VERSION
}

// A field that did not exist in a v2 payload must not make the payload fail to
// parse if an older client is reading it.
const fn legacy_protocol_version() -> u32 {
    MIN_PROTOCOL_VERSION
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
    /// Delta revision this listing was observed at. Clients pass it back to
    /// `sessions.delta`; a v2 client can ignore it.
    #[serde(default)]
    pub revision: u64,
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
    /// Inline images carried with a user message. The adapter validates the
    /// media type and size before handing them to the daemon.
    #[serde(default)]
    pub images: Vec<AttachmentInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttachmentInput {
    pub media_type: String,
    /// Standard base64, not a data URL.
    pub data_base64: String,
    #[serde(default)]
    pub name: Option<String>,
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
// Durable event journal (v3)
// ---------------------------------------------------------------------------

/// One durably persisted, ordered session event. `seq` is assigned by the
/// adapter's SQLite journal inside the same transaction as the insert, so it
/// survives an adapter restart and can be replayed exactly once per cursor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JournalEventView {
    pub seq: u64,
    pub turn_id: Option<String>,
    pub operation_id: Option<String>,
    pub event: SessionEvent,
    pub observed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventsSubscribeRequest {
    pub session_id: String,
    /// Replay events with `seq > after_seq`. Absent or zero means "from the
    /// retention floor", which the reply reports explicitly.
    #[serde(default)]
    pub after_seq: Option<u64>,
    /// The epoch the client last observed. A mismatch means the client cannot
    /// trust its cursor as continuous and must resynchronize from a snapshot.
    #[serde(default)]
    pub epoch: Option<String>,
    #[serde(default = "default_events_limit")]
    pub limit: u32,
    /// Tail used when the reply also carries an authoritative snapshot.
    #[serde(default = "default_tail")]
    pub tail: u32,
    #[serde(default)]
    pub include_snapshot: bool,
}

fn default_events_limit() -> u32 {
    512
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventsSubscribePayload {
    pub session_id: String,
    pub epoch: String,
    pub events: Vec<JournalEventView>,
    /// Oldest sequence still retained for this session, or 0 when empty.
    pub floor_seq: u64,
    /// Highest sequence assigned for this session.
    pub latest_seq: u64,
    /// A gap means events between the requested cursor and the retention floor
    /// are no longer available. The client must not present its cursor as
    /// continuous.
    pub gap: bool,
    pub has_more: bool,
    /// True when the client's cursor or epoch cannot be resumed safely.
    pub resync_required: bool,
    /// Present only when `include_snapshot` was requested or resync is required.
    #[serde(default)]
    pub snapshot: Option<SessionSnapshotPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventsAckRequest {
    pub session_id: String,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventsAckPayload {
    pub session_id: String,
    pub acked_seq: u64,
    pub floor_seq: u64,
    pub latest_seq: u64,
}

// ---------------------------------------------------------------------------
// Delta session sync (v3)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionsDeltaRequest {
    /// Revision the client already holds. Zero requests a full listing.
    #[serde(default)]
    pub since_revision: u64,
    #[serde(default)]
    pub include_projects: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionsDeltaPayload {
    /// Authoritative revision at observation time. A client stores it with the
    /// merged result and sends it as `since_revision` next time.
    pub revision: u64,
    /// True when the payload is a complete replacement, not a delta.
    pub full: bool,
    pub sessions: Vec<SessionSummary>,
    pub removed: Vec<String>,
    pub projects: Vec<Project>,
    pub source: String,
    pub observed_at_ms: i64,
    pub stale: bool,
}

// ---------------------------------------------------------------------------
// Diagnostics (v3)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JcodeDiagnostics {
    pub healthy: bool,
    pub server: String,
    pub jcode_version: String,
    pub protocol_version: u32,
    pub capabilities: u32,
    pub last_contact_ms: Option<i64>,
    pub reconnects: u64,
    pub last_error: Option<String>,
    pub active_turns: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JournalDiagnostics {
    pub events: u64,
    pub bytes: u64,
    pub sessions: u64,
    pub oldest_observed_at_ms: Option<i64>,
    pub newest_observed_at_ms: Option<i64>,
    pub retention_per_session: u32,
    pub append_failures: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConnectionDiagnostics {
    pub active: u64,
    pub devices: u64,
    pub subscriptions: u64,
    pub frames_in: u64,
    pub frames_out: u64,
    pub gaps_announced: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OperationDiagnostics {
    pub pending: u64,
    pub unknown: u64,
    pub accepted: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LatencyDiagnostics {
    pub samples: u64,
    pub dispatch_p50_ms: Option<u64>,
    pub dispatch_p95_ms: Option<u64>,
    pub replay_p50_ms: Option<u64>,
    pub replay_p95_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FaultInjectionState {
    pub enabled: bool,
    pub rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiagnosticsSnapshot {
    pub adapter_version: String,
    pub protocol_version: u32,
    pub min_protocol_version: u32,
    pub epoch: String,
    pub started_at_ms: i64,
    pub observed_at_ms: i64,
    pub capabilities: Vec<String>,
    pub jcode: JcodeDiagnostics,
    pub journal: JournalDiagnostics,
    pub connections: ConnectionDiagnostics,
    pub operations: OperationDiagnostics,
    pub latency: LatencyDiagnostics,
    pub fault_injection: FaultInjectionState,
}

// ---------------------------------------------------------------------------
// Push registration (v3)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PushRegisterRequest {
    /// `android` or `ios`. The adapter stores it but does not infer a transport.
    pub platform: String,
    /// Provider token (for example an FCM registration token). Never returned
    /// in full by any reply.
    pub token: String,
    #[serde(default)]
    pub app_version: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PushPreferencesRequest {
    pub enabled: bool,
    pub turns: bool,
    pub failures: bool,
    pub approvals: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PushRegistrationView {
    pub device_id: String,
    pub platform: String,
    /// Last six characters only, for operator confirmation.
    pub token_suffix: String,
    pub enabled: bool,
    pub turns: bool,
    pub failures: bool,
    pub approvals: bool,
    pub app_version: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PushStatusPayload {
    pub provider: String,
    pub configured: bool,
    pub registrations: u32,
    pub sent: u64,
    pub failed: u64,
    pub deduped: u64,
    pub skipped: u64,
    pub last_error: Option<String>,
    pub last_success_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PushRegisterPayload {
    pub registered: bool,
    pub provider: String,
    pub configured: bool,
    pub registration: Option<PushRegistrationView>,
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
    fn v2_and_v3_envelopes_are_both_accepted() {
        for version in SUPPORTED_PROTOCOL_VERSIONS {
            let mut envelope = Envelope::request("req", "sessions.list", serde_json::json!({}));
            envelope.v = *version;
            assert_eq!(envelope.validate(), Ok(()), "version {version}");
        }
        let mut envelope = Envelope::request("req", "x", serde_json::json!({}));
        envelope.v = 4;
        assert!(envelope.validate().is_err());
    }

    #[test]
    fn negotiation_picks_the_highest_common_version() {
        assert_eq!(negotiate_protocol_version(2, 3), Some(3));
        assert_eq!(negotiate_protocol_version(2, 2), Some(2));
        assert_eq!(negotiate_protocol_version(3, 3), Some(3));
        assert_eq!(negotiate_protocol_version(1, 3), Some(3));
        assert_eq!(negotiate_protocol_version(2, 99), Some(3));
        // No overlap: a client that requires v4, or one that only speaks v1.
        assert_eq!(negotiate_protocol_version(4, 5), None);
        assert_eq!(negotiate_protocol_version(1, 1), None);
        assert_eq!(negotiate_protocol_version(5, 2), None);
    }

    #[test]
    fn v3_capabilities_are_declared_with_corresponding_requests() {
        for required in [
            "protocol.v3",
            "events.journal",
            "events.subscribe",
            "events.ack",
            "sessions.delta",
            "diagnostics.snapshot",
        ] {
            assert!(CAPABILITIES.contains(&required), "{required} missing");
        }
        // v2 capabilities remain present so a v2 client keeps its full surface.
        for legacy in ["sessions.snapshot", "operations.dispatch", "models.set"] {
            assert!(CAPABILITIES.contains(&legacy), "{legacy} removed");
        }
    }

    #[test]
    fn events_subscribe_fixture_round_trips() {
        let request = EventsSubscribeRequest {
            session_id: "s1".into(),
            after_seq: Some(41),
            epoch: Some("epoch_1".into()),
            limit: 128,
            tail: 80,
            include_snapshot: true,
        };
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["after_seq"], 41);
        let parsed: EventsSubscribeRequest = serde_json::from_value(value).unwrap();
        assert_eq!(parsed, request);

        let payload = EventsSubscribePayload {
            session_id: "s1".into(),
            epoch: "epoch_1".into(),
            events: vec![JournalEventView {
                seq: 42,
                turn_id: Some("t1".into()),
                operation_id: Some("op1".into()),
                event: SessionEvent::TextDelta {
                    text: "hello".into(),
                    message_id: None,
                },
                observed_at_ms: 1_700_000_000_000,
            }],
            floor_seq: 1,
            latest_seq: 42,
            gap: false,
            has_more: false,
            resync_required: false,
            snapshot: None,
        };
        let text = serde_json::to_string(&payload).unwrap();
        let parsed: EventsSubscribePayload = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed, payload);
    }

    #[test]
    fn v2_client_hello_payload_still_decodes_without_v3_fields() {
        let legacy = serde_json::json!({
            "server": {
                "server_id": "srv",
                "name": "n",
                "adapter_version": "0.3.1",
                "protocol_version": 2,
                "min_protocol_version": 2,
                "jcode_version": "x",
                "jcode_protocol_version": 1,
                "jcode_capabilities": [],
                "healthy": true,
                "capabilities": ["sessions.list"],
                "started_at_ms": 1,
                "command_code_available": null
            },
            "device": {"device_id":"d","name":"phone","created_at_ms":1,"last_seen_at_ms":1},
            "resumed": false
        });
        let hello: ServerHelloPayload = serde_json::from_value(legacy).unwrap();
        assert_eq!(hello.negotiated_version, MIN_PROTOCOL_VERSION);
        assert_eq!(hello.max_protocol_version, PROTOCOL_VERSION);
    }

    #[test]
    fn sessions_delta_and_diagnostics_fixtures_round_trip() {
        let delta = SessionsDeltaPayload {
            revision: 12,
            full: false,
            sessions: vec![],
            removed: vec!["s_old".into()],
            projects: vec![],
            source: "adapter.sqlite".into(),
            observed_at_ms: 5,
            stale: false,
        };
        let parsed: SessionsDeltaPayload =
            serde_json::from_str(&serde_json::to_string(&delta).unwrap()).unwrap();
        assert_eq!(parsed, delta);

        let diagnostics = DiagnosticsSnapshot {
            adapter_version: "0.4.0".into(),
            protocol_version: PROTOCOL_VERSION,
            min_protocol_version: MIN_PROTOCOL_VERSION,
            epoch: "epoch_1".into(),
            started_at_ms: 1,
            observed_at_ms: 2,
            capabilities: CAPABILITIES.iter().map(|c| (*c).to_string()).collect(),
            jcode: JcodeDiagnostics {
                healthy: true,
                server: "vps".into(),
                jcode_version: "0.99".into(),
                protocol_version: 1,
                capabilities: 4,
                last_contact_ms: Some(2),
                reconnects: 1,
                last_error: None,
                active_turns: 0,
            },
            journal: JournalDiagnostics {
                events: 10,
                bytes: 1024,
                sessions: 2,
                oldest_observed_at_ms: Some(1),
                newest_observed_at_ms: Some(2),
                retention_per_session: 4096,
                append_failures: 0,
            },
            connections: ConnectionDiagnostics {
                active: 1,
                devices: 1,
                subscriptions: 1,
                frames_in: 1,
                frames_out: 1,
                gaps_announced: 0,
            },
            operations: OperationDiagnostics {
                pending: 0,
                unknown: 0,
                accepted: 1,
            },
            latency: LatencyDiagnostics {
                samples: 1,
                dispatch_p50_ms: Some(3),
                dispatch_p95_ms: Some(4),
                replay_p50_ms: Some(1),
                replay_p95_ms: Some(2),
            },
            fault_injection: FaultInjectionState {
                enabled: false,
                rules: vec![],
            },
        };
        let parsed: DiagnosticsSnapshot =
            serde_json::from_str(&serde_json::to_string(&diagnostics).unwrap()).unwrap();
        assert_eq!(parsed, diagnostics);
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
