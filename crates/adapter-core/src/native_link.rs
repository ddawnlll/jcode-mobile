use std::io;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::Duration;

use adapter_protocol::{RuntimeIdentity, SessionEvent, SwarmAgentView};
use jcode_harness_api_server::translate::{BridgeState, Outbound, legacy_event_may_block};
use jcode_provider_core::RouteSelection;
use jcode_sdk::api::{ApiEvent, ApiRequest, ClientFrame, ErrorCode};
use jcode_transport::Stream;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::runtime::Handle;
use tokio::sync::{Notify, mpsc, oneshot};
use tokio::time::{Instant, sleep_until, timeout};

use crate::backend::{BackendEvent, CoreError, CoreResult};
use crate::live::map_event;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
const READ_BUFFER_RETAIN: usize = 256 * 1024;
const COMMAND_CAPACITY: usize = 16;
// BridgeState assigns the low ids for translated native requests.
static NEXT_NATIVE_ID: AtomicU64 = AtomicU64::new(u64::MAX);

pub(crate) enum Command {
    Api(ApiRequest),
    SetRoute(RouteSelection),
}

struct Request {
    command: Command,
    reply: oneshot::Sender<CoreResult<ApiEvent>>,
    deadline: Instant,
}

#[derive(Clone)]
pub(crate) struct NativeLink {
    commands: mpsc::Sender<Request>,
    busy: Arc<AtomicBool>,
    agents: Arc<Mutex<Option<Vec<SwarmAgentView>>>>,
    catalog_changed: Arc<Notify>,
}

impl NativeLink {
    pub(crate) fn start(
        runtime: &Handle,
        socket: PathBuf,
        target: Option<String>,
        events: mpsc::Sender<BackendEvent>,
    ) -> Self {
        let (commands, inbox) = mpsc::channel(COMMAND_CAPACITY);
        let busy = Arc::new(AtomicBool::new(false));
        let agents = Arc::new(Mutex::new(None));
        let catalog_changed = Arc::new(Notify::new());
        let connection = Connection {
            bridge: BridgeState::default(),
            target,
            busy: Arc::clone(&busy),
            agents: Arc::clone(&agents),
            runtime_identity: None,
            last_status: None,
            catalog_changed: Arc::clone(&catalog_changed),
            events,
        };
        runtime.spawn(connection.run(socket, inbox));
        Self {
            commands,
            busy,
            agents,
            catalog_changed,
        }
    }

    pub(crate) fn request(&self, command: Command) -> CoreResult<ApiEvent> {
        let (reply, result) = oneshot::channel();
        self.commands
            .try_send(Request {
                command,
                reply,
                deadline: Instant::now() + REQUEST_TIMEOUT,
            })
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => {
                    unavailable("JCode session command queue is full")
                }
                mpsc::error::TrySendError::Closed(_) => {
                    unavailable("JCode session connection closed")
                }
            })?;
        match result
            .blocking_recv()
            .map_err(|_| unavailable("JCode session connection closed"))??
        {
            ApiEvent::Error {
                code: ErrorCode::UnknownSession,
                message,
            } => Err(CoreError::NotFound(message)),
            ApiEvent::Error { message, .. } => Err(CoreError::BackendRejected(message)),
            event => Ok(event),
        }
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.commands.is_closed()
    }

    pub(crate) fn in_use(&self) -> bool {
        // The pool and connection each own one handle. A third is a caller
        // using this link and must not race a replacement for the same session.
        self.busy.load(Ordering::Relaxed) || Arc::strong_count(&self.busy) > 2
    }

    pub(crate) fn agents(&self) -> Option<Vec<SwarmAgentView>> {
        self.agents.lock().expect("swarm agents").clone()
    }

    pub(crate) fn refresh_runtime(&self) {
        self.catalog_changed.notify_one();
    }
}

pub(crate) fn unavailable(message: &str) -> CoreError {
    CoreError::BackendUnavailable(message.into())
}

struct Pending {
    reply: oneshot::Sender<CoreResult<ApiEvent>>,
    deadline: Instant,
    route_id: Option<u64>,
}

struct Connection {
    bridge: BridgeState,
    target: Option<String>,
    busy: Arc<AtomicBool>,
    agents: Arc<Mutex<Option<Vec<SwarmAgentView>>>>,
    runtime_identity: Option<RuntimeIdentity>,
    last_status: Option<(String, Option<u32>)>,
    catalog_changed: Arc<Notify>,
    events: mpsc::Sender<BackendEvent>,
}

