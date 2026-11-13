use std::sync::{Arc, Mutex};
use std::time::Duration;

use adapter_protocol::{HistoryMessageView, SessionEvent};
use jcode_sdk::{
    ApiEvent, ApiRequest, ConnectOptions, CreateSessionOptions, GlobalEventsOptions, JcodeClient,
    PermissionDecision, RuntimeInfo,
};
use serde_json::Value;
use tokio::sync::mpsc::Sender;
use tracing::{info, warn};

use crate::backend::{
    Backend, BackendErrorKind, BackendEvent, BackendInfo, BackendRoute, BackendRuntime,
    BackendSession, CoreError, CoreResult, now_ms,
};

/// Live link to the pinned JCode harness.
///
/// The SDK client is synchronous. The adapter only invokes these methods from
/// `spawn_blocking` workers; the event supervisor owns its own dedicated OS
/// thread so a blocked daemon read never parks a Tokio reactor thread.
pub struct JcodeLive {
    socket_path: std::path::PathBuf,
    shared: Mutex<Option<JcodeClient>>,
    /// The bridge attaches one session to a native connection. A connection
    /// has at most one current session, so this tracks the single session the
    /// shared client is attached to rather than a set of "known" sessions.
    /// Any command must attach (replacing the current session) before issuing
    /// it against a different session.
    current_session: Mutex<Option<String>>,
    /// Serialises attach + command against each other so a command issued for
    /// session B cannot interleave between another thread's attach and op for
    /// session A on the shared connection.
    command_lock: Mutex<()>,
    info: Mutex<BackendInfo>,
    started_at_ms: i64,
}

impl std::fmt::Debug for JcodeLive {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JcodeLive")
            .field("socket_path", &self.socket_path)
            .finish()
    }
}

impl JcodeLive {
    pub fn new(socket_path: std::path::PathBuf) -> Arc<Self> {
        Arc::new(Self {
            socket_path,
            shared: Mutex::new(None),
            current_session: Mutex::new(None),
            command_lock: Mutex::new(()),
            info: Mutex::new(BackendInfo {
                server: String::new(),
                jcode_version: String::new(),
                protocol_version: 0,
                capabilities: Vec::new(),
                healthy: false,
            }),
            started_at_ms: now_ms(),
        })
    }

    pub fn socket_path(&self) -> &std::path::Path {
        &self.socket_path
    }

    pub fn started_at_ms(&self) -> i64 {
        self.started_at_ms
    }

    /// Start the one event/reconnect supervisor. It is safe to call once during
    /// adapter startup. The sink is bounded, so a slow consumer applies
    /// backpressure to this thread instead of growing an unbounded queue.
    pub fn start(self: &Arc<Self>, sink: Sender<BackendEvent>) {
        let this = Arc::clone(self);
        let _ = std::thread::Builder::new()
            .name("jcode-link-events".into())
            .spawn(move || this.supervise(sink));
    }

    fn supervise(&self, sink: Sender<BackendEvent>) {
        let mut backoff = Duration::from_secs(1);
        loop {
            let options = ConnectOptions {
                socket_path: Some(self.socket_path.clone()),
                client_name: "jcode-mobile-adapter-v2/0.3.1".into(),
                request_timeout: Some(Duration::from_secs(30)),
                ensure_runtime: false,
                supports_user_response: false,
            };
            match JcodeClient::connect(options) {
                Ok(client) => {
                    let info = BackendInfo {
                        server: client.server.clone(),
                        jcode_version: client.server.clone(),
                        protocol_version: jcode_sdk::api::API_VERSION_MAJOR,
                        capabilities: client.capabilities.clone(),
                        healthy: true,
                    };
                    *self.info.lock().expect("jcode info") = info.clone();
                    *self.current_session.lock().expect("jcode current session") = None;
                    *self.shared.lock().expect("jcode client") = Some(client.clone());
                    backoff = Duration::from_secs(1);
                    info!(
                        server = %info.server,
                        capabilities = info.capabilities.len(),
                        "connected to JCode harness"
                    );
                    if sink
                        .blocking_send(BackendEvent::Connected { info })
                        .is_err()
                    {
                        return;
                    }
                    let events_options = GlobalEventsOptions {
                        discovery_interval: Duration::from_secs(2),
                        max_buffered_events: 2048,
                    };
                    // The bridge attaches one session per native connection. A
                    // single `events(None)` stream would stop covering session A
                    // as soon as a command attaches session B, so use the SDK's
                    // bounded global fan-in with one child connection per
                    // session. Returning to a running background session then
                    // receives events without pretending this connection saw
                    // them earlier.
                    match client.global_events(events_options) {
                        Ok(events) => loop {
                            match events.next() {
                                Ok(Some(event)) => {
                                    if let Some(event) = map_event(event) {
                                        if sink.blocking_send(event).is_err() {
                                            return;
                                        }
                                    }
                                }
                                Ok(None) => break,
                                Err(error) => {
                                    warn!(%error, "JCode global event stream failed");
                                    break;
                                }
                            }
                        },
                        Err(error) => {
                            warn!(%error, "JCode global event stream unavailable");
                            let events = client.events(None);
                            while let Some(event) = events.next() {
                                if let Some(event) = map_event(event) {
                                    if sink.blocking_send(event).is_err() {
                                        return;
                                    }
                                }
                            }
                        }
                    }
                    *self.shared.lock().expect("jcode client") = None;
                    self.info.lock().expect("jcode info").healthy = false;
                    warn!("JCode harness event stream ended; reconnecting");
                    let _ = sink.blocking_send(BackendEvent::Disconnected {
                        message: "JCode harness stream closed".into(),
                    });
                }
                Err(error) => {
                    self.info.lock().expect("jcode info").healthy = false;
                    let _ = sink.blocking_send(BackendEvent::Disconnected {
                        message: format!("JCode harness unavailable: {error}"),
                    });
                }
            }
            std::thread::sleep(backoff);
            backoff = (backoff * 2).min(Duration::from_secs(15));
        }
    }

