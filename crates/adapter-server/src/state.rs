use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use adapter_core::{
    AdapterConfig, AuthService, Backend, BackendInfo, BackendSession, CoreError, CoreResult,
    RootScope, SessionTurnRegistry, Store, now_ms,
};
use adapter_protocol::{
    ActivityItem, ConnectionDiagnostics, ContextView, DiagnosticsSnapshot, FaultInjectionState,
    JcodeDiagnostics, JournalDiagnostics, LatencyDiagnostics, OperationDiagnostics, ServerInfo,
    ServerStatusPayload, SessionSummary,
};
use tokio::sync::{broadcast, mpsc};

use crate::faults::FaultInjection;
use crate::hub::Hub;
use crate::metrics::LatencyTracker;

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
    pub faults: Arc<FaultInjection>,
    pub metrics: Metrics,
    pub jcode_last_contact_ms: RwLock<Option<i64>>,
    pub jcode_reconnects: AtomicU64,
    pub jcode_last_error: RwLock<Option<String>>,
}

#[derive(Debug, Default)]
pub struct Metrics {
    pub active_connections: AtomicU64,
    pub subscriptions: AtomicU64,
    pub frames_in: AtomicU64,
    pub frames_out: AtomicU64,
    pub gaps_announced: AtomicU64,
    pub dispatch_latency: LatencyTracker,
    pub replay_latency: LatencyTracker,
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
        let faults = Arc::new(FaultInjection::from_env());
        Ok(Arc::new(Self {
            config: Arc::new(config),
            auth: AuthService::new(Arc::clone(&store)),
            hub: Arc::new(Hub::new(
                epoch,
                event_queue,
                Arc::clone(&store),
                Arc::clone(&faults),
            )),
            store,
            backend,
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
            faults,
            metrics: Metrics::default(),
            jcode_last_contact_ms: RwLock::new(None),
            jcode_reconnects: AtomicU64::new(0),
            jcode_last_error: RwLock::new(None),
        }))
    }

    pub fn note_jcode_contact(&self) {
        *self.jcode_last_contact_ms.write().expect("jcode contact") = Some(now_ms());
    }

    pub fn note_jcode_reconnect(&self, error: Option<String>) {
        self.jcode_reconnects.fetch_add(1, Ordering::Relaxed);
        *self.jcode_last_error.write().expect("jcode error") = error;
    }

    pub fn diagnostics(&self) -> DiagnosticsSnapshot {
        let info = self.backend.info();
        let journal = self.store.journal_stats().unwrap_or_default();
        let devices = self.auth.devices().map(|list| list.len()).unwrap_or(0);
        let (pending, unknown, accepted) = self.store.operation_counts().unwrap_or((0, 0, 0));
        let (dispatch_p50, dispatch_p95) = self.metrics.dispatch_latency.percentiles();
        let (replay_p50, replay_p95) = self.metrics.replay_latency.percentiles();
        DiagnosticsSnapshot {
            adapter_version: ADAPTER_VERSION.to_string(),
            protocol_version: adapter_protocol::PROTOCOL_VERSION,
            min_protocol_version: adapter_protocol::MIN_PROTOCOL_VERSION,
            epoch: self.hub.epoch().to_string(),
            started_at_ms: self.started_at_ms,
            observed_at_ms: now_ms(),
            capabilities: adapter_protocol::CAPABILITIES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            jcode: JcodeDiagnostics {
                healthy: info.healthy,
                server: info.server,
                jcode_version: info.jcode_version,
                protocol_version: info.protocol_version,
                capabilities: info.capabilities.len() as u32,
                last_contact_ms: *self.jcode_last_contact_ms.read().expect("jcode contact"),
                reconnects: self.jcode_reconnects.load(Ordering::Relaxed),
                last_error: self.jcode_last_error.read().expect("jcode error").clone(),
                active_turns: self.turns.active_count() as u32,
            },
            journal: JournalDiagnostics {
                events: journal.events,
                bytes: journal.bytes,
                sessions: journal.sessions,
                oldest_observed_at_ms: journal.oldest_observed_at_ms,
                newest_observed_at_ms: journal.newest_observed_at_ms,
                retention_per_session: self.store.journal_retention(),
                append_failures: self.hub.append_failures(),
            },
            connections: ConnectionDiagnostics {
                active: self.metrics.active_connections.load(Ordering::Relaxed),
                devices: devices as u64,
                subscriptions: self.metrics.subscriptions.load(Ordering::Relaxed),
                frames_in: self.metrics.frames_in.load(Ordering::Relaxed),
                frames_out: self.metrics.frames_out.load(Ordering::Relaxed),
                gaps_announced: self.metrics.gaps_announced.load(Ordering::Relaxed),
            },
            operations: OperationDiagnostics {
                pending,
                unknown,
                accepted,
            },
            latency: LatencyDiagnostics {
                samples: self.metrics.dispatch_latency.len() as u64,
                dispatch_p50_ms: dispatch_p50,
                dispatch_p95_ms: dispatch_p95,
                replay_p50_ms: replay_p50,
                replay_p95_ms: replay_p95,
            },
            fault_injection: FaultInjectionState {
                enabled: self.faults.enabled(),
                rules: self.faults.rules(),
            },
        }
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
    /// Negotiated wire version for this connection. Initialized to the minimum
    /// the adapter speaks so a frame cannot be sent above a client's range
    /// before `client.hello`.
    pub protocol_version: Arc<AtomicU32>,
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

    /// Returns true when this call added a new subscription.
    pub fn subscribe(&self, session_id: &str) -> bool {
        self.subscribed
            .lock()
            .expect("subscribed")
            .insert(session_id.to_string())
    }

    pub fn unsubscribe(&self, session_id: &str) {
        self.subscribed
            .lock()
            .expect("subscribed")
            .remove(session_id);
    }

    pub fn protocol_version(&self) -> u32 {
        self.protocol_version.load(Ordering::Relaxed)
    }

    pub fn set_protocol_version(&self, version: u32) {
        self.protocol_version.store(version, Ordering::Relaxed);
    }
}