impl Connection {
    async fn run(mut self, socket: PathBuf, mut inbox: mpsc::Receiver<Request>) {
        self.bridge.client_name =
            Some(concat!("jcode-mobile-adapter-v4/", env!("CARGO_PKG_VERSION")).into());
        let result = async {
            let stream = timeout(REQUEST_TIMEOUT, Stream::connect(&socket)).await??;
            let (reader, writer) = stream.into_split();
            self.pump(reader, writer, &mut inbox).await
        }
        .await;
        inbox.close();
        if let Err(error) = result {
            tracing::warn!(session = self.bridge.session_id, %error, "JCode session stream closed");
            if let Some(session_id) = self.bridge.session_id {
                let _ = self
                    .events
                    .send(BackendEvent::Session {
                        session_id,
                        event: SessionEvent::NeedsReconcile {
                            reason: "jcode_stream_closed".into(),
                        },
                    })
                    .await;
            }
        }
    }

    async fn pump(
        &mut self,
        reader: impl AsyncRead + Unpin,
        mut writer: impl AsyncWrite + Unpin,
        inbox: &mut mpsc::Receiver<Request>,
    ) -> io::Result<()> {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        let mut pending: Option<Pending> = None;
        let catalog_changed = Arc::clone(&self.catalog_changed);
        let mut catalog_request = None;
        let mut next_catalog = Instant::now();
        loop {
            let deadline = pending.as_ref().map(|request| request.deadline);
            tokio::select! {
                request = inbox.recv(), if pending.is_none() => {
                    let Some(request) = request else { return Ok(()) };
                    if request.deadline <= Instant::now() {
                        let _ = request.reply.send(Err(unavailable("JCode command expired in its queue")));
                        continue;
                    }
                    pending = self.send(request, &mut writer).await?;
                }
                _ = async {
                    sleep_until(next_catalog).await;
                    catalog_changed.notified().await;
                }, if self.bridge.session_id.is_some() && catalog_request.is_none() => {
                    // JCode persists effort changes made by other clients.
                    // A write notification triggers a catalog read over this
                    // existing attachment, without polling or reopening it.
                    let id = NEXT_NATIVE_ID.fetch_sub(1, Ordering::Relaxed);
                    let deadline = Instant::now() + REQUEST_TIMEOUT;
                    write_frame(&mut writer, &json!({
                        "type": "get_model_catalog", "id": id, "subscribe_usage_updates": true,
                    }), deadline).await?;
                    catalog_request = Some((id, deadline));
                    next_catalog = Instant::now() + Duration::from_millis(125);
                }
                read = read_frame(&mut reader, &mut buffer) => {
                    read?;
                    let mut event: Value = serde_json::from_slice(&buffer).map_err(io::Error::other)?;
                    buffer.clear();
                    if buffer.capacity() > READ_BUFFER_RETAIN {
                        buffer = Vec::new();
                    }
                    if catalog_request.is_some_and(|(id, _)| event["id"].as_u64() == Some(id)) {
                        catalog_request = None;
                        if event["type"] == "history" {
                            event["type"] = Value::String("available_models_updated".into());
                        }
                    }
                    self.receive(event, &mut pending).await?;
                }
                _ = async {
                    if let Some((_, deadline)) = catalog_request { sleep_until(deadline).await; }
                }, if catalog_request.is_some() => { catalog_request = None; }
                _ = async {
                    if let Some(deadline) = deadline {
                        sleep_until(deadline).await;
                    }
                }, if deadline.is_some() => {
                    if let Some(request) = pending.take() {
                        let _ = request.reply.send(Err(unavailable("JCode did not reply before the deadline")));
                    }
                    // A late reply cannot be matched to a later request.
                    return Err(io::Error::new(io::ErrorKind::TimedOut, "JCode reply timed out"));
                }
            }
        }
    }

