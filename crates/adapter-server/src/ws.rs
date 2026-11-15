use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use adapter_core::{CoreError, classify_backend_error};
use adapter_protocol::{
    BYTE_PACKAGE_CHUNK, BYTE_PACKAGE_LIMIT, DeviceInfo, Envelope, ErrorCode, ErrorPayload,
    JOURNAL_WS_SUBPROTOCOL, LEGACY_WS_SUBPROTOCOL, MIN_PROTOCOL_VERSION, PairRedeemRequest,
    PairRedeemResponse, WS_SUBPROTOCOL,
};
use axum::body::Bytes;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{Sink, SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{Semaphore, broadcast, mpsc};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

use crate::dispatch::handle_request;
use crate::events::{
    connection_envelope, encode_session, operation_envelope, session_update,
    sessions_changed_envelope,
};
use crate::hub::Broadcast;
use crate::state::{AppState, ConnContext, Outbound};

static CONNECTION_SEQ: AtomicU64 = AtomicU64::new(1);

pub fn router(state: Arc<AppState>) -> Router {
    let allowed_origins = state.config.allowed_origins.clone();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |origin, _parts| {
            origin
                .to_str()
                .map(|origin| origin_allowed(&allowed_origins, origin))
                .unwrap_or(false)
        }))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let mut router = Router::new()
        .route("/health", get(health))
        .route("/v2/pair", post(pair))
        .route("/v2/ws", get(ws_handler))
        .layer(cors)
        .with_state(Arc::clone(&state));

    if let Some(web_dir) = state.config.web_dir.clone() {
        let index = web_dir.join("index.html");
        router = router.fallback_service(ServeDir::new(web_dir).fallback(ServeFile::new(index)));
    } else {
        router = router.fallback(api_not_found);
    }
    router
}

async fn api_not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": {"code": "not_found", "message": "not found"}})),
    )
}

async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let info = state.backend.info();
    let journal = state.store.journal_stats().unwrap_or_default();
    Json(serde_json::json!({
        "ok": true,
        "server_id": state.store.server_id(),
        "adapter_version": crate::state::ADAPTER_VERSION,
        "protocol_version": adapter_protocol::PROTOCOL_VERSION,
        "min_protocol_version": adapter_protocol::MIN_PROTOCOL_VERSION,
        "epoch": state.hub.epoch(),
        "jcode_connected": info.healthy,
        "jcode_server": if info.server.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(info.server) },
        "journal_events": journal.events,
        "connections": state.metrics.active_connections.load(Ordering::Relaxed),
    }))
}

async fn pair(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(payload): Json<PairRedeemRequest>,
) -> Response {
    let key = peer.ip().to_string();
    if !state.pair_attempt_allowed(&key) {
        // Pairing failures used to be invisible in the log, which made "invalid
        // or expired" reports impossible to tell apart from a code that never
        // arrived. The submitted code itself is never logged.
        warn!(peer = %key, "pairing attempt rate limited");
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorPayload {
                code: ErrorCode::Unauthorized,
                message: "too many pairing attempts; try again shortly".into(),
                retryable: true,
            }),
        )
            .into_response();
    }
    match state.auth.redeem(&payload.code, &payload.device_name) {
        Ok((token, device)) => {
            info!(peer = %key, device = %device.device_id, name = %device.name, "pairing code redeemed");
            Json(PairRedeemResponse {
                token,
                device,
                server: state.server_info(),
            })
            .into_response()
        }
        Err(error) => {
            // `error` carries the store's own reason (unknown code, expired,
            // already used) and never contains the submitted code.
            warn!(peer = %key, error = %error, "pairing attempt rejected");
            let message = match error {
                CoreError::NotFound(_) | CoreError::Conflict(_) => {
                    "invalid or expired pairing code".to_string()
                }
                other => other.to_string(),
            };
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorPayload {
                    code: ErrorCode::Unauthorized,
                    message,
                    retryable: false,
                }),
            )
                .into_response()
        }
    }
}

async fn ws_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !origin_header_allowed(&state, &headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(ErrorPayload {
                code: ErrorCode::Forbidden,
                message: "origin is not allowed".into(),
                retryable: false,
            }),
        )
            .into_response();
    }
    let token = match extract_token(&headers) {
        Some(token) => token,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(ErrorPayload {
                    code: ErrorCode::Unauthorized,
                    message: "a paired device token is required".into(),
                    retryable: false,
                }),
            )
                .into_response();
        }
    };
    let device = match state.auth.authenticate(&token) {
        Ok(Some(device)) => device,
        Ok(None) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(ErrorPayload {
                    code: ErrorCode::Unauthorized,
                    message: "device token is invalid or revoked".into(),
                    retryable: false,
                }),
            )
                .into_response();
        }
        Err(error) => {
            warn!(%error, "device authentication failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorPayload {
                    code: ErrorCode::Internal,
                    message: "authentication is temporarily unavailable".into(),
                    retryable: true,
                }),
            )
                .into_response();
        }
    };
    // A v2 client offers `jcode.mobile.v2` and keeps working: the connection
    // negotiates v2 and every outbound frame is normalized to that version.
    ws.protocols([
        WS_SUBPROTOCOL,
        JOURNAL_WS_SUBPROTOCOL,
        LEGACY_WS_SUBPROTOCOL,
    ])
    .on_upgrade(move |socket| connection_loop(state, device, socket))
}