    fn client(&self) -> CoreResult<JcodeClient> {
        self.shared
            .lock()
            .expect("jcode client")
            .clone()
            .ok_or_else(|| CoreError::BackendUnavailable("JCode harness is not connected".into()))
    }

    fn attach_for_command<'a>(
        &'a self,
        client: &'a JcodeClient,
        session_id: &'a str,
    ) -> CoreResult<std::sync::MutexGuard<'a, ()>> {
        let guard = self.command_lock.lock().expect("jcode command lock");
        let mut current = self.current_session.lock().expect("jcode current session");
        if current.as_deref() == Some(session_id) {
            return Ok(guard);
        }
        client
            .attach_session(session_id)
            .map(|_| {
                *current = Some(session_id.to_string());
            })
            .map_err(map_sdk_error)?;
        Ok(guard)
    }
}

fn map_sdk_error(error: jcode_sdk::Error) -> CoreError {
    CoreError::BackendRejected(error.to_string())
}

fn session_info_to_backend(info: jcode_sdk::SessionInfo) -> BackendSession {
    BackendSession {
        session_id: info.session_id,
        title: info.title,
        status: info.status,
        working_dir: info.working_dir,
        updated_at_ms: info.updated_at_ms,
        transcript_bytes: info.transcript_bytes,
        saved: info.saved,
        archived: info.archived,
        parent_session_id: info.parent_session_id,
        agent_label: info.agent_label,
    }
}

fn runtime_to_backend(runtime: RuntimeInfo) -> BackendRuntime {
    BackendRuntime {
        provider: runtime.provider,
        model: runtime.model,
        reasoning_effort: runtime.reasoning_effort,
        auth_method: runtime.auth_method,
        account_label: runtime.account_label,
        providers: runtime.providers,
        routes: runtime
            .routes
            .into_iter()
            .map(|route| BackendRoute {
                model: route.model,
                provider: route.provider,
                api_method: route.api_method,
                available: route.available,
                detail: route.detail,
            })
            .collect(),
    }
}

fn history_views(messages: Vec<jcode_sdk::api::HistoryMessage>) -> Vec<HistoryMessageView> {
    messages
        .into_iter()
        .enumerate()
        .map(|(index, message)| HistoryMessageView {
            index,
            role: message.role,
            content: message.content,
            tool_call_id: message.tool.as_ref().map(|tool| tool.id.clone()),
            tool_name: message.tool.as_ref().map(|tool| tool.name.clone()),
            tool_input: message.tool.as_ref().map(|tool| tool.input.clone()),
            response_stats: message
                .response_stats
                .and_then(|stats| serde_json::to_value(stats).ok()),
        })
        .collect()
}

impl Backend for JcodeLive {
    fn info(&self) -> BackendInfo {
        self.info.lock().expect("jcode info").clone()
    }

    fn list_sessions(&self) -> CoreResult<Vec<BackendSession>> {
        let client = self.client()?;
        client
            .list_sessions()
            .map(|sessions| sessions.into_iter().map(session_info_to_backend).collect())
            .map_err(map_sdk_error)
    }