    async fn send(
        &mut self,
        request: Request,
        writer: &mut (impl AsyncWrite + Unpin),
    ) -> io::Result<Option<Pending>> {
        let Request {
            command,
            reply,
            deadline,
        } = request;
        match command {
            Command::SetRoute(selection) => {
                let id = NEXT_NATIVE_ID.fetch_sub(1, Ordering::Relaxed);
                write_frame(
                    writer,
                    &json!({"type":"set_route", "id":id, "selection":selection}),
                    deadline,
                )
                .await?;
                Ok(Some(Pending {
                    reply,
                    deadline,
                    route_id: Some(id),
                }))
            }
            Command::Api(request) => {
                let send_message = matches!(
                    &request,
                    ApiRequest::SendMessage {
                        no_reply: false,
                        ..
                    }
                );
                let api =
                    serde_json::to_value(ClientFrame::new(1, request)).map_err(io::Error::other)?;
                for action in self.bridge.api_request_to_legacy(&api) {
                    match action {
                        Outbound::Legacy(mut request) => {
                            if request["type"] == "subscribe" {
                                request["continue_on_disconnect"] = Value::Bool(true);
                            }
                            write_frame(writer, &request, deadline).await?;
                        }
                        Outbound::Reply(frame) => {
                            let _ = reply.send(Ok(frame.event));
                            return Ok(None);
                        }
                    }
                }
                if send_message {
                    self.busy.store(true, Ordering::Relaxed);
                    // The bridge's acceptance comes later as MessageAccepted.
                    let _ = reply.send(Ok(ApiEvent::Ok));
                    return Ok(None);
                }
                Ok(Some(Pending {
                    reply,
                    deadline,
                    route_id: None,
                }))
            }
        }
    }

    async fn receive(&mut self, event: Value, pending: &mut Option<Pending>) -> io::Result<()> {
        if event["type"] == "swarm_status" {
            self.swarm(event).await;
            return Ok(());
        }

        // Exact route changes use the native command. The upstream translator
        // still consumes its ModelChanged event to update runtime identity.
        let route_reply = pending
            .as_ref()
            .and_then(|request| request.route_id)
            .filter(|id| event["id"].as_u64() == Some(*id))
            .and_then(|_| match event["type"].as_str() {
                Some("model_changed" | "error") => Some(
                    match event["error"].as_str().or_else(|| {
                        (event["type"] == "error")
                            .then(|| event["message"].as_str())
                            .flatten()
                    }) {
                        Some(message) => ApiEvent::Error {
                            code: ErrorCode::InvalidRequest,
                            message: message.into(),
                        },
                        None => ApiEvent::Ok,
                    },
                ),
                _ => None,
            });

        // History and state hydration can consult JCode's persisted metadata.
        let frames = if legacy_event_may_block(&event)
            && Handle::current().runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread
        {
            tokio::task::block_in_place(|| self.bridge.legacy_event_to_api(&event))
        } else {
            self.bridge.legacy_event_to_api(&event)
        };

        if let Some(response) = route_reply {
            let _ = pending
                .take()
                .expect("correlated route request")
                .reply
                .send(Ok(response));
        }
        for frame in frames {
            if frame.reply_to.is_some() {
                if let Some(request) = pending.take() {
                    if let ApiEvent::Attached { session } = &frame.event {
                        if self
                            .target
                            .as_ref()
                            .is_some_and(|target| target != &session.session_id)
                        {
                            let _ = request.reply.send(Err(CoreError::Conflict(
                                "JCode attached to a different session".into(),
                            )));
                            return Err(io::Error::other("unexpected JCode attachment"));
                        }
                        self.target = Some(session.session_id.clone());
                    }
                    let _ = request.reply.send(Ok(frame.event));
                }
                continue;
            }
            match &frame.event {
                ApiEvent::SessionStatus {
                    session_id,
                    status,
                    pending_soft_interrupts,
                } if self.target.as_ref() == Some(session_id) => {
                    self.busy.store(
                        !matches!(status.as_str(), "idle" | "closed" | "attached"),
                        Ordering::Relaxed,
                    );
                    if self
                        .last_status
                        .as_ref()
                        .is_some_and(|(previous, pending)| {
                            previous == status && pending == pending_soft_interrupts
                        })
                    {
                        continue;
                    }
                    self.last_status = Some((status.clone(), *pending_soft_interrupts));
                }
                ApiEvent::TextDelta { .. }
                | ApiEvent::ReasoningDelta { .. }
                | ApiEvent::ToolStart { .. } => {
                    self.busy.store(true, Ordering::Relaxed);
                }
                ApiEvent::TurnDone { .. }
                | ApiEvent::TurnStopped { .. }
                | ApiEvent::Error { .. } => {
                    self.busy.store(false, Ordering::Relaxed);
                }
                _ => {}
            }
            if let Some(mapped) = map_event(frame.event, self.target.as_deref()) {
                if let BackendEvent::Runtime { runtime, .. } = &mapped {
                    if self.runtime_identity.as_ref() == Some(runtime) {
                        continue;
                    }
                    self.runtime_identity = Some(runtime.clone());
                }
                self.events
                    .send(mapped)
                    .await
                    .map_err(|_| io::Error::other("adapter event receiver stopped"))?;
            }
        }
        Ok(())
    }

