use std::sync::Mutex;

use adapter_protocol::{
    HistoryMessageView, ModelRouteView, RuntimeIdentity, RuntimeView, SessionEvent, SessionSummary,
    SwarmAgentView,
};
use serde_json::Value;

pub use crate::paths::{CoreError, CoreResult, now_ms};

#[derive(Debug, Clone, Default)]
pub struct BackendInfo {
    pub server: String,
    pub jcode_version: String,
    pub protocol_version: u32,
    pub capabilities: Vec<String>,
    pub healthy: bool,
}

#[derive(Debug, Clone)]
pub struct BackendSession {
    pub session_id: String,
    pub title: Option<String>,
    pub status: String,
    pub working_dir: Option<String>,
    pub updated_at_ms: Option<i64>,
    pub transcript_bytes: Option<u64>,
    pub saved: bool,
    pub archived: bool,
    pub parent_session_id: Option<String>,
    pub agent_label: Option<String>,
    pub swarm_status: Option<String>,
}

impl BackendSession {
    pub fn into_summary(
        self,
        title_override: Option<String>,
        project_id: Option<String>,
    ) -> SessionSummary {
        let (title, title_source) = match title_override {
            Some(title) => (Some(title), "adapter_rename"),
            None => (self.title, "jcode"),
        };
        SessionSummary {
            session_id: self.session_id,
            title,
            title_source: title_source.into(),
            status: self.status,
            working_dir: self.working_dir,
            project_id,
            updated_at_ms: self.updated_at_ms,
            transcript_bytes: self.transcript_bytes,
            saved: self.saved,
            archived: self.archived,
            parent_session_id: self.parent_session_id,
            agent_label: self.agent_label,
            swarm_status: self.swarm_status,
            favorite: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BackendRuntime {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub auth_method: Option<String>,
    pub account_label: Option<String>,
    pub providers: Vec<String>,
    pub routes: Vec<BackendRoute>,
}

#[derive(Debug, Clone)]
pub struct BackendRoute {
    pub model: String,
    pub provider: String,
    pub api_method: String,
    pub available: bool,
    pub detail: String,
}

/// Provider labels vary between surfaces: the daemon reports `Command Code`
/// on runtime routes while config and the CLI use `command-code`. Compare the
/// normalized token instead of requiring one spelling.
pub fn is_command_code_provider(provider: &str) -> bool {
    provider
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>()
        == "commandcode"
}

impl BackendRuntime {
    pub fn view(&self, observed_at_ms: i64) -> RuntimeView {
        RuntimeView {
            provider: self.provider.clone(),
            model: self.model.clone(),
            reasoning_effort: self.reasoning_effort.clone(),
            effort_options: effort_options(self.provider.as_deref(), self.model.as_deref()),
            auth_method: self.auth_method.clone(),
            account_label: self.account_label.clone(),
            providers: self.providers.clone(),
            routes: self
                .routes
                .iter()
                .map(|route| ModelRouteView {
                    model: route.model.clone(),
                    provider: route.provider.clone(),
                    api_method: route.api_method.clone(),
                    available: route.available,
                    detail: route.detail.clone(),
                    is_command_code: is_command_code_provider(&route.provider),
                })
                .collect(),
            observed_at_ms,
            source: "jcode.runtime_info".into(),
        }
    }
}

pub(crate) fn effort_options(provider: Option<&str>, model: Option<&str>) -> Vec<String> {
    jcode_provider_core::inferred_reasoning_efforts(provider, model)
        .into_iter()
        .map(str::to_owned)
        .collect()
}

pub fn is_reasoning_effort(effort: &str) -> bool {
    effort == "swarm" || jcode_provider_core::canonical_reasoning_effort(effort).is_some()
}

#[derive(Debug, Clone)]
pub enum BackendEvent {
    Connected {
        info: BackendInfo,
    },
    Disconnected {
        message: String,
    },
    Accepted {
        session_id: String,
    },
    RequestError {
        session_id: String,
        code: String,
        message: String,
    },
    Runtime {
        session_id: String,
        runtime: RuntimeIdentity,
    },
    Swarm {
        session_id: String,
        agents: Vec<SwarmAgentView>,
    },
    SessionsChanged,
    Session {
        session_id: String,
        event: SessionEvent,
    },
}

pub trait Backend: Send + Sync {
    fn info(&self) -> BackendInfo;
    fn list_sessions(&self) -> CoreResult<Vec<BackendSession>>;
    fn create_session(&self, working_dir: Option<&str>) -> CoreResult<BackendSession>;
    fn attach_session(&self, session_id: &str) -> CoreResult<BackendSession>;
    fn history(&self, session_id: &str, tail: Option<u32>) -> CoreResult<Vec<HistoryMessageView>>;
    fn runtime(&self, session_id: &str) -> CoreResult<BackendRuntime>;
    fn list_models(&self, session_id: &str) -> CoreResult<(Vec<String>, Option<String>)>;
    fn set_model(&self, session_id: &str, model: &str) -> CoreResult<()>;
    fn set_route(&self, session_id: &str, route: &BackendRoute) -> CoreResult<()> {
        self.set_model(session_id, &route.model)
    }
    fn swarm_agents(&self, _session_id: &str) -> Option<Vec<SwarmAgentView>> {
        None
    }
    fn set_reasoning_effort(&self, session_id: &str, effort: &str) -> CoreResult<()>;
    fn set_context_cap(&self, session_id: &str, max_tokens: Option<u64>) -> CoreResult<()>;
    fn rename_session(&self, session_id: &str, title: Option<&str>) -> CoreResult<()>;
    fn archive_session(&self, session_id: &str) -> CoreResult<()> {
        let _ = session_id;
        Err(CoreError::InvalidInput(
            "this backend does not support archiving".into(),
        ))
    }
    fn restore_session(&self, session_id: &str) -> CoreResult<()> {
        let _ = session_id;
        Err(CoreError::InvalidInput(
            "this backend does not support restoring".into(),
        ))
    }
    fn plan(&self, session_id: &str) -> CoreResult<Option<Value>>;
    /// Write a user message. Returning Ok means the frame was written, not that
    /// the agent accepted it. Acceptance arrives as `BackendEvent::Accepted`.
    fn send(&self, session_id: &str, content: &str) -> CoreResult<()>;
    /// Send a user message with inline images as `(media_type, base64)` pairs.
    /// Backends that cannot carry images must reject the call, never silently
    /// drop them.
    fn send_images(
        &self,
        _session_id: &str,
        _content: &str,
        _images: Vec<(String, String)>,
    ) -> CoreResult<()> {
        Err(CoreError::InvalidInput(
            "this backend does not support image attachments".into(),
        ))
    }
    fn cancel(&self, session_id: &str) -> CoreResult<()>;
    /// Ask the daemon for its own current activity for this session.
    ///
    /// Backends that cannot answer must return `unknown`; guessing idle would
    /// let a returning client start a second turn beside a running one.
    fn daemon_status(&self, _session_id: &str) -> CoreResult<DaemonStatus> {
        Ok(DaemonStatus::unknown("backend"))
    }
    fn permission_response(
        &self,
        session_id: &str,
        request_id: &str,
        decision: &str,
    ) -> CoreResult<()>;
    fn ping(&self) -> CoreResult<()>;
    fn healthy(&self) -> bool;
}

/// Adapter-side turn state shared by the event fanout and request handlers.
/// This is intentionally not derived from a timer: a turn exists only after a
/// dispatch was written and before the daemon reports completion.
#[derive(Debug, Clone, Default)]
pub struct TurnState {
    pub active: Option<ActiveTurn>,
    pub last_turn_id: Option<String>,
    pub daemon: Option<DaemonStatus>,
    /// A cancel request is between its atomic decision and the daemon reply.
    /// While this is set, no new turn may be dispatched for the session.
    pub cancelling: Option<CancelLease>,
}

#[derive(Debug, Clone)]
pub struct ActiveTurn {
    pub turn_id: String,
    pub operation_id: String,
    pub started_at_ms: i64,
    pub status: String,
    /// A daemon event for this session proves the message reached a turn even
    /// when the transport-level acknowledgment is missing.
    pub observed: bool,
}

/// Normalized daemon activity. The raw value is retained for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaemonStatus {
    /// `running`, `idle`, or `unknown`.
    pub status: String,
    pub raw_status: String,
    pub observed_at_ms: i64,
    pub source: String,
}

impl DaemonStatus {
    pub fn unknown(source: &str) -> Self {
        Self {
            status: "unknown".into(),
            raw_status: "unknown".into(),
            observed_at_ms: now_ms(),
            source: source.into(),
        }
    }

    pub(crate) fn from_raw(status: &str, source: &str) -> Option<Self> {
        let normalized = match status {
            "idle" | "closed" | "cancelled" => "idle",
            // `attached` is a broadcast lifecycle notice, not this
            // connection's activity.
            "attached" => return None,
            "running" | "generating" | "tool_running" | "processing" => "running",
            "unknown" => "unknown",
            "" => "unknown",
            _ => "unknown",
        };
        Some(Self {
            status: normalized.into(),
            raw_status: status.into(),
            observed_at_ms: now_ms(),
            source: source.into(),
        })
    }

    pub fn is_idle(&self) -> bool {
        self.status == "idle"
    }

    pub fn is_running(&self) -> bool {
        self.status == "running"
    }
}

/// Why a stop request may proceed. The adapter decides this atomically against
/// its turn registry so concurrent stops cannot cancel twice or target a newer
/// turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CancelTarget {
    /// A turn the adapter started and can name.
    Known(String),
    /// The daemon proves this session is generating, but the adapter restarted
    /// and no longer knows the turn id.
    DaemonRunning,
    /// The daemon proves the session is already idle. Safe no-op.
    AlreadyStopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CancelDenied {
    NoTarget,
    /// Another stop for the same turn is already in flight. Retrying would
    /// duplicate the daemon cancel.
    InFlight(Option<String>),
    /// The caller's turn id belongs to an older turn.
    StaleTarget {
        last_turn_id: Option<String>,
    },
    /// The daemon did not answer, or its answer is too old to fence a newer turn.
    Unknown,
}

#[derive(Debug, Clone)]
pub struct CancelLease {
    pub session_id: String,
    pub turn_id: Option<String>,
    pub started_at_ms: i64,
}

/// A cancel decision can only be fenced for this long. Beyond it the adapter
/// must probe the daemon again rather than trust a stale status.
const DAEMON_STATUS_FRESH_MS: i64 = 5_000;
/// A cancel lease must not block dispatch forever if the daemon never reports
/// a terminal event. It expires independently of the daemon.
const CANCEL_LEASE_MAX_MS: i64 = 15_000;

#[derive(Default)]
pub struct SessionTurnRegistry {
    inner: Mutex<std::collections::HashMap<String, TurnState>>,
}

impl SessionTurnRegistry {
    pub fn begin(&self, session_id: &str, operation_id: &str) -> String {
        let turn_id = format!("turn_{}", uuid::Uuid::new_v4().simple());
        let mut inner = self.inner.lock().expect("turn registry");
        let entry = inner.entry(session_id.to_string()).or_default();
        entry.last_turn_id = Some(turn_id.clone());
        entry.active = Some(ActiveTurn {
            turn_id: turn_id.clone(),
            operation_id: operation_id.to_string(),
            started_at_ms: now_ms(),
            status: "dispatching".into(),
            observed: false,
        });
        turn_id
    }

    pub fn mark_accepted(&self, session_id: &str, operation_id: &str) -> Option<String> {
        let mut inner = self.inner.lock().expect("turn registry");
        let entry = inner.get_mut(session_id)?;
        let active = entry.active.as_mut()?;
        if active.operation_id == operation_id {
            active.status = "accepted".into();
            Some(active.turn_id.clone())
        } else {
            None
        }
    }

    pub fn mark_observed(&self, session_id: &str, operation_id: &str) -> Option<String> {
        let mut inner = self.inner.lock().expect("turn registry");
        let entry = inner.get_mut(session_id)?;
        let active = entry.active.as_mut()?;
        if active.operation_id == operation_id {
            active.observed = true;
            Some(active.turn_id.clone())
        } else {
            None
        }
    }

    pub fn active(&self, session_id: &str) -> Option<ActiveTurn> {
        self.inner
            .lock()
            .expect("turn registry")
            .get(session_id)
            .and_then(|state| state.active.clone())
    }

    pub fn finish(&self, session_id: &str) -> Option<ActiveTurn> {
        self.inner
            .lock()
            .expect("turn registry")
            .get_mut(session_id)
            .and_then(|state| {
                state.cancelling = None;
                state.active.take()
            })
    }

    /// Record the daemon's own answer for this session. Returns the normalized
    /// status when it is authoritative (`running` or `idle`).
    pub fn record_daemon_status(
        &self,
        session_id: &str,
        raw: &str,
        source: &str,
    ) -> Option<DaemonStatus> {
        let status = DaemonStatus::from_raw(raw, source)?;
        let mut inner = self.inner.lock().expect("turn registry");
        let entry = inner.entry(session_id.to_string()).or_default();
        entry.daemon = Some(status.clone());
        Some(status)
    }

    pub fn daemon_status(&self, session_id: &str) -> Option<DaemonStatus> {
        self.inner
            .lock()
            .expect("turn registry")
            .get(session_id)
            .and_then(|state| state.daemon.clone())
    }

    /// A daemon-confirmed idle session settles an adapter turn that lost its
    /// terminal event. A just-dispatched, not-yet-observed turn keeps a short
    /// grace window so the pre-send `idle` status cannot erase it.
    pub fn reconcile_idle(&self, session_id: &str) -> Option<ActiveTurn> {
        let mut inner = self.inner.lock().expect("turn registry");
        let entry = inner.get_mut(session_id)?;
        let active = entry.active.as_ref()?;
        let settled = active.observed
            || entry.cancelling.is_some()
            || now_ms().saturating_sub(active.started_at_ms) > 5_000;
        if settled {
            entry.cancelling = None;
            entry.active.take()
        } else {
            None
        }
    }

    /// Clear the adapter turn after an explicit probe proved the daemon idle.
    /// Unlike `reconcile_idle` this has no grace window: the caller asked the
    /// daemon directly and the answer is authoritative.
    pub fn settle_idle(&self, session_id: &str) -> Option<ActiveTurn> {
        let mut inner = self.inner.lock().expect("turn registry");
        let entry = inner.get_mut(session_id)?;
        entry.cancelling = None;
        entry.active.take()
    }

    /// Atomically decide whether a stop may be sent. On success the returned
    /// lease blocks new dispatches until `complete_cancel`.
    pub fn begin_cancel(
        &self,
        session_id: &str,
        expected_turn_id: Option<&str>,
        expected_operation_id: Option<&str>,
        allow_running_unknown: bool,
    ) -> Result<CancelTarget, CancelDenied> {
        let mut inner = self.inner.lock().expect("turn registry");
        let entry = inner.entry(session_id.to_string()).or_default();
        if let Some(lease) = entry.cancelling.as_ref() {
            if now_ms().saturating_sub(lease.started_at_ms) < CANCEL_LEASE_MAX_MS {
                return Err(CancelDenied::InFlight(lease.turn_id.clone()));
            }
            entry.cancelling = None;
        }
        if let Some(active) = entry.active.as_ref() {
            if expected_turn_id.is_some_and(|expected| expected != active.turn_id)
                || expected_operation_id.is_some_and(|expected| expected != active.operation_id)
            {
                return Err(CancelDenied::StaleTarget {
                    last_turn_id: entry.last_turn_id.clone(),
                });
            }
            if expected_turn_id.is_none() && expected_operation_id.is_none() {
                return Err(CancelDenied::NoTarget);
            }
            // The daemon cancel is session-scoped. Without a fresh daemon
            // answer, a newer turn may have replaced the one this adapter
            // remembers, so refuse rather than risk cancelling it.
            let Some(daemon) = entry.daemon.as_ref() else {
                return Err(CancelDenied::Unknown);
            };
            if now_ms().saturating_sub(daemon.observed_at_ms) > DAEMON_STATUS_FRESH_MS {
                return Err(CancelDenied::Unknown);
            }
            if daemon.is_idle() {
                entry.active = None;
                entry.cancelling = None;
                return Ok(CancelTarget::AlreadyStopped);
            }
            if !daemon.is_running() {
                return Err(CancelDenied::Unknown);
            }
            let turn_id = Some(active.turn_id.clone());
            entry.cancelling = Some(CancelLease {
                session_id: session_id.into(),
                turn_id: turn_id.clone(),
                started_at_ms: now_ms(),
            });
            return Ok(CancelTarget::Known(active.turn_id.clone()));
        }
        // A stale expected id must never authorize a session-scoped daemon
        // cancel: a newer turn may have started since the phone saw it.
        if let Some(expected) = expected_turn_id
            && entry.last_turn_id.as_deref() != Some(expected)
        {
            return Err(CancelDenied::StaleTarget {
                last_turn_id: entry.last_turn_id.clone(),
            });
        }
        let Some(daemon) = entry.daemon.as_ref() else {
            return Err(CancelDenied::Unknown);
        };
        if now_ms().saturating_sub(daemon.observed_at_ms) > DAEMON_STATUS_FRESH_MS {
            return Err(CancelDenied::Unknown);
        }
        if daemon.is_idle() {
            return Ok(CancelTarget::AlreadyStopped);
        }
        if !daemon.is_running() {
            return Err(CancelDenied::Unknown);
        }
        if !allow_running_unknown {
            return Err(CancelDenied::NoTarget);
        }
        entry.cancelling = Some(CancelLease {
            session_id: session_id.into(),
            turn_id: None,
            started_at_ms: now_ms(),
        });
        Ok(CancelTarget::DaemonRunning)
    }

    /// Release the cancel gate after the daemon reply (or its failure).
    pub fn complete_cancel(&self, session_id: &str, turn_id: Option<&str>) {
        let mut inner = self.inner.lock().expect("turn registry");
        if let Some(entry) = inner.get_mut(session_id)
            && let Some(lease) = entry.cancelling.as_ref()
            && lease.turn_id.as_deref() == turn_id
        {
            entry.cancelling = None;
        }
    }

    /// A dispatch must not interleave with an in-flight cancel.
    pub fn cancel_in_flight(&self, session_id: &str) -> bool {
        let mut inner = self.inner.lock().expect("turn registry");
        let Some(state) = inner.get_mut(session_id) else {
            return false;
        };
        let Some(lease) = state.cancelling.as_ref() else {
            return false;
        };
        if now_ms().saturating_sub(lease.started_at_ms) >= CANCEL_LEASE_MAX_MS {
            state.cancelling = None;
            return false;
        }
        true
    }

    pub fn session_for_operation(&self, operation_id: &str) -> Option<String> {
        self.inner
            .lock()
            .expect("turn registry")
            .iter()
            .find(|(_, state)| {
                state
                    .active
                    .as_ref()
                    .map(|turn| turn.operation_id == operation_id)
                    .unwrap_or(false)
            })
            .map(|(session, _)| session.clone())
    }

    /// Number of sessions with a live turn. Used for diagnostics only.
    pub fn active_count(&self) -> usize {
        self.inner
            .lock()
            .expect("turn registry")
            .values()
            .filter(|state| state.active.is_some())
            .count()
    }
}

/// Typed classification of backend failures used to select a stable mobile
/// error code. Unknown failures stay `Backend` rather than being guessed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendErrorKind {
    NotFound,
    ModelUnavailable,
    AccountMissing,
    Forbidden,
    NotSupported,
    Backend,
}

#[cfg(test)]
mod tests {
    use super::{CancelDenied, CancelTarget, SessionTurnRegistry, is_command_code_provider};

