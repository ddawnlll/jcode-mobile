use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};

use adapter_core::{
    AdapterConfig, AuthService, Backend, BackendInfo, BackendSession, CoreError, CoreResult,
    RootScope, SessionTurnRegistry, Store, now_ms,
};
use adapter_protocol::{
    ActivityItem, ContextView, ServerInfo, ServerStatusPayload, SessionSummary,
};
use tokio::sync::{broadcast, mpsc};

use crate::hub::Hub;

pub const ADAPTER_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct AppState {
    pub config: Arc<AdapterConfig>,
    pub store: Arc<Store>,
    pub auth: AuthService,
    pub backend: Arc<dyn Backend>,
    pub hub: Arc<Hub>,
    pub turns: Arc<SessionTurnRegistry>,
    pub roots: Arc<RootScope>,
    pub started_at_ms: i64,
    pub create_lock: tokio::sync::Mutex<()>,
    pub usage: Mutex<HashMap<String, ContextView>>,
    pub activity: Mutex<HashMap<String, VecDeque<ActivityItem>>>,
    pub command_code_available: RwLock<Option<bool>>,
    pub revocation: broadcast::Sender<String>,
    pub pair_attempts: Mutex<HashMap<String, (u32, i64)>>,
    pub last_connection_message: RwLock<Option<String>>,
}

impl AppState {
    pub fn new(
        config: AdapterConfig,
        store: Arc<Store>,
        backend: Arc<dyn Backend>,
        epoch: String,
    ) -> CoreResult<Arc<Self>> {
        let roots = RootScope::new(config.allowed_roots.clone())?;
        store.recover_inflight_operations()?;
        for root in roots.roots() {
            let label = root
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .unwrap_or("Workspace")
                .to_string();
            store.upsert_project(&label, &root.to_string_lossy(), false)?;
        }
        let (revocation, _) = broadcast::channel(32);
        let event_queue = config.event_queue;
        Ok(Arc::new(Self {
            config: Arc::new(config),
            auth: AuthService::new(Arc::clone(&store)),
            store,
            backend,
            hub: Arc::new(Hub::new(epoch, event_queue, 512)),
            turns: Arc::new(SessionTurnRegistry::default()),
            roots: Arc::new(roots),
            started_at_ms: now_ms(),
            create_lock: tokio::sync::Mutex::new(()),
            usage: Mutex::new(HashMap::new()),
            activity: Mutex::new(HashMap::new()),
            command_code_available: RwLock::new(None),
            revocation,
            pair_attempts: Mutex::new(HashMap::new()),
            last_connection_message: RwLock::new(None),
        }))
    }

    pub fn server_info(&self) -> ServerInfo {
        let info = self.backend.info();
        ServerInfo {
            server_id: self.store.server_id().to_string(),
            name: self.config.server_name.clone(),
            adapter_version: ADAPTER_VERSION.to_string(),
            protocol_version: adapter_protocol::PROTOCOL_VERSION,
            min_protocol_version: adapter_protocol::MIN_PROTOCOL_VERSION,
            jcode_version: if info.jcode_version.is_empty() {
                "unavailable".into()
            } else {
                info.jcode_version
            },
            jcode_protocol_version: info.protocol_version,
            jcode_capabilities: info.capabilities,
            healthy: info.healthy,
            capabilities: adapter_protocol::CAPABILITIES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            started_at_ms: self.started_at_ms,
            command_code_available: *self.command_code_available.read().expect("cc lock"),
        }
    }

    pub fn server_status(&self) -> ServerStatusPayload {
        let info = self.backend.info();
        ServerStatusPayload {
            jcode_connected: info.healthy,
            message: self
                .last_connection_message
                .read()
                .expect("connection message")
                .clone(),
            observed_at_ms: now_ms(),
        }
    }

    pub fn backend_info(&self) -> BackendInfo {
        self.backend.info()
    }

    pub fn summary(&self, session: BackendSession) -> CoreResult<SessionSummary> {
        let title = self.store.session_title(&session.session_id)?;
        let mut project_id = self.store.session_project(&session.session_id)?;
        if project_id.is_none() {
            project_id = self.infer_project(session.working_dir.as_deref())?;
        }
        Ok(session.into_summary(title, project_id))
    }

    fn infer_project(&self, working_dir: Option<&str>) -> CoreResult<Option<String>> {
        let Some(working_dir) = working_dir else {
            return Ok(None);
        };
        let mut best: Option<(usize, String)> = None;
        for project in self.store.list_projects()? {
            if working_dir == project.path || working_dir.starts_with(&format!("{}/", project.path))
            {
                let length = project.path.len();
                if best
                    .as_ref()
                    .map(|(best, _)| length > *best)
                    .unwrap_or(true)
                {
                    best = Some((length, project.project_id));
                }
            }
        }
        Ok(best.map(|(_, id)| id))
    }

    pub fn record_usage(&self, session_id: &str, event: &adapter_protocol::SessionEvent) {
        let adapter_protocol::SessionEvent::TokenUsage {
            input,
            output,
            cache_read_input,
            cache_creation_input,
            effective_budget,
        } = event
        else {
            return;
        };
        let view = ContextView {
            input_tokens: Some(*input),
            output_tokens: Some(*output),
            cache_read_input: *cache_read_input,
            cache_creation_input: *cache_creation_input,
            effective_budget: *effective_budget,
            provider: None,
            model: None,
            observed_at_ms: now_ms(),
            source: "jcode.token_usage".into(),
        };
        self.usage
            .lock()
            .expect("usage")
            .insert(session_id.to_string(), view);
    }