fn origin_header_allowed(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        // Non-browser clients (native Tauri/mobile, CLI) do not send Origin.
        return true;
    };
    origin
        .to_str()
        .map(|origin| origin_allowed(&state.config.allowed_origins, origin))
        .unwrap_or(false)
}

pub fn origin_allowed(configured: &[String], origin: &str) -> bool {
    if configured.iter().any(|allowed| allowed == origin) {
        return true;
    }
    // Tauri's embedded webviews use a private app origin. These are not
    // reachable as ordinary web pages, but the adapter must accept them or a
    // native desktop/mobile shell can never open its authenticated socket.
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return true;
    }
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    let host = uri.host().unwrap_or_default();
    matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]")
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(header::AUTHORIZATION)
        && let Ok(value) = value.to_str()
        && let Some(token) = value.strip_prefix("Bearer ")
    {
        let token = token.trim();
        if !token.is_empty() {
            return Some(token.to_string());
        }
    }
    let protocols = headers.get("sec-websocket-protocol")?.to_str().ok()?;
    protocols.split(',').find_map(|protocol| {
        protocol
            .trim()
            .strip_prefix(adapter_protocol::TOKEN_SUBPROTOCOL_PREFIX)
            .map(str::to_string)
    })
}

async fn connection_loop(state: Arc<AppState>, device: DeviceInfo, socket: WebSocket) {
    let connection_id = CONNECTION_SEQ.fetch_add(1, Ordering::Relaxed);
    info!(device = %device.device_id, connection = connection_id, "device connected");
    state
        .metrics
        .active_connections
        .fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<Outbound>(64);
    let protocol_version = Arc::new(AtomicU32::new(MIN_PROTOCOL_VERSION));
    let writer_version = Arc::clone(&protocol_version);
    let writer_state = Arc::clone(&state);
    let mut writer = tokio::spawn(async move {
        while let Some(outbound) = out_rx.recv().await {
            let version = writer_version.load(Ordering::Relaxed);
            let encoded = match outbound {
                Outbound::Envelope(mut envelope) => {
                    envelope.v = version;
                    serde_json::to_string(&envelope)
                }
                Outbound::Session(event) => encode_session(&writer_state, &event, version),
                Outbound::Close(code, reason) => {
                    let _ = sink
                        .send(Message::Close(Some(CloseFrame {
                            code,
                            reason: reason.into(),
                        })))
                        .await;
                    break;
                }
            };
            let Ok(encoded) = encoded else { break };
            writer_state
                .metrics
                .frames_out
                .fetch_add(1, Ordering::Relaxed);
            let sent = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                send_encoded(&mut sink, version, encoded),
            )
            .await;
            if !matches!(sent, Ok(Ok(()))) {
                break;
            }
        }
    });
    let conn = ConnContext {
        device: device.clone(),
        subscribed: Arc::new(Mutex::new(std::collections::HashSet::new())),
        outbound: out_tx.clone(),
        protocol_version: Arc::clone(&protocol_version),
    };
    let mut broadcast_rx = state.hub.subscribe();
    let mut revocation_rx = state.revocation.subscribe();
    let request_slots = Arc::new(Semaphore::new(16));
    let mut closing = false;

    loop {
        tokio::select! {
            _ = &mut writer => break,
            inbound = stream.next() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        state.metrics.frames_in.fetch_add(1, Ordering::Relaxed);
                        match serde_json::from_str::<Envelope>(text.as_str()) {
                            Ok(envelope) => {
                                let Ok(permit) = Arc::clone(&request_slots).try_acquire_owned() else {
                                    let response = error_envelope(
                                        &envelope.id,
                                        &CoreError::BackendUnavailable("too many pending mobile requests".into()),
                                    );
                                    if out_tx.try_send(Outbound::Envelope(response)).is_err() { break; }
                                    continue;
                                };
                                let state_for_task = Arc::clone(&state);
                                let conn_for_task = conn.clone();
                                let outbound = out_tx.clone();
                                tokio::spawn(async move {
                                    let _permit = permit;
                                    let mut response = handle_request(
                                        state_for_task,
                                        conn_for_task.clone(),
                                        envelope,
                                    )
                                    .await;
                                    response.v = conn_for_task.protocol_version();
                                    let _ = outbound.send(Outbound::Envelope(response)).await;
                                });
                            }
                            Err(error) => {
                                let mut response = error_envelope(
                                    "invalid-frame",
                                    &CoreError::InvalidInput(format!("invalid JSON envelope: {error}")),
                                );
                                response.v = conn.protocol_version();
                                if out_tx.try_send(Outbound::Envelope(response)).is_err() { break; }
                            }
                        }
                    }
                    Some(Ok(Message::Binary(_))) => {
                        let mut response = error_envelope(
                            "invalid-frame",
                            &CoreError::InvalidInput("binary frames are not supported".into()),
                        );
                        response.v = conn.protocol_version();
                        if out_tx.try_send(Outbound::Envelope(response)).is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                    Some(Err(error)) => {
                        warn!(%error, connection = connection_id, "websocket read error");
                        break;
                    }
                }
            }
            event = broadcast_rx.recv() => {
                let outbound = match event {
                    Ok(Broadcast::Session(event)) if conn.is_subscribed(&event.session_id) => {
                        Outbound::Session(event)
                    }
                    Ok(Broadcast::Operation(operation)) if conn.is_subscribed(&operation.session_id) => {
                        Outbound::Envelope(operation_envelope(&state, &operation))
                    }
                    Ok(Broadcast::Runtime { session_id, runtime, at_ms })
                        if conn.protocol_version() >= 4 && conn.is_subscribed(&session_id) =>
                    {
                        Outbound::Envelope(session_update(&state, session_id, "session.runtime",
                            serde_json::json!({"runtime": runtime.as_ref(), "observed_at_ms": at_ms})))
                    }
                    Ok(Broadcast::Swarm { session_id, agents })
                        if conn.protocol_version() >= 4 && conn.is_subscribed(&session_id) =>
                    {
                        Outbound::Envelope(session_update(&state, session_id, "session.swarm",
                            serde_json::json!({"agents": agents.as_ref()})))
                    }
                    Ok(Broadcast::SessionsChanged) => {
                        Outbound::Envelope(sessions_changed_envelope(&state))
                    }
                    Ok(Broadcast::Connection { connected, message }) => {
                        Outbound::Envelope(connection_envelope(&state, connected, message))
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // Only this socket fell behind. Reconnect and replay from
                        // its cursor without polluting the shared journal.
                        state.metrics.gaps_announced.fetch_add(1, Ordering::Relaxed);
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    _ => continue,
                };
                if out_tx.try_send(outbound).is_err() {
                    state.metrics.gaps_announced.fetch_add(1, Ordering::Relaxed);
                    break;
                }
            }
            revoked = revocation_rx.recv() => {
                match revoked {
                    Ok(device_id) if device_id == device.device_id => {
                        closing = out_tx.try_send(Outbound::Close(1008, "device revoked".into())).is_ok();
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
    info!(device = %device.device_id, connection = connection_id, "device disconnected");
    state
        .metrics
        .active_connections
        .fetch_sub(1, Ordering::Relaxed);
    let subscriptions = conn.subscribed.lock().expect("subscribed").len() as u64;
    if subscriptions > 0 {
        state
            .metrics
            .subscriptions
            .fetch_sub(subscriptions, Ordering::Relaxed);
    }
    drop(conn);
    drop(out_tx);
    if closing {
        let _ = tokio::time::timeout(std::time::Duration::from_millis(250), &mut writer).await;
    }
    writer.abort();
}

/// A descriptor and its raw byte chunks are written by the same socket
/// writer. Bytes slices share the JSON allocation and may split a UTF-8 code
/// point. The client decodes only after the declared size has arrived.
async fn send_encoded<S>(sink: &mut S, version: u32, text: String) -> Result<(), S::Error>
where
    S: Sink<Message> + Unpin,
{
    if version < 4 || text.len() <= BYTE_PACKAGE_CHUNK {
        return sink.send(Message::Text(text.into())).await;
    }
    if text.len() > BYTE_PACKAGE_LIMIT {
        return sink
            .send(Message::Close(Some(CloseFrame {
                code: 1009,
                reason: "the adapter response is too large".into(),
            })))
            .await;
    }
    let mut bytes = Bytes::from(text.into_bytes());
    sink.send(Message::Text(
        format!(
            r#"{{"v":4,"kind":"event","type":"transport.bytes","payload":{{"length":{}}}}}"#,
            bytes.len()
        )
        .into(),
    ))
    .await?;
    while !bytes.is_empty() {
        let chunk = bytes.split_to(bytes.len().min(BYTE_PACKAGE_CHUNK));
        sink.send(Message::Binary(chunk)).await?;
    }
    Ok(())
}

pub fn error_envelope(reply_to: &str, error: &CoreError) -> Envelope {
    let (code, retryable) = match error {
        CoreError::Message(message) if message.eq_ignore_ascii_case("unauthorized") => {
            (ErrorCode::Unauthorized, false)
        }
        CoreError::Message(message) if message.contains("protocol") => {
            (ErrorCode::UnsupportedVersion, false)
        }
        CoreError::Message(_) => (ErrorCode::Internal, false),
        CoreError::Database(_) | CoreError::Io(_) => (ErrorCode::Internal, true),
        CoreError::InvalidPath(_) | CoreError::InvalidInput(_) => (ErrorCode::BadRequest, false),
        CoreError::PathEscape => (ErrorCode::Forbidden, false),
        CoreError::InvalidTransition { .. } | CoreError::Conflict(_) => {
            (ErrorCode::Conflict, false)
        }
        CoreError::NotFound(_) => (ErrorCode::NotFound, false),
        CoreError::BackendUnavailable(_) => (ErrorCode::ProviderUnavailable, true),
        CoreError::BackendRejected(message) => match classify_backend_error(message) {
            adapter_core::BackendErrorKind::NotFound => (ErrorCode::NotFound, false),
            adapter_core::BackendErrorKind::ModelUnavailable => {
                (ErrorCode::ModelUnavailable, false)
            }
            adapter_core::BackendErrorKind::AccountMissing => (ErrorCode::AccountMissing, false),
            adapter_core::BackendErrorKind::Forbidden => (ErrorCode::Forbidden, false),
            adapter_core::BackendErrorKind::NotSupported => (ErrorCode::NotSupported, false),
            adapter_core::BackendErrorKind::Backend => (ErrorCode::Internal, true),
        },
    };
    Envelope::error(reply_to, code, error.to_string()).with_retryable(retryable)
}

trait EnvelopeRetry {
    fn with_retryable(self, retryable: bool) -> Self;
}

impl EnvelopeRetry for Envelope {
    fn with_retryable(mut self, retryable: bool) -> Self {
        if let Ok(mut payload) = serde_json::from_value::<ErrorPayload>(self.payload.clone()) {
            payload.retryable = retryable;
            self.payload = serde_json::to_value(payload).unwrap_or_default();
        }
        self
    }
}

pub async fn serve(
    listener: TcpListener,
    state: Arc<AppState>,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[tokio::test]
    async fn byte_packages_preserve_utf8_and_keep_legacy_text_frames() {
        let text = format!("{}İstanbul 🪶", "a".repeat(BYTE_PACKAGE_CHUNK - 1));
        for version in [3, 4] {
            let mut frames = Vec::new();
            let mut sink = Box::pin(futures_util::sink::unfold(
                &mut frames,
                |frames, frame| async move {
                    frames.push(frame);
                    Ok::<_, std::convert::Infallible>(frames)
                },
            ));
            send_encoded(&mut sink, version, text.clone())
                .await
                .unwrap();
            drop(sink);
            if version == 3 {
                assert_eq!(frames, [Message::Text(text.clone().into())]);
            } else {
                let Message::Text(descriptor) = &frames[0] else {
                    panic!("missing descriptor")
                };
                let descriptor: serde_json::Value =
                    serde_json::from_str(descriptor.as_str()).unwrap();
                assert_eq!(descriptor["type"], "transport.bytes");
                assert_eq!(descriptor["payload"]["length"], text.len());
                let mut bytes = Vec::new();
                for frame in &frames[1..] {
                    let Message::Binary(chunk) = frame else {
                        panic!("expected binary chunk")
                    };
                    assert!(chunk.len() <= BYTE_PACKAGE_CHUNK);
                    bytes.extend_from_slice(chunk);
                }
                assert_eq!(String::from_utf8(bytes).unwrap(), text);
            }
        }
    }

    #[test]
    fn loopback_origins_are_allowed_and_remote_origins_are_not() {
        assert!(origin_allowed(&[], "http://127.0.0.1:5173"));
        assert!(origin_allowed(&[], "http://localhost:8091"));
        assert!(origin_allowed(&[], "tauri://localhost"));
        assert!(origin_allowed(&[], "http://tauri.localhost"));
        assert!(!origin_allowed(&[], "https://example.com"));
        assert!(origin_allowed(
            &["https://stillness.example".into()],
            "https://stillness.example"
        ));
    }

    #[test]
    fn token_can_come_from_bearer_or_subprotocol() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer abc123"),
        );
        assert_eq!(extract_token(&headers).as_deref(), Some("abc123"));
        let mut headers = HeaderMap::new();
        headers.insert(
            "sec-websocket-protocol",
            HeaderValue::from_static("jcode.mobile.v2, token.xyz"),
        );
        assert_eq!(extract_token(&headers).as_deref(), Some("xyz"));
    }
}