    async fn swarm(&mut self, mut event: Value) {
        let Some(session_id) = self.target.as_ref().or(self.bridge.session_id.as_ref()) else {
            return;
        };
        let Ok(members) = serde_json::from_value::<Vec<SwarmMember>>(event["members"].take())
        else {
            return;
        };
        let mut agents: Vec<_> = members
            .into_iter()
            .filter(|member| {
                member.session_id != *session_id
                    && member.report_back_to_session_id.as_deref() == Some(session_id)
            })
            .map(SwarmMember::into_view)
            .collect();
        agents.sort_unstable_by(|a, b| a.session_id.cmp(&b.session_id));
        {
            let mut last = self.agents.lock().expect("swarm agents");
            if last.as_ref() == Some(&agents) {
                return;
            }
            *last = Some(agents.clone());
        }
        let _ = self
            .events
            .send(BackendEvent::Swarm {
                session_id: session_id.clone(),
                agents,
            })
            .await;
    }
}

async fn read_frame(
    reader: &mut (impl AsyncBufRead + Unpin),
    buffer: &mut Vec<u8>,
) -> io::Result<()> {
    // read_until is cancellation-safe. The prefix survives command selection.
    let remaining = (MAX_FRAME_BYTES - buffer.len()) as u64;
    (&mut *reader)
        .take(remaining)
        .read_until(b'\n', buffer)
        .await?;
    if buffer.last() == Some(&b'\n') {
        return Ok(());
    }
    if buffer.len() == MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "oversized JCode frame",
        ));
    }
    Err(io::Error::new(
        io::ErrorKind::UnexpectedEof,
        "JCode socket reached EOF",
    ))
}

async fn write_frame(
    writer: &mut (impl AsyncWrite + Unpin),
    request: &Value,
    deadline: Instant,
) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(request).map_err(io::Error::other)?;
    bytes.push(b'\n');
    tokio::time::timeout_at(deadline, writer.write_all(&bytes)).await?
}

#[derive(Deserialize)]
struct SwarmMember {
    session_id: String,
    friendly_name: Option<String>,
    task_label: Option<String>,
    status: String,
    report_back_to_session_id: Option<String>,
    #[serde(default)]
    runtime: SwarmRuntime,
}

#[derive(Default, Deserialize)]
struct SwarmRuntime {
    model: Option<String>,
    provider: Option<String>,
    effort: Option<String>,
}