    fn create_session(&self, working_dir: Option<&str>) -> CoreResult<BackendSession> {
        // The pinned bridge implements `create_session` as a bare `subscribe`
        // on the calling connection. On an already-attached connection the
        // daemon answers with the *current* session's state instead of
        // creating a new one, so creating through the shared link returns (and
        // renames) the existing session. Create on a short-lived connection
        // whose first frame is the create/attach, which is unambiguous.
        let fresh = JcodeClient::connect(ConnectOptions {
            socket_path: Some(self.socket_path.clone()),
            client_name: "jcode-mobile-adapter-v2/create".into(),
            request_timeout: Some(Duration::from_secs(30)),
            ensure_runtime: false,
            supports_user_response: false,
        })
        .map_err(map_sdk_error)?;
        let session = fresh
            .create_session_with_options(CreateSessionOptions {
                working_dir: working_dir.map(str::to_owned),
                system_prompt: None,
            })
            .map(session_info_to_backend)
            .map_err(map_sdk_error)?;
        // The short-lived connection is no longer needed; attach the shared
        // link to the new session so follow-up commands land on it, matching
        // the old behaviour of attaching the created session.
        let shared = self.client()?;
        let session_id = session.session_id.clone();
        let _guard = self.attach_for_command(&shared, &session_id)?;
        Ok(session)
    }

    fn attach_session(&self, session_id: &str) -> CoreResult<BackendSession> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client
            .list_sessions()
            .map_err(map_sdk_error)?
            .into_iter()
            .find(|session| session.session_id == session_id)
            .map(session_info_to_backend)
            .ok_or_else(|| CoreError::NotFound(session_id.to_string()))
    }

    fn history(&self, session_id: &str, tail: Option<u32>) -> CoreResult<Vec<HistoryMessageView>> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client
            .get_history(session_id)
            .map(|messages| {
                // `get_history` returns the full transcript; the tail limit is
                // applied here rather than on the wire.
                let limit = tail.unwrap_or(200) as usize;
                let start = messages.len().saturating_sub(limit);
                history_views(messages[start..].to_vec())
            })
            .map_err(map_sdk_error)
    }

    fn runtime(&self, session_id: &str) -> CoreResult<BackendRuntime> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client
            .get_runtime_info(session_id)
            .map(runtime_to_backend)
            .map_err(map_sdk_error)
    }

    fn list_models(&self, session_id: &str) -> CoreResult<(Vec<String>, Option<String>)> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client.list_models(session_id).map_err(map_sdk_error)
    }

    fn set_model(&self, session_id: &str, model: &str) -> CoreResult<()> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client.set_model(session_id, model).map_err(map_sdk_error)
    }

    fn set_reasoning_effort(&self, session_id: &str, effort: &str) -> CoreResult<()> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client
            .set_reasoning_effort(session_id, effort)
            .map_err(map_sdk_error)
    }

    fn set_context_cap(&self, session_id: &str, max_tokens: Option<u64>) -> CoreResult<()> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client
            .set_context_cap(session_id, max_tokens.map(|value| value as usize))
            .map(|_| ())
            .map_err(map_sdk_error)
    }

    fn rename_session(&self, session_id: &str, title: Option<&str>) -> CoreResult<()> {
        let client = self.client()?;
        client
            .rename_session(session_id, title.map(str::to_owned))
            .map_err(map_sdk_error)
    }

    fn plan(&self, session_id: &str) -> CoreResult<Option<Value>> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        let snapshot = client.todo_state(session_id).map_err(map_sdk_error)?;
        serde_json::to_value(snapshot)
            .map(Some)
            .map_err(|error| CoreError::Message(error.to_string()))
    }

    fn send(&self, session_id: &str, content: &str) -> CoreResult<()> {
        let client = self.client()?;
        // The harness requires the connection to be attached before SendMessage.
        // Attach is a no-op when this session is already current.
        let _guard = self.attach_for_command(&client, session_id)?;
        client
            .notify(ApiRequest::SendMessage {
                session_id: session_id.to_string(),
                content: content.to_string(),
                system_reminder: None,
                images: Vec::new(),
                no_reply: false,
            })
            .map_err(map_sdk_error)
    }

    fn cancel(&self, session_id: &str) -> CoreResult<()> {
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client.cancel(session_id).map_err(map_sdk_error)
    }

    fn permission_response(
        &self,
        session_id: &str,
        request_id: &str,
        decision: &str,
    ) -> CoreResult<()> {
        let decision = match decision {
            "allow" => PermissionDecision::Allow,
            "allow_always" => PermissionDecision::AllowAlways,
            "deny" => PermissionDecision::Deny,
            other => {
                return Err(CoreError::InvalidInput(format!(
                    "unknown permission decision: {other}"
                )));
            }
        };
        let client = self.client()?;
        let _guard = self.attach_for_command(&client, session_id)?;
        client
            .respond_to_permission(session_id, request_id, decision)
            .map_err(map_sdk_error)
    }

    fn ping(&self) -> CoreResult<()> {
        self.client()?.ping().map_err(map_sdk_error)
    }

    fn healthy(&self) -> bool {
        self.shared.lock().expect("jcode client").is_some()
    }
}