    pub fn usage(&self, session_id: &str) -> Option<ContextView> {
        self.usage.lock().expect("usage").get(session_id).cloned()
    }

    pub fn record_activity(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        event: &adapter_protocol::SessionEvent,
    ) {
        let item = match event {
            adapter_protocol::SessionEvent::TurnStarted {
                turn_id,
                operation_id,
            } => Some(ActivityItem {
                at_ms: now_ms(),
                kind: "turn_started".into(),
                title: "Turn started".into(),
                detail: Some(format!("operation {operation_id}")),
                turn_id: Some(turn_id.clone()),
            }),
            adapter_protocol::SessionEvent::ToolStart { call_id, name } => Some(ActivityItem {
                at_ms: now_ms(),
                kind: "tool_started".into(),
                title: name.clone(),
                detail: Some(call_id.clone()),
                turn_id: turn_id.map(str::to_owned),
            }),
            adapter_protocol::SessionEvent::ToolDone {
                call_id: _,
                name,
                output,
                error,
            } => Some(ActivityItem {
                at_ms: now_ms(),
                kind: if error.is_some() {
                    "tool_failed"
                } else {
                    "tool_done"
                }
                .into(),
                title: name.clone(),
                detail: Some(
                    error
                        .clone()
                        .filter(|value| !value.is_empty())
                        .unwrap_or_else(|| truncate(output, 240)),
                ),
                turn_id: turn_id.map(str::to_owned),
            }),
            adapter_protocol::SessionEvent::PermissionRequest {
                tool_name,
                description,
                ..
            } => Some(ActivityItem {
                at_ms: now_ms(),
                kind: "permission_request".into(),
                title: tool_name.clone(),
                detail: Some(truncate(description, 240)),
                turn_id: turn_id.map(str::to_owned),
            }),
            adapter_protocol::SessionEvent::TurnStopped {
                reason, message, ..
            } => Some(ActivityItem {
                at_ms: now_ms(),
                kind: "turn_stopped".into(),
                title: format!("Stopped: {reason}"),
                detail: Some(truncate(message, 240)),
                turn_id: turn_id.map(str::to_owned),
            }),
            adapter_protocol::SessionEvent::TurnDone { .. } => Some(ActivityItem {
                at_ms: now_ms(),
                kind: "turn_done".into(),
                title: "Turn complete".into(),
                detail: None,
                turn_id: turn_id.map(str::to_owned),
            }),
            adapter_protocol::SessionEvent::AdapterError { code, message, .. } => {
                Some(ActivityItem {
                    at_ms: now_ms(),
                    kind: "adapter_error".into(),
                    title: code.clone(),
                    detail: Some(truncate(message, 240)),
                    turn_id: turn_id.map(str::to_owned),
                })
            }
            _ => None,
        };
        let Some(item) = item else {
            return;
        };
        let mut activity = self.activity.lock().expect("activity");
        let queue = activity
            .entry(session_id.to_string())
            .or_insert_with(|| VecDeque::with_capacity(200));
        queue.push_back(item);
        while queue.len() > 200 {
            queue.pop_front();
        }
    }

    pub fn activity(&self, session_id: &str) -> Vec<ActivityItem> {
        self.activity
            .lock()
            .expect("activity")
            .get(session_id)
            .map(|items| items.iter().rev().cloned().collect())
            .unwrap_or_default()
    }

    pub fn set_command_code_available(&self, available: bool) {
        let mut value = self.command_code_available.write().expect("cc lock");
        if *value != Some(available) {
            *value = Some(available);
        }
    }

    pub fn set_connection_message(&self, message: Option<String>) {
        *self
            .last_connection_message
            .write()
            .expect("connection message") = message;
    }

    pub fn pair_attempt_allowed(&self, key: &str) -> bool {
        let now = now_ms();
        let mut attempts = self.pair_attempts.lock().expect("pair attempts");
        let entry = attempts.entry(key.to_string()).or_insert((0, now));
        if now - entry.1 > 60_000 {
            *entry = (0, now);
        }
        if entry.0 >= 10 {
            return false;
        }
        entry.0 += 1;
        true
    }

    pub fn project_root(
        &self,
        project_id: &str,
    ) -> CoreResult<(std::path::PathBuf, adapter_core::ProjectRow)> {
        let project = self
            .store
            .project(project_id)?
            .ok_or_else(|| CoreError::NotFound("project".into()))?;
        let root = self
            .roots
            .canonical_project_root(std::path::Path::new(&project.path))?;
        Ok((root, project))
    }
}

fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut out: String = value.chars().take(limit).collect();
    out.push('…');
    out
}

pub enum Outbound {
    Envelope(adapter_protocol::Envelope),
    Close(u16, String),
}

#[derive(Clone)]
pub struct ConnContext {
    pub device: adapter_protocol::DeviceInfo,
    pub subscribed: Arc<Mutex<std::collections::HashSet<String>>>,
    pub outbound: mpsc::Sender<Outbound>,
}

impl ConnContext {
    pub async fn send(&self, envelope: adapter_protocol::Envelope) {
        let _ = self.outbound.send(Outbound::Envelope(envelope)).await;
    }

    pub fn is_subscribed(&self, session_id: &str) -> bool {
        self.subscribed
            .lock()
            .expect("subscribed")
            .contains(session_id)
    }

    pub fn subscribe(&self, session_id: &str) {
        self.subscribed
            .lock()
            .expect("subscribed")
            .insert(session_id.to_string());
    }

    pub fn unsubscribe(&self, session_id: &str) {
        self.subscribed
            .lock()
            .expect("subscribed")
            .remove(session_id);
    }
}