    #[test]
    fn command_code_provider_spellings_are_equivalent() {
        for label in [
            "command-code",
            "Command Code",
            "COMMAND_CODE",
            " command code ",
            "CommandCode",
        ] {
            assert!(is_command_code_provider(label), "{label} should match");
        }
    }

    #[test]
    fn other_providers_do_not_match_command_code() {
        for label in ["Anthropic", "OpenAI", "benchrelay", "code", ""] {
            assert!(!is_command_code_provider(label), "{label} should not match");
        }
    }

    #[test]
    fn concurrent_stop_for_the_same_turn_is_idempotent() {
        let registry = SessionTurnRegistry::default();
        let turn = registry.begin("session", "op");
        registry.record_daemon_status("session", "running", "test");
        assert!(matches!(
            registry.begin_cancel("session", Some(&turn), Some("op"), false),
            Ok(CancelTarget::Known(_))
        ));
        assert!(matches!(
            registry.begin_cancel("session", Some(&turn), Some("op"), false),
            Err(CancelDenied::InFlight(Some(_)))
        ));
        assert!(registry.cancel_in_flight("session"));
        registry.complete_cancel("session", Some(&turn));
        assert!(!registry.cancel_in_flight("session"));
    }

    #[test]
    fn a_stale_turn_id_cannot_authorize_a_session_scoped_cancel() {
        let registry = SessionTurnRegistry::default();
        let previous = registry.begin("session", "op-a");
        registry.finish("session");
        registry.begin("session", "op-b");
        assert!(matches!(
            registry.begin_cancel("session", Some(&previous), None, true),
            Err(CancelDenied::StaleTarget { .. })
        ));
    }

