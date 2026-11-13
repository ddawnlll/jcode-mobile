//! Adapter request/operation integration tests with a deterministic backend.
//!
//! These tests exercise the real request handlers and durable SQLite state.
//! They do not claim to be a JCode harness test; the live SDK path is covered
//! separately by `scripts/stillness-e2e.sh` and the live evidence run.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use adapter_core::{
    AdapterConfig, AuthService, Backend, BackendEvent, BackendInfo, BackendRoute, BackendRuntime,
    BackendSession, CoreError, CoreResult, Store,
};
use adapter_protocol::{
    CreateSessionResponse, Envelope, Kind, OperationState, OperationStatePayload,
    SessionSnapshotPayload,
};
use adapter_server::dispatch::handle_request;
use adapter_server::handle_backend_event;
use adapter_server::state::{AppState, ConnContext, Outbound};
use serde_json::{Value, json};

struct FakeBackend {
    sessions: Mutex<Vec<BackendSession>>,
    sends: Mutex<Vec<(String, String)>>,
    fail_send: AtomicBool,
    next_id: AtomicU64,
    history: Mutex<Vec<adapter_protocol::HistoryMessageView>>,
}

impl Default for FakeBackend {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(Vec::new()),
            sends: Mutex::new(Vec::new()),
            fail_send: AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            history: Mutex::new(Vec::new()),
        }
    }
}

impl FakeBackend {
    fn session(&self, id: &str) -> Option<BackendSession> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .find(|session| session.session_id == id)
            .cloned()
    }
}

impl Backend for FakeBackend {
    fn info(&self) -> BackendInfo {
        BackendInfo {
            server: "fake-jcode".into(),
            jcode_version: "fake".into(),
            protocol_version: 1,
            capabilities: vec!["send_message".into()],
            healthy: true,
        }
    }

    fn list_sessions(&self) -> CoreResult<Vec<BackendSession>> {
        Ok(self.sessions.lock().unwrap().clone())
    }

    fn create_session(&self, working_dir: Option<&str>) -> CoreResult<BackendSession> {
        let n = self.next_id.fetch_add(1, Ordering::Relaxed);
        let session = BackendSession {
            session_id: format!("sess_{n}"),
            title: None,
            status: "idle".into(),
            working_dir: working_dir.map(str::to_owned),
            updated_at_ms: Some(1_700_000_000_000),
            transcript_bytes: Some(0),
            saved: false,
            archived: false,
            parent_session_id: None,
            agent_label: None,
        };
        self.sessions.lock().unwrap().push(session.clone());
        Ok(session)
    }

    fn attach_session(&self, session_id: &str) -> CoreResult<BackendSession> {
        self.session(session_id)
            .ok_or_else(|| CoreError::NotFound(session_id.into()))
    }

    fn history(
        &self,
        _session_id: &str,
        _tail: Option<u32>,
    ) -> CoreResult<Vec<adapter_protocol::HistoryMessageView>> {
        Ok(self.history.lock().unwrap().clone())
    }

    fn runtime(&self, _session_id: &str) -> CoreResult<BackendRuntime> {
        Ok(BackendRuntime {
            provider: Some("command-code".into()),
            model: Some("command-code-large".into()),
            reasoning_effort: Some("medium".into()),
            auth_method: Some("api_key".into()),
            account_label: Some("test-account".into()),
            providers: vec!["command-code".into()],
            routes: vec![BackendRoute {
                model: "command-code-large".into(),
                provider: "command-code".into(),
                api_method: "responses".into(),
                available: true,
                detail: String::new(),
            }],
        })
    }

    fn list_models(&self, _session_id: &str) -> CoreResult<(Vec<String>, Option<String>)> {
        Ok((
            vec!["command-code-large".into()],
            Some("command-code-large".into()),
        ))
    }

    fn set_model(&self, _session_id: &str, _model: &str) -> CoreResult<()> {
        Ok(())
    }

    fn set_reasoning_effort(&self, _session_id: &str, _effort: &str) -> CoreResult<()> {
        Ok(())
    }

    fn set_context_cap(&self, _session_id: &str, _max_tokens: Option<u64>) -> CoreResult<()> {
        Ok(())
    }

    fn rename_session(&self, session_id: &str, title: Option<&str>) -> CoreResult<()> {
        if let Some(session) = self
            .sessions
            .lock()
            .unwrap()
            .iter_mut()
            .find(|session| session.session_id == session_id)
        {
            session.title = title.map(str::to_owned);
            Ok(())
        } else {
            Err(CoreError::NotFound(session_id.into()))
        }
    }