impl SwarmMember {
    fn into_view(self) -> SwarmAgentView {
        SwarmAgentView {
            session_id: self.session_id,
            parent_session_id: self.report_back_to_session_id,
            label: self.task_label.or(self.friendly_name),
            status: self.status,
            model: self.runtime.model,
            provider: self.runtime.provider,
            reasoning_effort: self.runtime.effort,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jcode_provider_core::{ModelRouteApiMethod, RuntimeKey};

    async fn next_wire(reader: &mut (impl AsyncBufRead + Unpin)) -> Value {
        let mut frame = Vec::new();
        timeout(Duration::from_secs(2), read_frame(reader, &mut frame))
            .await
            .unwrap()
            .unwrap();
        serde_json::from_slice(&frame).unwrap()
    }

    fn command(command: Command) -> (Request, oneshot::Receiver<CoreResult<ApiEvent>>) {
        let (reply, receive) = oneshot::channel();
        (
            Request {
                command,
                reply,
                deadline: Instant::now() + Duration::from_secs(2),
            },
            receive,
        )
    }

    #[tokio::test]
    async fn session_stream_correlates_attach_route_and_acceptance() {
        let id = "session_v4_transport_fixture";
        let (tx, mut rx) = mpsc::channel(8);
        let (events, mut observed) = mpsc::channel(32);
        let (adapter, daemon) = tokio::io::duplex(16_384);
        let catalog_changed = Arc::new(Notify::new());
        let mut link = Connection {
            target: Some(id.into()),
            bridge: BridgeState::default(),
            busy: Arc::new(AtomicBool::new(false)),
            agents: Arc::new(Mutex::new(None)),
            runtime_identity: None,
            last_status: None,
            catalog_changed: Arc::clone(&catalog_changed),
            events,
        };
        let job = tokio::spawn(async move {
            let (reader, writer) = tokio::io::split(adapter);
            link.pump(reader, writer, &mut rx).await
        });

        let (reader, mut writer) = tokio::io::split(daemon);
        let mut daemon = BufReader::new(reader);
        let (attach, attached) = command(Command::Api(ApiRequest::AttachSession {
            session_id: id.into(),
        }));
        tx.send(attach).await.unwrap();
        let subscribe = next_wire(&mut daemon).await;
        assert_eq!(subscribe["type"], "subscribe");
        assert_eq!(subscribe["target_session_id"], id);
        assert_eq!(subscribe["continue_on_disconnect"], true);
        let state = next_wire(&mut daemon).await;
        let _catalog = next_wire(&mut daemon).await;
        write_frame(
            &mut writer,
            &json!({"type":"state", "id":state["id"], "session_id":id, "is_processing":false}),
            Instant::now() + Duration::from_secs(2),
        )
        .await
        .unwrap();
        let reply = attached.await.unwrap().unwrap();
        assert!(matches!(reply, ApiEvent::Attached { session } if session.session_id == id));

        let (route, changed) = command(Command::SetRoute(RouteSelection {
            model: "gpt-5.4".into(),
            runtime_key: RuntimeKey::from_api_method(
                &ModelRouteApiMethod::parse("openai-api-key"),
                "OpenAI",
            ),
            api_method: "openai-api-key".into(),
            provider_label: "OpenAI".into(),
            detail: String::new(),
        }));
        tx.send(route).await.unwrap();
        let selection = next_wire(&mut daemon).await;
        assert_eq!(selection["type"], "set_route");
        assert_eq!(selection["selection"]["api_method"], "openai-api-key");
        write_frame(
            &mut writer,
            &json!({
                "type":"model_changed", "id":selection["id"], "model":"gpt-5.4",
                "provider_name":"OpenAI", "reasoning_effort":"high"
            }),
            Instant::now() + Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert!(matches!(changed.await.unwrap().unwrap(), ApiEvent::Ok));

        let (send, sent) = command(Command::Api(ApiRequest::SendMessage {
            session_id: id.into(),
            content: "İstanbul 🪶".into(),
            system_reminder: None,
            images: vec![],
            no_reply: false,
        }));
        tx.send(send).await.unwrap();
        let message = next_wire(&mut daemon).await;
        assert_eq!(message["content"], "İstanbul 🪶");
        assert!(matches!(sent.await.unwrap().unwrap(), ApiEvent::Ok));
        write_frame(
            &mut writer,
            &json!({"type":"ack", "id":message["id"]}),
            Instant::now() + Duration::from_secs(2),
        )
        .await
        .unwrap();
        write_frame(&mut writer, &json!({
            "type":"swarm_status", "members":[{
                "session_id":"child", "report_back_to_session_id":id, "status":"running",
                "task_label":"Review", "runtime":{"model":"gpt-5.4","provider":"OpenAI","effort":"xhigh"}
            },{
                "session_id":"unrelated", "report_back_to_session_id":"another-parent", "status":"running"
            }]
        }), Instant::now() + Duration::from_secs(2)).await.unwrap();

        let result = timeout(Duration::from_secs(2), async {
            let mut identity = false;
            let mut accepted = false;
            let mut swarm = false;
            while !(identity && accepted && swarm) {
                match observed.recv().await.unwrap() {
                    BackendEvent::Runtime {
                        session_id,
                        runtime,
                    } => {
                        assert_eq!(session_id, id);
                        identity |= runtime.reasoning_effort.as_deref() == Some("high");
                    }
                    BackendEvent::Accepted { session_id } => {
                        assert_eq!(session_id, id);
                        accepted = true;
                    }
                    BackendEvent::Swarm { session_id, agents } => {
                        assert_eq!(session_id, id);
                        assert_eq!(agents.len(), 1);
                        assert_eq!(agents[0].session_id, "child");
                        assert_eq!(agents[0].reasoning_effort.as_deref(), Some("xhigh"));
                        swarm = true;
                    }
                    _ => {}
                }
            }
        })
        .await;
        assert!(
            result.is_ok(),
            "native runtime, acceptance, and swarm must all reach the adapter"
        );
        // A file notification from an external client triggers a fresh
        // runtime read on this attachment; no detach or periodic query.
        catalog_changed.notify_one();
        let catalog = next_wire(&mut daemon).await;
        assert_eq!(catalog["type"], "get_model_catalog");
        write_frame(
            &mut writer,
            &json!({
                "type": "history", "id": catalog["id"], "session_id": id,
                "provider_name": "OpenAI", "provider_model": "gpt-5.4",
                "reasoning_effort": "xhigh",
            }),
            Instant::now() + Duration::from_secs(2),
        )
        .await
        .unwrap();
        let refreshed = timeout(Duration::from_secs(2), observed.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(refreshed, BackendEvent::Runtime { runtime, .. }
            if runtime.reasoning_effort.as_deref() == Some("xhigh")));
        drop(tx);
        assert!(job.await.unwrap().is_ok());
    }
}