    #[test]
    fn daemon_idle_makes_stop_a_safe_no_op() {
        let registry = SessionTurnRegistry::default();
        registry.record_daemon_status("session", "idle", "test");
        assert!(matches!(
            registry.begin_cancel("session", None, None, true),
            Ok(CancelTarget::AlreadyStopped)
        ));
    }

    #[test]
    fn daemon_cancelled_is_a_terminal_idle_answer() {
        let registry = SessionTurnRegistry::default();
        let status = registry
            .record_daemon_status("session", "cancelled", "test")
            .expect("cancelled is authoritative");
        assert_eq!(status.status, "idle");
        assert!(matches!(
            registry.begin_cancel("session", None, None, true),
            Ok(CancelTarget::AlreadyStopped)
        ));
    }

    #[test]
    fn daemon_running_without_an_adapter_turn_needs_explicit_consent() {
        let registry = SessionTurnRegistry::default();
        registry.record_daemon_status("session", "running", "test");
        assert!(matches!(
            registry.begin_cancel("session", None, None, false),
            Err(CancelDenied::NoTarget)
        ));
        assert!(matches!(
            registry.begin_cancel("session", None, None, true),
            Ok(CancelTarget::DaemonRunning)
        ));
        assert!(registry.cancel_in_flight("session"));
    }

