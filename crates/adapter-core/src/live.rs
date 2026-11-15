use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::Duration;

use adapter_protocol::{HistoryMessageView, RuntimeIdentity, SessionEvent, SwarmAgentView};
use jcode_provider_core::{ModelRouteApiMethod, RouteSelection, RuntimeKey};
use jcode_sdk::{ApiEvent, ApiRequest, ConnectOptions, JcodeClient, PermissionDecision};
use serde_json::Value;
use tokio::runtime::Handle;
use tokio::sync::mpsc::Sender;
use tracing::{info, warn};

use crate::backend::{
    Backend, BackendErrorKind, BackendEvent, BackendInfo, BackendRoute, BackendRuntime,
    BackendSession, CoreError, CoreResult, DaemonStatus, effort_options, now_ms,
};
use crate::native_link::{Command, NativeLink, unavailable};

const MAX_SESSION_LINKS: usize = 32;

#[derive(Default)]
struct SessionSlot {
    attached: Mutex<Option<(NativeLink, BackendSession)>>,
    last_used: AtomicU64,
    awaiting_inventory: AtomicBool,
}

/// The harness API provides inventory and pairing metadata. Each open or
/// dispatched session has its own native JCode stream for commands and
/// events, with no cross-session attach lock or historical-session scan.
pub struct JcodeLive {
    socket_path: PathBuf,
    native_socket_path: PathBuf,
    control: Mutex<Option<JcodeClient>>,
    sessions: Mutex<HashMap<String, Arc<SessionSlot>>>,
    inventory: Mutex<HashMap<String, BackendSession>>,
    sequence: AtomicU64,
    event_sink: OnceLock<(Handle, Sender<BackendEvent>)>,
    info: Mutex<BackendInfo>,
    started_at_ms: i64,
}

impl std::fmt::Debug for JcodeLive {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JcodeLive")
            .field("socket_path", &self.socket_path)
            .field("native_socket_path", &self.native_socket_path)
            .finish()
    }
}

impl JcodeLive {
    pub fn new(socket_path: PathBuf) -> Arc<Self> {
        let native_socket_path = std::env::var_os("JCODE_SOCKET")
            .map(PathBuf::from)
            .unwrap_or_else(|| socket_path.with_file_name("jcode.sock"));
        Arc::new(Self {
            socket_path,
            native_socket_path,
            control: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            inventory: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(0),
            event_sink: OnceLock::new(),
            info: Mutex::new(BackendInfo::default()),
            started_at_ms: now_ms(),
        })
    }

    pub fn socket_path(&self) -> &std::path::Path {
        &self.socket_path
    }

    pub fn started_at_ms(&self) -> i64 {
        self.started_at_ms
    }

    pub fn start(self: &Arc<Self>, sink: Sender<BackendEvent>) {
        if self
            .event_sink
            .set((Handle::current(), sink.clone()))
            .is_err()
        {
            return;
        }
        tokio::spawn(watch_inventory(Arc::clone(self), sink.clone()));
        let this = Arc::clone(self);
        let _ = std::thread::Builder::new()
            .name("jcode-inventory-link".into())
            .spawn(move || this.supervise(sink));
    }

