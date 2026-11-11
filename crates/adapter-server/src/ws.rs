use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use adapter_core::{CoreError, classify_backend_error};
use adapter_protocol::{
    DeviceInfo, Envelope, ErrorCode, ErrorPayload, PairRedeemRequest, PairRedeemResponse,
    WS_SUBPROTOCOL,
};
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

use crate::dispatch::handle_request;
use crate::events::{
    connection_envelope, operation_envelope, session_envelope, sessions_changed_envelope,
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
    Json(serde_json::json!({
        "ok": true,
        "server_id": state.store.server_id(),
        "adapter_version": crate::state::ADAPTER_VERSION,
        "protocol_version": adapter_protocol::PROTOCOL_VERSION,
        "jcode_connected": info.healthy,
        "jcode_server": if info.server.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(info.server) },
    }))
}

async fn pair(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(payload): Json<PairRedeemRequest>,
) -> Response {
    let key = peer.ip().to_string();
    if !state.pair_attempt_allowed(&key) {
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
        Ok((token, device)) => Json(PairRedeemResponse {
            token,
            device,
            server: state.server_info(),
        })
        .into_response(),
        Err(error) => {
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
    ws.protocols([WS_SUBPROTOCOL])
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
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    let host = uri.host().unwrap_or_default();
    matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]")
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(header::AUTHORIZATION) {
        if let Some(value) = value.to_str().ok() {
            if let Some(token) = value.strip_prefix("Bearer ") {
                let token = token.trim();
                if !token.is_empty() {
                    return Some(token.to_string());
                }
            }
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
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<Outbound>(state.config.event_queue.max(64));
    let writer = tokio::spawn(async move {
        while let Some(outbound) = out_rx.recv().await {
            match outbound {
                Outbound::Envelope(envelope) => {
                    let Ok(text) = serde_json::to_string(&envelope) else {
                        continue;
                    };
                    if sink.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Outbound::Close(code, reason) => {
                    let _ = sink
                        .send(Message::Close(Some(CloseFrame {
                            code,
                            reason: reason.into(),
                        })))
                        .await;
                    break;
                }
            }
        }
    });
    let conn = ConnContext {
        device: device.clone(),
        subscribed: Arc::new(Mutex::new(std::collections::HashSet::new())),
        outbound: out_tx.clone(),
    };
    let mut broadcast_rx = state.hub.subscribe();
    let mut revocation_rx = state.revocation.subscribe();
    let mut gap_announced = false;

    loop {
        tokio::select! {
            inbound = stream.next() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<Envelope>(text.as_str()) {
                            Ok(envelope) => {
                                let state_for_task = Arc::clone(&state);
                                let conn_for_task = conn.clone();
                                let outbound = out_tx.clone();
                                tokio::spawn(async move {
                                    let response = handle_request(state_for_task, conn_for_task, envelope).await;
                                    let _ = outbound.send(Outbound::Envelope(response)).await;
                                });
                            }
                            Err(error) => {
                                let response = error_envelope(
                                    "invalid-frame",
                                    &CoreError::InvalidInput(format!("invalid JSON envelope: {error}")),
                                );
                                let _ = out_tx.send(Outbound::Envelope(response)).await;
                            }
                        }
                    }
                    Some(Ok(Message::Binary(_))) => {
                        let response = error_envelope(
                            "invalid-frame",
                            &CoreError::InvalidInput("binary frames are not supported".into()),
                        );
                        let _ = out_tx.send(Outbound::Envelope(response)).await;
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
                match event {
                    Ok(Broadcast::Session(event)) => {
                        if conn.is_subscribed(&event.session_id) {
                            let envelope = session_envelope(&state, &event);
                            if out_tx.send(Outbound::Envelope(envelope)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Ok(Broadcast::Operation(operation)) => {
                        if conn.is_subscribed(&operation.session_id) {
                            let envelope = operation_envelope(&state, &operation);
                            if out_tx.send(Outbound::Envelope(envelope)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Ok(Broadcast::SessionsChanged) => {
                        let envelope = sessions_changed_envelope(&state);
                        if out_tx.send(Outbound::Envelope(envelope)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Broadcast::Connection { connected, message }) => {
                        let envelope = connection_envelope(&state, connected, message);
                        if out_tx.send(Outbound::Envelope(envelope)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        if !gap_announced {
                            gap_announced = true;
                            let sessions: Vec<String> = conn
                                .subscribed
                                .lock()
                                .expect("subscribed")
                                .iter()
                                .cloned()
                                .collect();
                            for session_id in sessions {
                                state.hub.publish(
                                    &session_id,
                                    None,
                                    None,
                                    adapter_protocol::SessionEvent::NeedsReconcile {
                                        reason: format!("stream_gap:{skipped}"),
                                    },
                                );
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            revoked = revocation_rx.recv() => {
                match revoked {
                    Ok(device_id) if device_id == device.device_id => {
                        let _ = out_tx
                            .send(Outbound::Close(1008, "device revoked".into()))
                            .await;
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
    info!(device = %device.device_id, connection = connection_id, "device disconnected");
    drop(conn);
    drop(out_tx);
    writer.abort();
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

    #[test]
    fn loopback_origins_are_allowed_and_remote_origins_are_not() {
        assert!(origin_allowed(&[], "http://127.0.0.1:5173"));
        assert!(origin_allowed(&[], "http://localhost:8091"));
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