fn map_event(event: ApiEvent) -> Option<BackendEvent> {
    let mapped = match event {
        ApiEvent::MessageAccepted { session_id } => BackendEvent::Accepted { session_id },
        ApiEvent::Error { code, message } => BackendEvent::RequestError {
            code: format!("{code:?}").to_ascii_lowercase(),
            message,
        },
        ApiEvent::TextDelta {
            session_id,
            text,
            message_id,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::TextDelta { text, message_id },
        },
        ApiEvent::TextDone {
            session_id,
            message_id,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::TextDone { message_id },
        },
        ApiEvent::TextReplace {
            session_id,
            text,
            message_id,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::TextReplace { text, message_id },
        },
        ApiEvent::ReasoningDelta { session_id, text } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ReasoningDelta { text },
        },
        ApiEvent::ReasoningDone {
            session_id,
            duration_secs,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ReasoningDone { duration_secs },
        },
        ApiEvent::ToolStart {
            session_id,
            call_id,
            name,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ToolStart { call_id, name },
        },
        ApiEvent::ToolInputDelta {
            session_id,
            call_id,
            delta,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ToolInputDelta { call_id, delta },
        },
        ApiEvent::ToolExec {
            session_id,
            call_id,
            name,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ToolExec { call_id, name },
        },
        ApiEvent::ToolDone {
            session_id,
            call_id,
            name,
            output,
            error,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ToolDone {
                call_id,
                name,
                output,
                error,
            },
        },
        ApiEvent::PermissionRequest {
            session_id,
            request_id,
            tool_name,
            description,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::PermissionRequest {
                request_id,
                tool_name,
                description,
            },
        },
        ApiEvent::TokenUsage {
            session_id,
            input,
            output,
            cache_read_input,
            cache_creation_input,
            effective_budget,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::TokenUsage {
                input,
                output,
                cache_read_input,
                cache_creation_input,
                effective_budget: effective_budget.map(|value| value as u64),
            },
        },
        ApiEvent::SessionStatus {
            session_id,
            status,
            pending_soft_interrupts,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::SessionStatus {
                status,
                pending_soft_interrupts,
            },
        },
        ApiEvent::ConnectionPhase { session_id, phase } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ConnectionPhase { phase },
        },
        ApiEvent::SessionRecovery {
            session_id,
            continuation_message,
            reconnect_notice,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::SessionRecovery {
                continuation_message,
                reconnect_notice,
            },
        },
        ApiEvent::SessionRenamed {
            session_id,
            title,
            display_title,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::TitleChanged {
                title,
                display_title,
            },
        },
        ApiEvent::TodoState { session_id, state } => BackendEvent::Session {
            session_id,
            event: SessionEvent::PlanUpdated {
                plan: serde_json::to_value(state).unwrap_or(Value::Null),
            },
        },
        ApiEvent::ContextCapChanged {
            session_id,
            max_context_tokens,
            effective_budget,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::ContextCapChanged {
                max_context_tokens: max_context_tokens.map(|value| value as u64),
                effective_budget: effective_budget as u64,
            },
        },
        ApiEvent::TurnStopped {
            session_id,
            reason,
            message,
            provider_stop_reason,
        } => BackendEvent::Session {
            session_id,
            event: SessionEvent::TurnStopped {
                turn_id: None,
                reason: serde_json::to_value(reason)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "unknown".into()),
                message,
                provider_stop_reason,
            },
        },
        ApiEvent::TurnDone { session_id, .. } => BackendEvent::Session {
            session_id,
            event: SessionEvent::TurnDone { turn_id: None },
        },
        _ => return None,
    };
    Some(mapped)
}

/// Map an SDK/harness error string into the adapter's typed error classes.
/// The upstream error enum is not part of the curated API, so classification
/// is deliberately conservative: unknown failures stay internal.
pub fn classify_backend_error(message: &str) -> BackendErrorKind {
    let lower = message.to_ascii_lowercase();
    if lower.contains("unknown session") || lower.contains("not found") {
        BackendErrorKind::NotFound
    } else if lower.contains("model") && (lower.contains("plan") || lower.contains("not available"))
    {
        BackendErrorKind::ModelUnavailable
    } else if lower.contains("account") || lower.contains("credential") {
        BackendErrorKind::AccountMissing
    } else if lower.contains("unauthorized") || lower.contains("forbidden") {
        BackendErrorKind::Forbidden
    } else if lower.contains("not supported") || lower.contains("unknown request") {
        BackendErrorKind::NotSupported
    } else {
        BackendErrorKind::Backend
    }
}