    fn supervise(&self, sink: Sender<BackendEvent>) {
        let mut backoff = Duration::from_millis(250);
        while !sink.is_closed() {
            let options = ConnectOptions {
                socket_path: Some(self.socket_path.clone()),
                client_name: concat!("jcode-mobile-adapter-v4/", env!("CARGO_PKG_VERSION")).into(),
                request_timeout: Some(Duration::from_secs(10)),
                ensure_runtime: false,
                supports_user_response: false,
            };
            let message = match JcodeClient::connect(options) {
                Ok(client) => {
                    let events = client.events(None);
                    let info = BackendInfo {
                        server: client.server.clone(),
                        jcode_version: client.server.clone(),
                        protocol_version: jcode_sdk::api::API_VERSION_MAJOR,
                        capabilities: client.capabilities.clone(),
                        healthy: true,
                    };
                    *self.info.lock().expect("jcode info") = info.clone();
                    *self.control.lock().expect("jcode control") = Some(client.clone());
                    backoff = Duration::from_millis(250);
                    info!(server = %info.server, "connected to JCode harness");
                    if sink
                        .blocking_send(BackendEvent::Connected { info })
                        .is_err()
                    {
                        return;
                    }
                    // This connection stays detached. Its reader wakes on a
                    // disconnect, not on an inventory timer.
                    while !sink.is_closed() && !client.is_closed() {
                        events.next_timeout(Duration::from_secs(1));
                    }
                    *self.control.lock().expect("jcode control") = None;
                    "JCode harness stream closed".into()
                }
                Err(error) => format!("JCode harness unavailable: {error}"),
            };
            self.info.lock().expect("jcode info").healthy = false;
            if sink
                .blocking_send(BackendEvent::Disconnected { message })
                .is_err()
            {
                return;
            }
            std::thread::sleep(backoff);
            backoff = (backoff * 2).min(Duration::from_secs(10));
        }
    }

    fn client(&self) -> CoreResult<JcodeClient> {
        self.control
            .lock()
            .expect("jcode control")
            .clone()
            .filter(|client| !client.is_closed())
            .ok_or_else(|| unavailable("JCode harness is not connected"))
    }

    fn start_link(&self, session_id: Option<String>) -> CoreResult<NativeLink> {
        let (runtime, sink) = self
            .event_sink
            .get()
            .ok_or_else(|| unavailable("JCode session listener is not started"))?;
        Ok(NativeLink::start(
            runtime,
            self.native_socket_path.clone(),
            session_id,
            sink.clone(),
        ))
    }

    fn make_room(sessions: &mut HashMap<String, Arc<SessionSlot>>) -> CoreResult<()> {
        if sessions.len() < MAX_SESSION_LINKS {
            return Ok(());
        }
        let evict = sessions
            .iter()
            .filter(|(_, slot)| {
                Arc::strong_count(slot) == 1
                    && slot.attached.try_lock().is_ok_and(|entry| {
                        entry
                            .as_ref()
                            .is_none_or(|(link, _)| link.is_closed() || !link.in_use())
                    })
            })
            .min_by_key(|(_, slot)| slot.last_used.load(Ordering::Relaxed))
            .map(|(id, _)| id.clone())
            .ok_or_else(|| unavailable("All JCode session connections are busy"))?;
        sessions.remove(&evict);
        Ok(())
    }

    fn session(&self, session_id: &str) -> CoreResult<(NativeLink, BackendSession)> {
        let slot = {
            let mut sessions = self.sessions.lock().expect("jcode session pool");
            if let Some(slot) = sessions.get(session_id) {
                Arc::clone(slot)
            } else {
                Self::make_room(&mut sessions)?;
                let slot = Arc::new(SessionSlot::default());
                sessions.insert(session_id.to_owned(), Arc::clone(&slot));
                slot
            }
        };
        slot.last_used.store(
            self.sequence.fetch_add(1, Ordering::Relaxed),
            Ordering::Relaxed,
        );
        let mut entry = slot.attached.lock().expect("jcode session");
        if let Some((link, session)) = entry.as_ref().filter(|(link, _)| !link.is_closed()) {
            return Ok((link.clone(), session.clone()));
        }
        let link = self.start_link(Some(session_id.to_owned()))?;
        let result = link.request(Command::Api(ApiRequest::AttachSession {
            session_id: session_id.to_owned(),
        }))?;
        let ApiEvent::Attached { session } = result else {
            return Err(unexpected("attached"));
        };
        let session = session_info_to_backend(session);
        *entry = Some((link.clone(), session.clone()));
        Ok((link, session))
    }

    fn request(&self, session_id: &str, request: ApiRequest) -> CoreResult<ApiEvent> {
        self.session(session_id)?.0.request(Command::Api(request))
    }