    #[test]
    fn daemon_status_unknown_never_authorizes_a_stop() {
        let registry = SessionTurnRegistry::default();
        assert!(matches!(
            registry.begin_cancel("session", None, None, true),
            Err(CancelDenied::Unknown)
        ));
    }

    #[test]
    fn an_expired_cancel_lease_cannot_block_dispatch_forever() {
        let registry = SessionTurnRegistry::default();
        registry.record_daemon_status("session", "running", "test");
        assert!(matches!(
            registry.begin_cancel("session", None, None, true),
            Ok(CancelTarget::DaemonRunning)
        ));
        {
            let mut inner = registry.inner.lock().expect("turn registry");
            inner
                .get_mut("session")
                .and_then(|state| state.cancelling.as_mut())
                .expect("cancel lease")
                .started_at_ms -= 20_000;
        }
        assert!(!registry.cancel_in_flight("session"));
    }

    #[test]
    fn idle_reconciliation_waits_for_a_just_dispatched_turn() {
        let registry = SessionTurnRegistry::default();
        let turn = registry.begin("session", "op");
        registry.record_daemon_status("session", "idle", "test");
        assert!(registry.reconcile_idle("session").is_none());
        registry.mark_observed("session", "op");
        assert_eq!(
            registry
                .reconcile_idle("session")
                .map(|active| active.turn_id),
            Some(turn)
        );
    }

    #[test]
    fn attached_is_not_an_activity_answer() {
        let registry = SessionTurnRegistry::default();
        assert!(
            registry
                .record_daemon_status("session", "attached", "test")
                .is_none()
        );
        assert!(registry.daemon_status("session").is_none());
    }

    #[test]
    fn an_unrecognized_daemon_status_stays_unknown() {
        let registry = SessionTurnRegistry::default();
        let status = registry
            .record_daemon_status("session", "future_state", "test")
            .expect("a status answer is recorded");
        assert_eq!(status.status, "unknown");
        assert!(matches!(
            registry.begin_cancel("session", None, None, true),
            Err(CancelDenied::Unknown)
        ));
    }
}