    fn plan(&self, _session_id: &str) -> CoreResult<Option<Value>> {
        Ok(None)
    }

    fn send(&self, session_id: &str, content: &str) -> CoreResult<()> {
        if self.fail_send.load(Ordering::Relaxed) {
            return Err(CoreError::BackendRejected(
                "provider route is unavailable".into(),
            ));
        }
        self.sends
            .lock()
            .unwrap()
            .push((session_id.to_string(), content.to_string()));
        Ok(())
    }

    fn cancel(&self, _session_id: &str) -> CoreResult<()> {
        Ok(())
    }

    fn permission_response(
        &self,
        _session_id: &str,
        _request_id: &str,
        _decision: &str,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn ping(&self) -> CoreResult<()> {
        Ok(())
    }

    fn healthy(&self) -> bool {
        true
    }
}

struct Harness {
    state: Arc<AppState>,
    conn: ConnContext,
    backend: Arc<FakeBackend>,
}

fn harness(data_dir: &std::path::Path) -> Harness {
    let root = tempfile::tempdir().unwrap();
    let _ = root.path();
    let store = Store::open(data_dir).unwrap();
    let auth = AuthService::new(Arc::clone(&store));
    auth.install_pairing_code(Some("123456")).unwrap();
    let (token, device) = auth.redeem("123456", "integration-test").unwrap();
    assert!(token.len() >= 16);
    let backend = Arc::new(FakeBackend::default());
    let config = AdapterConfig {
        bind: "127.0.0.1:0".into(),
        data_dir: data_dir.to_path_buf(),
        allowed_roots: vec![std::env::current_dir().unwrap()],
        pairing_code: Some("123456".into()),
        web_dir: None,
        jcode_api_socket: None,
        jcode_binary: None,
        server_name: "test".into(),
        max_file_bytes: 1024,
        event_queue: 32,
        disconnect_grace: std::time::Duration::from_secs(1),
        allowed_origins: Vec::new(),
        session_create_default_dir: Some(std::env::current_dir().unwrap()),
    };
    let state = AppState::new(
        config,
        store,
        Arc::clone(&backend) as Arc<dyn Backend>,
        "epoch-test".into(),
    )
    .unwrap();
    let (outbound, _receiver) = tokio::sync::mpsc::channel::<Outbound>(32);
    let conn = ConnContext {
        device,
        subscribed: Arc::new(Mutex::new(std::collections::HashSet::new())),
        outbound,
    };
    Harness {
        state,
        conn,
        backend,
    }
}

fn request(msg_type: &str, payload: Value) -> Envelope {
    Envelope::request(format!("req_{msg_type}"), msg_type, payload)
}

async fn call(harness: &Harness, msg_type: &str, payload: Value) -> Envelope {
    handle_request(
        Arc::clone(&harness.state),
        harness.conn.clone(),
        request(msg_type, payload),
    )
    .await
}

fn response_payload<T: serde::de::DeserializeOwned>(response: &Envelope) -> T {
    assert_eq!(
        response.kind,
        Kind::Response,
        "unexpected error: {:?}",
        response.payload
    );
    serde_json::from_value(response.payload.clone()).unwrap()
}

#[tokio::test]
async fn reserve_dispatch_and_acknowledgment_are_distinct_and_monotonic() {
    let dir = tempfile::tempdir().unwrap();
    let h = harness(dir.path());

    let created: CreateSessionResponse = response_payload(
        &call(
            &h,
            "sessions.create",
            json!({
                "client_request_id": "create-1",
                "project_id": null,
                "working_dir": null,
                "title": "Integration session"
            }),
        )
        .await,
    );
    assert!(created.created);
    let session_id = created.session.session_id.clone();
    assert_eq!(
        created.session.title.as_deref(),
        Some("Integration session")
    );

    let reserved: OperationStatePayload = response_payload(
        &call(
            &h,
            "operations.reserve",
            json!({
                "operation_id": "op-1",
                "session_id": session_id,
                "kind": "send",
                "body": "hello real operation",
                "expected_turn_id": null
            }),
        )
        .await,
    );
    assert_eq!(reserved.operation.state, OperationState::Staged);
    assert!(!reserved.duplicate);

    let dispatched: OperationStatePayload =
        response_payload(&call(&h, "operations.dispatch", json!({"operation_id": "op-1"})).await);
    assert_eq!(dispatched.operation.state, OperationState::Dispatching);
    assert!(dispatched.operation.turn_id.is_some());
    assert_eq!(
        h.backend.sends.lock().unwrap().as_slice(),
        &[(session_id.clone(), "hello real operation".to_string())]
    );
    assert!(h.state.turns.active(&session_id).is_some());

    // A duplicate dispatch must not write to the backend twice.
    let duplicate: OperationStatePayload =
        response_payload(&call(&h, "operations.dispatch", json!({"operation_id": "op-1"})).await);
    assert!(duplicate.duplicate);
    assert_eq!(h.backend.sends.lock().unwrap().len(), 1);

    // Only an authoritative daemon acknowledgment promotes Dispatching.
    handle_backend_event(
        Arc::clone(&h.state),
        BackendEvent::Accepted {
            session_id: session_id.clone(),
        },
    )
    .await;
    let operation = h.state.store.operation("op-1").unwrap().unwrap();
    assert_eq!(operation.state, OperationState::Accepted);
    assert_eq!(
        h.state.turns.active(&session_id).unwrap().status,
        "accepted"
    );

    handle_backend_event(
        Arc::clone(&h.state),
        BackendEvent::Session {
            session_id: session_id.clone(),
            event: adapter_protocol::SessionEvent::TurnDone { turn_id: None },
        },
    )
    .await;
    assert!(h.state.turns.active(&session_id).is_none());
}

#[tokio::test]
async fn failed_send_is_rejected_not_accepted() {
    let dir = tempfile::tempdir().unwrap();
    let h = harness(dir.path());
    let created: CreateSessionResponse = response_payload(
        &call(
            &h,
            "sessions.create",
            json!({
                "client_request_id": "create-2",
                "project_id": null,
                "working_dir": null,
                "title": null
            }),
        )
        .await,
    );
    let session_id = created.session.session_id;
    let _: OperationStatePayload = response_payload(
        &call(
            &h,
            "operations.reserve",
            json!({
                "operation_id": "op-2",
                "session_id": session_id,
                "kind": "send",
                "body": "will fail",
                "expected_turn_id": null
            }),
        )
        .await,
    );
    h.backend.fail_send.store(true, Ordering::Relaxed);
    let response = call(&h, "operations.dispatch", json!({"operation_id": "op-2"})).await;
    assert_eq!(response.kind, Kind::Response);
    assert_eq!(response.msg_type, "error");
    let operation = h.state.store.operation("op-2").unwrap().unwrap();
    assert_eq!(operation.state, OperationState::Rejected);
    assert!(h.state.turns.active(&session_id).is_none());
}

#[tokio::test(start_paused = true)]
async fn unacknowledged_dispatch_becomes_unknown_and_never_resends() {
    let dir = tempfile::tempdir().unwrap();
    let h = harness(dir.path());
    let created: CreateSessionResponse = response_payload(
        &call(
            &h,
            "sessions.create",
            json!({
                "client_request_id": "create-3",
                "project_id": null,
                "working_dir": null,
                "title": null
            }),
        )
        .await,
    );
    let session_id = created.session.session_id;
    let _: OperationStatePayload = response_payload(
        &call(
            &h,
            "operations.reserve",
            json!({
                "operation_id": "op-3",
                "session_id": session_id,
                "kind": "send",
                "body": "no acknowledgment",
                "expected_turn_id": null
            }),
        )
        .await,
    );
    let _: OperationStatePayload =
        response_payload(&call(&h, "operations.dispatch", json!({"operation_id": "op-3"})).await);
    // Let the spawned acceptance timer poll once so the paused clock has a
    // registered deadline, then advance past it.
    tokio::task::yield_now().await;
    tokio::time::advance(std::time::Duration::from_secs(6)).await;
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    let operation = h.state.store.operation("op-3").unwrap().unwrap();
    assert_eq!(operation.state, OperationState::Unknown);
    assert_eq!(h.backend.sends.lock().unwrap().len(), 1);
}

#[test]
fn project_listing_is_adapter_owned() {
    let dir = tempfile::tempdir().unwrap();
    let h = harness(dir.path());
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let response = runtime.block_on(call(&h, "projects.list", json!({})));
    assert_eq!(response.kind, Kind::Response);
    let projects = response
        .payload
        .get("projects")
        .unwrap()
        .as_array()
        .unwrap();
    assert!(!projects.is_empty());
    let ids: Vec<_> = projects
        .iter()
        .filter_map(|project| project.get("project_id").and_then(Value::as_str))
        .collect();
    assert!(ids.iter().all(|id| !id.is_empty()));
}

#[tokio::test]
async fn create_session_is_idempotent_per_client_request_id_but_not_across() {
    let dir = tempfile::tempdir().unwrap();
    let h = harness(dir.path());

    let first: CreateSessionResponse = response_payload(
        &call(
            &h,
            "sessions.create",
            json!({
                "client_request_id": "create-a",
                "project_id": null,
                "working_dir": null,
                "title": "run one"
            }),
        )
        .await,
    );
    let retry: CreateSessionResponse = response_payload(
        &call(
            &h,
            "sessions.create",
            json!({
                "client_request_id": "create-a",
                "project_id": null,
                "working_dir": null,
                "title": "run one"
            }),
        )
        .await,
    );
    assert!(first.created);
    assert!(!retry.created, "a retry with the same key must not create");
    assert_eq!(first.session.session_id, retry.session.session_id);

    let second: CreateSessionResponse = response_payload(
        &call(
            &h,
            "sessions.create",
            json!({
                "client_request_id": "create-b",
                "project_id": null,
                "working_dir": null,
                "title": "run two"
            }),
        )
        .await,
    );
    assert_ne!(
        first.session.session_id, second.session.session_id,
        "a distinct client_request_id must never return the earlier session"
    );
    assert_eq!(second.session.title.as_deref(), Some("run two"));
}

#[tokio::test]
async fn snapshot_after_finished_tool_turn_includes_tool_rows_and_promotes_pending() {
    let dir = tempfile::tempdir().unwrap();
    let h = harness(dir.path());

    let created: CreateSessionResponse = response_payload(
        &call(
            &h,
            "sessions.create",
            json!({
                "client_request_id": "create-tool",
                "project_id": null,
                "working_dir": null,
                "title": "tool turn"
            }),
        )
        .await,
    );
    let session_id = created.session.session_id.clone();

    let body = "remember this exact instruction";
    let _: OperationStatePayload = response_payload(
        &call(
            &h,
            "operations.reserve",
            json!({
                "operation_id": "op-tool",
                "session_id": session_id,
                "kind": "send",
                "body": body,
                "expected_turn_id": null
            }),
        )
        .await,
    );
    let _: OperationStatePayload =
        response_payload(&call(&h, "operations.dispatch", json!({"operation_id": "op-tool"})).await);
    handle_backend_event(
        Arc::clone(&h.state),
        BackendEvent::Accepted {
            session_id: session_id.clone(),
        },
    )
    .await;

    // The daemon's authoritative transcript after the turn: user, tool result,
    // assistant. Tool rows must survive the snapshot path.
    *h.backend.history.lock().unwrap() = vec![
        adapter_protocol::HistoryMessageView {
            index: 0,
            role: "user".into(),
            content: body.into(),
            tool_call_id: None,
            tool_name: None,
            tool_input: None,
            response_stats: None,
        },
        adapter_protocol::HistoryMessageView {
            index: 1,
            role: "tool".into(),
            content: "tool output".into(),
            tool_call_id: Some("call_1".into()),
            tool_name: Some("bash".into()),
            tool_input: Some(json!({"command": "ls"})),
            response_stats: None,
        },
        adapter_protocol::HistoryMessageView {
            index: 2,
            role: "assistant".into(),
            content: "DONE".into(),
            tool_call_id: None,
            tool_name: None,
            tool_input: None,
            response_stats: None,
        },
    ];

    let snapshot: SessionSnapshotPayload = response_payload(
        &call(
            &h,
            "sessions.subscribe",
            json!({
                "session_id": session_id,
                "tail": 160,
                "after_seq": null
            }),
        )
        .await,
    );

    let roles: Vec<&str> = snapshot
        .messages
        .iter()
        .map(|message| message.role.as_str())
        .collect();
    assert_eq!(roles, vec!["user", "tool", "assistant"]);

    let operation = h.state.store.operation("op-tool").unwrap().unwrap();
    assert_eq!(
        operation.state,
        OperationState::ObservedInHistory,
        "the authoritative snapshot carrying the user message must promote the send operation"
    );
}