    fn inventory_changed(&self, session_id: &str) {
        let slot = self
            .sessions
            .lock()
            .expect("jcode session pool")
            .get(session_id)
            .cloned();
        if let Some(slot) = slot
            && let Ok(entry) = slot.attached.try_lock()
            && let Some((link, _)) = entry.as_ref()
        {
            link.refresh_runtime();
        }
    }

    fn send_inner(
        &self,
        session_id: &str,
        content: &str,
        images: Vec<(String, String)>,
    ) -> CoreResult<()> {
        self.request(
            session_id,
            ApiRequest::SendMessage {
                session_id: session_id.to_owned(),
                content: content.to_owned(),
                system_reminder: None,
                images,
                no_reply: false,
            },
        )
        .map(drop)
    }
}

async fn watch_inventory(live: Arc<JcodeLive>, events: Sender<BackendEvent>) {
    use notify::{RecursiveMode, Watcher};

    let home = jcode_sdk::user_jcode_home();
    let sessions = home.join("sessions");
    let directory = sessions.clone();
    let (changed, mut changes) = tokio::sync::mpsc::channel(1);
    let result = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result
            && !matches!(event.kind, notify::EventKind::Access(_))
        {
            let mut inventory_dirty = false;
            for path in event.paths {
                if path == directory {
                    inventory_dirty = true;
                } else if path.parent() == Some(&directory)
                    && path
                        .extension()
                        .is_some_and(|extension| extension == "json")
                {
                    inventory_dirty = true;
                    if let Some(session_id) = path.file_stem().and_then(|name| name.to_str()) {
                        live.inventory_changed(session_id);
                    }
                }
            }
            if inventory_dirty {
                let _ = changed.try_send(());
            }
        }
    });
    let mut watcher = match result {
        Ok(watcher) => watcher,
        Err(error) => {
            warn!(%error, "JCode session inventory watch unavailable");
            return;
        }
    };
    if let Err(error) = watcher.watch(&home, RecursiveMode::NonRecursive) {
        warn!(%error, "JCode session directory watch unavailable");
        return;
    }
    if sessions.is_dir() {
        let _ = watcher.watch(&sessions, RecursiveMode::NonRecursive);
    }
    loop {
        tokio::select! {
            _ = events.closed() => break,
            Some(()) = changes.recv() => {
                if sessions.is_dir() {
                    let _ = watcher.watch(&sessions, RecursiveMode::NonRecursive);
                }
                if events.send(BackendEvent::SessionsChanged).await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

fn unexpected(reply: &str) -> CoreError {
    CoreError::BackendRejected(format!("JCode returned an unexpected reply for {reply}"))
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
        swarm_status: info.swarm_status,
    }
}

fn history_views(messages: Vec<jcode_sdk::HistoryMessage>, tail: u32) -> Vec<HistoryMessageView> {
    let start = messages.len().saturating_sub(tail as usize);
    messages
        .into_iter()
        .skip(start)
        .enumerate()
        .map(|(index, message)| {
            let (tool_call_id, tool_name, tool_input) = match message.tool {
                Some(tool) => (Some(tool.id), Some(tool.name), Some(tool.input)),
                None => (None, None, None),
            };
            HistoryMessageView {
                index,
                role: message.role,
                content: message.content,
                tool_call_id,
                tool_name,
                tool_input,
                response_stats: message
                    .response_stats
                    .and_then(|stats| serde_json::to_value(stats).ok()),
            }
        })
        .collect()
}

impl Backend for JcodeLive {
    fn info(&self) -> BackendInfo {
        self.info.lock().expect("jcode info").clone()
    }

    fn list_sessions(&self) -> CoreResult<Vec<BackendSession>> {
        let mut sessions: Vec<_> = self
            .client()?
            .list_sessions()
            .map(|sessions| sessions.into_iter().map(session_info_to_backend).collect())
            .map_err(map_sdk_error)?;
        {
            let persisted: std::collections::HashSet<_> = sessions
                .iter()
                .map(|session| session.session_id.as_str())
                .collect();
            let links = self.sessions.lock().expect("jcode session pool");
            let mut just_created = Vec::new();
            for (id, slot) in links
                .iter()
                .filter(|(_, slot)| slot.awaiting_inventory.load(Ordering::Relaxed))
            {
                if persisted.contains(id.as_str()) {
                    slot.awaiting_inventory.store(false, Ordering::Relaxed);
                } else if let Ok(entry) = slot.attached.try_lock()
                    && let Some((link, session)) = entry.as_ref()
                    && !link.is_closed()
                {
                    // The detached inventory bridge cannot list a fresh
                    // draft until JCode persists its first message.
                    just_created.push(session.clone());
                }
            }
            sessions.extend(just_created);
        }
        *self.inventory.lock().expect("jcode session inventory") = sessions
            .iter()
            .map(|session| (session.session_id.clone(), session.clone()))
            .collect();
        Ok(sessions)
    }

    fn create_session(&self, working_dir: Option<&str>) -> CoreResult<BackendSession> {
        let link = self.start_link(None)?;
        let result = link.request(Command::Api(ApiRequest::CreateSession {
            working_dir: working_dir.map(str::to_owned),
            system_prompt: None,
        }))?;
        let ApiEvent::Attached { session } = result else {
            return Err(unexpected("created session"));
        };
        let session = session_info_to_backend(session);
        let mut sessions = self.sessions.lock().expect("jcode session pool");
        if Self::make_room(&mut sessions).is_ok() {
            let slot = SessionSlot {
                attached: Mutex::new(Some((link, session.clone()))),
                last_used: AtomicU64::new(self.sequence.fetch_add(1, Ordering::Relaxed)),
                awaiting_inventory: AtomicBool::new(true),
            };
            sessions.insert(session.session_id.clone(), Arc::new(slot));
        }
        Ok(session)
    }

    fn attach_session(&self, session_id: &str) -> CoreResult<BackendSession> {
        let (_, mut session) = self.session(session_id)?;
        if let Some(cached) = self
            .inventory
            .lock()
            .expect("jcode session inventory")
            .get(session_id)
        {
            // The native Attached reply lacks persisted swarm metadata.
            session
                .parent_session_id
                .clone_from(&cached.parent_session_id);
            session.agent_label.clone_from(&cached.agent_label);
            session.swarm_status.clone_from(&cached.swarm_status);
            session.title.clone_from(&cached.title);
            session.updated_at_ms = cached.updated_at_ms;
            session.transcript_bytes = cached.transcript_bytes;
            session.saved = cached.saved;
            session.archived = cached.archived;
        }
        Ok(session)
    }

    fn history(&self, session_id: &str, tail: Option<u32>) -> CoreResult<Vec<HistoryMessageView>> {
        match self.request(
            session_id,
            ApiRequest::GetHistory {
                session_id: session_id.to_owned(),
            },
        )? {
            ApiEvent::History { messages, .. } => Ok(history_views(messages, tail.unwrap_or(200))),
            _ => Err(unexpected("history")),
        }
    }

    fn runtime(&self, session_id: &str) -> CoreResult<BackendRuntime> {
        let event = self.request(
            session_id,
            ApiRequest::GetRuntimeInfo {
                session_id: session_id.to_owned(),
            },
        )?;
        let ApiEvent::RuntimeInfo {
            provider,
            model,
            reasoning_effort,
            auth_method,
            account_label,
            routes,
            ..
        } = event
        else {
            return Err(unexpected("runtime"));
        };
        let mut providers = provider.iter().cloned().collect::<Vec<_>>();
        let routes = routes
            .into_iter()
            .map(|route| {
                if !providers.contains(&route.provider) {
                    providers.push(route.provider.clone());
                }
                BackendRoute {
                    model: route.model,
                    provider: route.provider,
                    api_method: route.api_method,
                    available: route.available,
                    detail: route.detail,
                }
            })
            .collect();
        Ok(BackendRuntime {
            provider,
            model,
            reasoning_effort,
            auth_method,
            account_label,
            providers,
            routes,
        })
    }

    fn list_models(&self, session_id: &str) -> CoreResult<(Vec<String>, Option<String>)> {
        match self.request(
            session_id,
            ApiRequest::ListModels {
                session_id: session_id.to_owned(),
            },
        )? {
            ApiEvent::Models {
                models, current, ..
            } => Ok((models, current)),
            _ => Err(unexpected("model catalog")),
        }
    }

    fn set_model(&self, session_id: &str, model: &str) -> CoreResult<()> {
        self.request(
            session_id,
            ApiRequest::SetModel {
                session_id: session_id.to_owned(),
                model: model.to_owned(),
            },
        )
        .map(drop)
    }

    fn set_route(&self, session_id: &str, route: &BackendRoute) -> CoreResult<()> {
        let selection = RouteSelection {
            model: route.model.clone(),
            runtime_key: RuntimeKey::from_api_method(
                &ModelRouteApiMethod::parse(&route.api_method),
                &route.provider,
            ),
            api_method: route.api_method.clone(),
            provider_label: route.provider.clone(),
            detail: route.detail.clone(),
        };
        self.session(session_id)?
            .0
            .request(Command::SetRoute(selection))
            .map(drop)
    }

    fn swarm_agents(&self, session_id: &str) -> Option<Vec<SwarmAgentView>> {
        let slot = self
            .sessions
            .lock()
            .expect("jcode session pool")
            .get(session_id)?
            .clone();
        let entry = slot.attached.lock().expect("jcode session");
        entry.as_ref().and_then(|(link, _)| link.agents())
    }

    fn set_reasoning_effort(&self, session_id: &str, effort: &str) -> CoreResult<()> {
        self.request(
            session_id,
            ApiRequest::SetReasoningEffort {
                session_id: session_id.to_owned(),
                effort: effort.to_owned(),
            },
        )
        .map(drop)
    }

    fn set_context_cap(&self, session_id: &str, max_tokens: Option<u64>) -> CoreResult<()> {
        self.request(
            session_id,
            ApiRequest::SetContextCap {
                session_id: session_id.to_owned(),
                max_context_tokens: max_tokens.map(|value| value as usize),
            },
        )
        .map(drop)
    }

    fn rename_session(&self, session_id: &str, title: Option<&str>) -> CoreResult<()> {
        self.request(
            session_id,
            ApiRequest::RenameSession {
                session_id: session_id.to_owned(),
                title: title.map(str::to_owned),
            },
        )
        .map(drop)
    }

    fn archive_session(&self, session_id: &str) -> CoreResult<()> {
        self.client()?
            .archive_session(session_id)
            .map_err(map_sdk_error)?;
        if let Some(slot) = self
            .sessions
            .lock()
            .expect("jcode session pool")
            .get(session_id)
        {
            slot.awaiting_inventory.store(false, Ordering::Relaxed);
        }
        Ok(())
    }

    fn restore_session(&self, session_id: &str) -> CoreResult<()> {
        self.client()?
            .restore_session(session_id)
            .map_err(map_sdk_error)
    }

    fn plan(&self, session_id: &str) -> CoreResult<Option<Value>> {
        match self.request(
            session_id,
            ApiRequest::GetTodoState {
                session_id: session_id.to_owned(),
            },
        )? {
            ApiEvent::TodoState { state, .. } => serde_json::to_value(state)
                .map(Some)
                .map_err(|error| CoreError::Message(error.to_string())),
            _ => Err(unexpected("todo state")),
        }
    }

    fn send(&self, session_id: &str, content: &str) -> CoreResult<()> {
        self.send_inner(session_id, content, Vec::new())
    }

    fn send_images(
        &self,
        session_id: &str,
        content: &str,
        images: Vec<(String, String)>,
    ) -> CoreResult<()> {
        self.send_inner(session_id, content, images)
    }

    fn cancel(&self, session_id: &str) -> CoreResult<()> {
        self.request(
            session_id,
            ApiRequest::Cancel {
                session_id: session_id.to_owned(),
            },
        )
        .map(drop)
    }

    fn daemon_status(&self, session_id: &str) -> CoreResult<DaemonStatus> {
        let since = now_ms();
        let (link, _) = self.session(session_id)?;
        // A long-lived attachment receives every daemon status change, so its
        // last value is current. After an adapter restart the attachment is
        // new and the daemon answers `attach_session` with a correlated
        // `is_processing` status; wait briefly for that frame instead of
        // reporting a false idle.
        let normalize = |status: crate::native_link::LinkStatus| {
            DaemonStatus::from_raw(&status.raw_status, "daemon.attach")
        };
        let observed = link.status().and_then(normalize).or_else(|| {
            link.wait_status_since(since, Duration::from_millis(1_500))
                .and_then(normalize)
        });
        Ok(observed.unwrap_or_else(|| DaemonStatus::unknown("daemon.attach")))
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
        self.request(
            session_id,
            ApiRequest::PermissionResponse {
                session_id: session_id.to_owned(),
                request_id: request_id.to_owned(),
                decision,
            },
        )
        .map(drop)
    }

    fn ping(&self) -> CoreResult<()> {
        self.client()?.ping().map_err(map_sdk_error)
    }

    fn healthy(&self) -> bool {
        self.client().is_ok()
    }
}

pub(crate) fn map_event(event: ApiEvent, attached: Option<&str>) -> Option<BackendEvent> {
    let mapped = match event {
        ApiEvent::MessageAccepted { session_id } => BackendEvent::Accepted { session_id },
        ApiEvent::Error { code, message } => BackendEvent::RequestError {
            session_id: attached?.to_owned(),
            code: format!("{code:?}").to_ascii_lowercase(),
            message,
        },
        ApiEvent::ModelInfo {
            session_id,
            provider,
            model,
            reasoning_effort,
            auth_method,
            account_label,
        } => BackendEvent::Runtime {
            session_id,
            runtime: RuntimeIdentity {
                effort_options: effort_options(provider.as_deref(), model.as_deref()),
                provider,
                model,
                reasoning_effort,
                auth_method,
                account_label,
            },
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
    let session_id = match &mapped {
        BackendEvent::Accepted { session_id }
        | BackendEvent::RequestError { session_id, .. }
        | BackendEvent::Runtime { session_id, .. }
        | BackendEvent::Session { session_id, .. } => session_id,
        _ => return None,
    };
    (attached == Some(session_id.as_str())).then_some(mapped)
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

#[cfg(test)]
mod tool_lifecycle_tests {
    use super::*;

    #[test]
    fn native_tool_done_preserves_background_handoff_and_session_fence() {
        let output = "Tool 'bash' was moved to background automatically after 3 seconds (task_id: 123456abcd).\n\nWhile this task runs, try to make progress on other useful work that does not depend on its result. If nothing independent remains, wait for completion rather than repeatedly polling. Do not duplicate the running task or change inputs it is still using.";
        let event = ApiEvent::ToolDone {
            session_id: "s1".into(),
            call_id: "call1".into(),
            name: "bash".into(),
            output: output.into(),
            error: None,
        };
        assert!(map_event(event.clone(), Some("s2")).is_none());
        match map_event(event, Some("s1")) {
            Some(BackendEvent::Session {
                session_id,
                event:
                    SessionEvent::ToolDone {
                        call_id,
                        name,
                        output: actual,
                        error,
                    },
            }) => {
                assert_eq!(session_id, "s1");
                assert_eq!(call_id, "call1");
                assert_eq!(name, "bash");
                assert_eq!(actual, output);
                assert_eq!(error, None);
            }
            other => panic!("unexpected mapped event: {other:?}"),
        }
    }
}
