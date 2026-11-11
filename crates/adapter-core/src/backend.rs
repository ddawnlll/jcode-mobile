use std::sync::Mutex;

use adapter_protocol::{
    HistoryMessageView, ModelRouteView, RuntimeView, SessionEvent, SessionSummary,
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
        code: String,
        message: String,
    },
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
    fn set_reasoning_effort(&self, session_id: &str, effort: &str) -> CoreResult<()>;
    fn set_context_cap(&self, session_id: &str, max_tokens: Option<u64>) -> CoreResult<()>;
    fn rename_session(&self, session_id: &str, title: Option<&str>) -> CoreResult<()>;
    fn plan(&self, session_id: &str) -> CoreResult<Option<Value>>;
    /// Write a user message. Returning Ok means the frame was written, not that
    /// the agent accepted it. Acceptance arrives as `BackendEvent::Accepted`.
    fn send(&self, session_id: &str, content: &str) -> CoreResult<()>;
    fn cancel(&self, session_id: &str) -> CoreResult<()>;
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
            .and_then(|state| state.active.take())
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
    use super::is_command_code_provider;

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
}
