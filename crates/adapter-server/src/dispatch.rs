use std::path::PathBuf;

use adapter_core::{BackendEvent, BackendSession, CoreError, CoreResult, now_ms};
use adapter_protocol::*;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::state::{AppState, ConnContext};
use crate::ws::error_envelope;

pub async fn blocking<T, F>(f: F) -> CoreResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CoreResult<T> + Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(result) => result,
        Err(error) => Err(CoreError::Message(format!(
            "blocking worker failed: {error}"
        ))),
    }
}

fn decode<T: DeserializeOwned>(value: &Value) -> CoreResult<T> {
    serde_json::from_value(value.clone())
        .map_err(|error| CoreError::InvalidInput(error.to_string()))
}

fn ok(state: &AppState, request: &Envelope, msg_type: &str, payload: Value) -> Envelope {
    let mut envelope = Envelope::response(request.id.clone(), msg_type, payload);
    envelope.server_id = Some(state.store.server_id().to_string());
    envelope.session_id = request.session_id.clone();
    envelope.operation_id = request.operation_id.clone();
    envelope
}

fn error_response(state: &AppState, request: &Envelope, error: CoreError) -> Envelope {
    let mut envelope = error_envelope(&request.id, &error);
    envelope.server_id = Some(state.store.server_id().to_string());
    envelope.session_id = request.session_id.clone();
    envelope.operation_id = request.operation_id.clone();
    envelope
}

async fn list_backend_sessions(state: &AppState) -> CoreResult<Vec<BackendSession>> {
    let backend = std::sync::Arc::clone(&state.backend);
    blocking(move || backend.list_sessions()).await
}

async fn list_summaries(state: &AppState) -> CoreResult<Vec<SessionSummary>> {
    let sessions = list_backend_sessions(state).await?;
    let mut summaries = Vec::with_capacity(sessions.len());
    for session in sessions {
        summaries.push(state.summary(session)?);
    }
    summaries.sort_by(|a, b| {
        b.updated_at_ms
            .unwrap_or_default()
            .cmp(&a.updated_at_ms.unwrap_or_default())
    });
    Ok(summaries)
}

async fn find_summary(state: &AppState, session_id: &str) -> CoreResult<SessionSummary> {
    list_summaries(state)
        .await?
        .into_iter()
        .find(|session| session.session_id == session_id)
        .ok_or_else(|| CoreError::NotFound(format!("session {session_id}")))
}

fn resolve_working_directory(
    state: &AppState,
    project_id: Option<&str>,
    working_dir: Option<&str>,
) -> CoreResult<(PathBuf, Option<String>)> {
    if let Some(project_id) = project_id {
        let (root, project) = state.project_root(project_id)?;
        return Ok((root, Some(project.project_id)));
    }
    let candidate = match working_dir {
        Some(value) if !value.trim().is_empty() => {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                state
                    .config
                    .session_create_default_dir
                    .clone()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(path)
            }
        }
        _ => state
            .config
            .session_create_default_dir
            .clone()
            .ok_or_else(|| {
                CoreError::InvalidInput("no default working directory configured".into())
            })?,
    };
    let canonical = state.roots.canonical_project_root(&candidate)?;
    Ok((canonical, None))
}

pub async fn handle_request(
    state: std::sync::Arc<AppState>,
    conn: ConnContext,
    request: Envelope,
) -> Envelope {
    if let Err(error) = request.validate() {
        return error_response(&state, &request, CoreError::InvalidInput(error.to_string()));
    }
    if request.kind != Kind::Request {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput("only request envelopes are accepted".into()),
        );
    }
    match request.msg_type.as_str() {
        "client.hello" => match decode::<ClientHello>(&request.payload) {
            Ok(hello) => {
                if hello.max_version < MIN_PROTOCOL_VERSION || hello.min_version > PROTOCOL_VERSION
                {
                    return error_response(
                        &state,
                        &request,
                        CoreError::Message(format!(
                            "client supports protocol {}..{}, adapter requires {}",
                            hello.min_version, hello.max_version, PROTOCOL_VERSION
                        )),
                    );
                }
                ok(
                    &state,
                    &request,
                    "server.hello",
                    serde_json::to_value(ServerHelloPayload {
                        server: state.server_info(),
                        device: conn.device.clone(),
                        resumed: false,
                    })
                    .unwrap_or_default(),
                )
            }
            Err(error) => error_response(&state, &request, error),
        },
        "server.status" => ok(
            &state,
            &request,
            "server.status",
            serde_json::to_value(state.server_status()).unwrap_or_default(),
        ),
        "server.ping" => ok(&state, &request, "server.pong", json!({"at_ms": now_ms()})),

        // ----------------------------------------------------------------
        // Sessions
        // ----------------------------------------------------------------
        "sessions.list" => match list_summaries(&state).await {
            Ok(sessions) => match state.store.list_projects() {
                Ok(projects) => ok(
                    &state,
                    &request,
                    "sessions.list",
                    serde_json::to_value(SessionsListPayload {
                        sessions,
                        projects,
                        source: "jcode.list_sessions".into(),
                        observed_at_ms: now_ms(),
                        stale: false,
                    })
                    .unwrap_or_default(),
                ),
                Err(error) => error_response(&state, &request, error),
            },
            Err(error) => error_response(&state, &request, error),
        },
        "sessions.create" => handle_create_session(state, request).await,
        "sessions.subscribe" => handle_subscribe(state, conn, request).await,
        "sessions.snapshot" => handle_snapshot(state, conn, request).await,
        "sessions.peek" => handle_peek(state, request).await,
        "sessions.history" => handle_history(state, request).await,
        "sessions.rename" => handle_rename(state, request).await,

        // ----------------------------------------------------------------
        // Operations
        // ----------------------------------------------------------------
        "operations.reserve" => handle_reserve(state, request).await,
        "operations.dispatch" => handle_dispatch(state, request).await,
        "operations.lookup" => match decode::<OperationLookupRequest>(&request.payload) {
            Ok(payload) => match state.store.operation(&payload.operation_id) {
                Ok(Some(operation)) => ok(
                    &state,
                    &request,
                    "operations.state",
                    serde_json::to_value(OperationStatePayload {
                        operation,
                        duplicate: false,
                    })
                    .unwrap_or_default(),
                ),
                Ok(None) => {
                    error_response(&state, &request, CoreError::NotFound(payload.operation_id))
                }
                Err(error) => error_response(&state, &request, error),
            },
            Err(error) => error_response(&state, &request, error),
        },
        "operations.cancel" => handle_cancel(state, request).await,

        // ----------------------------------------------------------------
        // Models, runtime, context, plan, activity
        // ----------------------------------------------------------------
        "models.list" => handle_models(state, request).await,
        "models.set" => handle_set_model(state, request).await,
        "reasoning.set" => handle_set_reasoning(state, request).await,
        "context.snapshot" => handle_context(state, request).await,
        "plan.snapshot" => handle_plan(state, request).await,
        "activity.snapshot" => handle_activity(state, request).await,
        "tool.permission_response" => handle_permission(state, request).await,

        // ----------------------------------------------------------------
        // Projects and files
        // ----------------------------------------------------------------
        "projects.list" => match state.store.list_projects() {
            Ok(projects) => ok(
                &state,
                &request,
                "projects.list",
                json!({"projects": projects, "source": "adapter.sqlite", "observed_at_ms": now_ms()}),
            ),
            Err(error) => error_response(&state, &request, error),
        },
        "projects.create" => handle_create_project(state, request).await,
        "files.list_dir" => handle_list_dir(state, request).await,
        "files.read_preview" => handle_read_preview(state, request).await,
        "folders.create" => handle_create_folder(state, request).await,

        // ----------------------------------------------------------------
        // Devices
        // ----------------------------------------------------------------
        "device.list" => match state.auth.devices() {
            Ok(devices) => ok(&state, &request, "device.list", json!({"devices": devices})),
            Err(error) => error_response(&state, &request, error),
        },
        "device.revoke" => handle_revoke(state, request).await,

        other => error_response(
            &state,
            &request,
            CoreError::InvalidInput(format!("unknown request type: {other}")),
        ),
    }
}

async fn handle_create_session(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: CreateSessionRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    if payload.client_request_id.trim().is_empty() {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput("client_request_id is required".into()),
        );
    }
    let _guard = state.create_lock.lock().await;
    if let Ok(Some(session_id)) = state
        .store
        .session_for_create_request(&payload.client_request_id)
    {
        return match find_summary(&state, &session_id).await {
            Ok(session) => ok(
                &state,
                &request,
                "sessions.create",
                serde_json::to_value(CreateSessionResponse {
                    session,
                    created: false,
                })
                .unwrap_or_default(),
            ),
            Err(error) => error_response(&state, &request, error),
        };
    }
    let (working_dir, project_id) = match resolve_working_directory(
        &state,
        payload.project_id.as_deref(),
        payload.working_dir.as_deref(),
    ) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let working_dir_string = working_dir.to_string_lossy().to_string();
    let backend = std::sync::Arc::clone(&state.backend);
    let working_dir_for_backend = working_dir_string.clone();
    let created =
        match blocking(move || backend.create_session(Some(&working_dir_for_backend))).await {
            Ok(session) => session,
            Err(error) => return error_response(&state, &request, error),
        };
    let session_id = created.session_id.clone();
    if let Err(error) = state
        .store
        .record_session_create(&payload.client_request_id, &session_id)
    {
        return error_response(&state, &request, error);
    }
    if let Some(project_id) = project_id.as_ref() {
        let _ = state.store.set_session_project(&session_id, project_id);
    }
    let mut title_persisted = false;
    if let Some(title) = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        let backend = std::sync::Arc::clone(&state.backend);
        let id = session_id.clone();
        let title_owned = title.chars().take(200).collect::<String>();
        let renamed = blocking(move || backend.rename_session(&id, Some(&title_owned))).await;
        if renamed.is_ok() {
            let _ = state.store.set_session_title(&session_id, title);
            title_persisted = true;
        }
    }
    let mut summary = match state.summary(created) {
        Ok(summary) => summary,
        Err(error) => return error_response(&state, &request, error),
    };
    if title_persisted {
        summary.title = payload.title.clone();
        summary.title_source = "adapter_rename".into();
    }
    state.hub.sessions_changed();
    ok(
        &state,
        &request,
        "sessions.create",
        serde_json::to_value(CreateSessionResponse {
            session: summary,
            created: true,
        })
        .unwrap_or_default(),
    )
}

async fn build_snapshot(
    state: &std::sync::Arc<AppState>,
    session_id: &str,
    tail: u32,
) -> CoreResult<SessionSnapshotPayload> {
    let seq_before = state.hub.current_seq(session_id);
    let backend = std::sync::Arc::clone(&state.backend);
    let id = session_id.to_string();
    let (session, messages, runtime, plan) = blocking(move || {
        let sessions = backend.list_sessions()?;
        let session = sessions
            .into_iter()
            .find(|session| session.session_id == id)
            .ok_or_else(|| CoreError::NotFound(format!("session {id}")))?;
        let messages = backend.history(&id, Some(tail.clamp(1, 500)))?;
        let runtime = backend.runtime(&id).ok();
        let plan = backend.plan(&id).ok().flatten();
        Ok((session, messages, runtime, plan))
    })
    .await?;
    let summary = state.summary(session)?;
    let seq_after = state.hub.current_seq(session_id);
    let stale = seq_after != seq_before;
    let mut context = state.usage(session_id);
    if let Some(runtime) = runtime.as_ref() {
        let mut view = runtime.view(now_ms());
        if let Some(context) = context.as_mut() {
            context.provider = view.provider.take();
            context.model = view.model.take();
        }
        state.set_command_code_available(
            view.routes
                .iter()
                .any(|route| route.provider.eq_ignore_ascii_case("command-code")),
        );
        let _ = view;
    }
    // Promote an operation to ObservedInHistory only on real transcript
    // evidence, never on a timer or a socket write.
    if let Ok(Some(operation)) = state.store.pending_operation_for_session(session_id) {
        if matches!(
            operation.state,
            OperationState::Accepted | OperationState::Unknown
        ) {
            if let Ok(Some((body, _))) = state.store.operation_body(&operation.operation_id) {
                let found = messages
                    .iter()
                    .any(|message| message.role == "user" && message.content == body);
                if found {
                    if let Ok(updated) = state.store.transition_operation(
                        &operation.operation_id,
                        operation.state,
                        OperationState::ObservedInHistory,
                        None,
                        None,
                    ) {
                        state.hub.publish_operation(updated);
                    }
                }
            }
        }
    }
    Ok(SessionSnapshotPayload {
        session: summary,
        messages,
        runtime: runtime.map(|runtime| runtime.view(now_ms())),
        plan,
        context,
        epoch: state.hub.epoch().to_string(),
        last_seq: seq_after,
        revision: seq_after,
        authoritative_at_ms: now_ms(),
        stale,
        source: "jcode.history".into(),
    })
}

async fn handle_subscribe(
    state: std::sync::Arc<AppState>,
    conn: ConnContext,
    request: Envelope,
) -> Envelope {
    let payload: SessionsSubscribeRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    conn.subscribe(&payload.session_id);
    let (_, gap) = state
        .hub
        .replay_after(&payload.session_id, payload.after_seq.unwrap_or(0));
    match build_snapshot(&state, &payload.session_id, payload.tail).await {
        Ok(mut snapshot) => {
            if gap {
                snapshot.stale = true;
            }
            ok(
                &state,
                &request,
                "sessions.snapshot",
                serde_json::to_value(snapshot).unwrap_or_default(),
            )
        }
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_snapshot(
    state: std::sync::Arc<AppState>,
    _conn: ConnContext,
    request: Envelope,
) -> Envelope {
    let payload: SessionsSubscribeRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    match build_snapshot(&state, &payload.session_id, payload.tail).await {
        Ok(snapshot) => ok(
            &state,
            &request,
            "sessions.snapshot",
            serde_json::to_value(snapshot).unwrap_or_default(),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_peek(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SessionsSubscribeRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let summary = match find_summary(&state, &payload.session_id).await {
        Ok(summary) => summary,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let id = payload.session_id.clone();
    let tail = payload.tail;
    match blocking(move || backend.history(&id, Some(tail))).await {
        Ok(messages) => ok(
            &state,
            &request,
            "sessions.peek",
            json!({"session": summary, "messages": messages, "source": "jcode.peek_session", "observed_at_ms": now_ms()}),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_history(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SessionsSubscribeRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let id = payload.session_id.clone();
    let tail = payload.tail;
    match blocking(move || backend.history(&id, Some(tail))).await {
        Ok(messages) => ok(
            &state,
            &request,
            "sessions.history",
            json!({
                "session_id": payload.session_id,
                "messages": messages,
                "source": "jcode.peek_session",
                "observed_at_ms": now_ms()
            }),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_rename(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: RenameSessionRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let trimmed = payload.title.trim();
    if trimmed.chars().count() > 200 {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput("title is too long".into()),
        );
    }
    let backend = std::sync::Arc::clone(&state.backend);
    let id = payload.session_id.clone();
    let title = (!trimmed.is_empty()).then(|| trimmed.to_string());
    let title_for_backend = title.clone();
    match blocking(move || backend.rename_session(&id, title_for_backend.as_deref())).await {
        Ok(()) => {
            if let Some(title) = title.as_deref() {
                let _ = state.store.set_session_title(&payload.session_id, title);
            } else {
                let _ = state.store.clear_session_title(&payload.session_id);
            }
            let display = find_summary(&state, &payload.session_id)
                .await
                .ok()
                .and_then(|summary| summary.title)
                .unwrap_or_default();
            state.hub.publish(
                &payload.session_id,
                None,
                None,
                SessionEvent::TitleChanged {
                    title: title.clone(),
                    display_title: display,
                },
            );
            state.hub.sessions_changed();
            match find_summary(&state, &payload.session_id).await {
                Ok(session) => ok(
                    &state,
                    &request,
                    "sessions.rename",
                    json!({"session": session}),
                ),
                Err(error) => error_response(&state, &request, error),
            }
        }
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_reserve(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: OperationReserveRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    if payload.body.trim().is_empty() {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput("prompt is empty".into()),
        );
    }
    if payload.body.len() > 256 * 1024 {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput("prompt exceeds the 256 KiB limit".into()),
        );
    }
    if let Some(active) = state.turns.active(&payload.session_id) {
        if !payload
            .expected_turn_id
            .as_deref()
            .map(|expected| expected == active.turn_id)
            .unwrap_or(false)
        {
            return error_response(
                &state,
                &request,
                CoreError::Conflict(format!(
                    "a turn is already active for this session: {}",
                    active.turn_id
                )),
            );
        }
    }
    match state.store.reserve_operation(
        &payload.operation_id,
        &payload.session_id,
        &payload.kind,
        &payload.body,
        payload.expected_turn_id.as_deref(),
    ) {
        Ok((operation, duplicate)) => ok(
            &state,
            &request,
            "operations.reserve",
            serde_json::to_value(OperationStatePayload {
                operation,
                duplicate,
            })
            .unwrap_or_default(),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_dispatch(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: OperationDispatchRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let operation = match state.store.operation(&payload.operation_id) {
        Ok(Some(operation)) => operation,
        Ok(None) => {
            return error_response(&state, &request, CoreError::NotFound(payload.operation_id));
        }
        Err(error) => return error_response(&state, &request, error),
    };
    if operation.state != OperationState::Staged && operation.state != OperationState::Reserved {
        if operation.state == OperationState::Dispatching {
            // A duplicate dispatch after a lost response must not write twice.
            return ok(
                &state,
                &request,
                "operations.dispatch",
                serde_json::to_value(OperationStatePayload {
                    operation,
                    duplicate: true,
                })
                .unwrap_or_default(),
            );
        }
        return ok(
            &state,
            &request,
            "operations.dispatch",
            serde_json::to_value(OperationStatePayload {
                operation,
                duplicate: true,
            })
            .unwrap_or_default(),
        );
    }
    if let Some(active) = state.turns.active(&operation.session_id) {
        if active.operation_id != operation.operation_id {
            return error_response(
                &state,
                &request,
                CoreError::Conflict("another turn is active for this session".into()),
            );
        }
    }
    let mut operation = operation;
    if operation.state == OperationState::Staged {
        match state.store.transition_operation(
            &operation.operation_id,
            OperationState::Staged,
            OperationState::Reserved,
            None,
            None,
        ) {
            Ok(updated) => operation = updated,
            Err(error) => return error_response(&state, &request, error),
        }
    }
    let turn_id = state
        .turns
        .begin(&operation.session_id, &operation.operation_id);
    match state.store.transition_operation(
        &operation.operation_id,
        OperationState::Reserved,
        OperationState::Dispatching,
        None,
        Some(&turn_id),
    ) {
        Ok(updated) => operation = updated,
        Err(error) => return error_response(&state, &request, error),
    }
    let published = state.hub.publish(
        &operation.session_id,
        Some(turn_id.clone()),
        Some(operation.operation_id.clone()),
        SessionEvent::TurnStarted {
            turn_id: turn_id.clone(),
            operation_id: operation.operation_id.clone(),
        },
    );
    state.record_activity(
        &operation.session_id,
        published.turn_id.as_deref(),
        &published.event,
    );
    state.hub.publish_operation(operation.clone());
    let body = match state.store.operation_body(&operation.operation_id) {
        Ok(Some((body, _))) => body,
        Ok(None) => String::new(),
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = operation.session_id.clone();
    let send_result = blocking(move || backend.send(&session_id, &body)).await;
    match send_result {
        Ok(()) => {
            schedule_acceptance_timeout(
                std::sync::Arc::clone(&state),
                operation.session_id.clone(),
                operation.operation_id.clone(),
            );
            ok(
                &state,
                &request,
                "operations.dispatch",
                serde_json::to_value(OperationStatePayload {
                    operation,
                    duplicate: false,
                })
                .unwrap_or_default(),
            )
        }
        Err(error) => {
            let message = error.to_string();
            let updated = state.store.transition_operation(
                &operation.operation_id,
                OperationState::Dispatching,
                OperationState::Rejected,
                Some(("dispatch_failed", &message)),
                Some(&turn_id),
            );
            state.turns.finish(&operation.session_id);
            if let Ok(updated) = updated {
                state.hub.publish_operation(updated);
            }
            state.hub.publish(
                &operation.session_id,
                Some(turn_id.clone()),
                Some(operation.operation_id.clone()),
                SessionEvent::TurnStopped {
                    turn_id: Some(turn_id),
                    reason: "dispatch_failed".into(),
                    message: message.clone(),
                    provider_stop_reason: None,
                },
            );
            error_response(&state, &request, CoreError::BackendRejected(message))
        }
    }
}

fn schedule_acceptance_timeout(
    state: std::sync::Arc<AppState>,
    session_id: String,
    operation_id: String,
) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let operation = match state.store.operation(&operation_id) {
            Ok(Some(operation)) => operation,
            _ => return,
        };
        if operation.state != OperationState::Dispatching {
            return;
        }
        if let Ok(updated) = state.store.transition_operation(
            &operation_id,
            OperationState::Dispatching,
            OperationState::Unknown,
            Some((
                "delivery_unconfirmed",
                "the daemon did not acknowledge the message in time",
            )),
            None,
        ) {
            state.hub.publish_operation(updated);
            state.hub.publish(
                &session_id,
                operation.turn_id.clone(),
                Some(operation_id),
                SessionEvent::NeedsReconcile {
                    reason: "delivery_unconfirmed".into(),
                },
            );
        }
    });
}

async fn handle_cancel(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: CancelTurnRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let Some(active) = state.turns.active(&payload.session_id) else {
        return error_response(
            &state,
            &request,
            CoreError::Conflict("no active turn to stop".into()),
        );
    };
    let matches_turn = payload
        .expected_turn_id
        .as_deref()
        .map(|expected| expected == active.turn_id)
        .unwrap_or(false);
    let matches_operation = payload
        .operation_id
        .as_deref()
        .map(|expected| expected == active.operation_id)
        .unwrap_or(false);
    if !matches_turn && !matches_operation {
        return error_response(
            &state,
            &request,
            CoreError::Conflict(format!(
                "stop did not target the active turn {}",
                active.turn_id
            )),
        );
    }
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    match blocking(move || backend.cancel(&session_id)).await {
        Ok(()) => ok(
            &state,
            &request,
            "operations.cancel",
            serde_json::to_value(CancelTurnResponse {
                cancelled: true,
                turn_id: Some(active.turn_id.clone()),
                atomic_turn_scope: false,
                note: "Upstream cancel is session-scoped; the adapter verified the expected turn before issuing it."
                    .into(),
            })
            .unwrap_or_default(),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_models(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SessionRef = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let runtime = match blocking(move || backend.runtime(&session_id)).await {
        Ok(runtime) => runtime,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let models = blocking(move || backend.list_models(&session_id))
        .await
        .ok();
    state.set_command_code_available(
        runtime
            .providers
            .iter()
            .any(|provider| provider.eq_ignore_ascii_case("command-code")),
    );
    ok(
        &state,
        &request,
        "models.list",
        serde_json::to_value(models_payload(runtime, models)).unwrap_or_default(),
    )
}

fn models_payload(
    runtime: adapter_core::BackendRuntime,
    models: Option<(Vec<String>, Option<String>)>,
) -> ModelsListPayload {
    let observed = now_ms();
    let mut routes: Vec<ModelRouteView> = runtime
        .routes
        .iter()
        .map(|route| ModelRouteView {
            model: route.model.clone(),
            provider: route.provider.clone(),
            api_method: route.api_method.clone(),
            available: route.available,
            detail: route.detail.clone(),
            is_command_code: route.provider.eq_ignore_ascii_case("command-code"),
        })
        .collect();
    if let Some((ids, _current)) = models {
        for id in ids {
            if !routes.iter().any(|route| route.model == id) {
                routes.push(ModelRouteView {
                    model: id,
                    provider: runtime.provider.clone().unwrap_or_else(|| "unknown".into()),
                    api_method: "unknown".into(),
                    available: false,
                    detail: "listed by ListModels; route details unavailable".into(),
                    is_command_code: runtime
                        .provider
                        .as_deref()
                        .map(|provider| provider.eq_ignore_ascii_case("command-code"))
                        .unwrap_or(false),
                });
            }
        }
    }
    ModelsListPayload {
        runtime: runtime.view(observed),
        models: routes,
        source: "jcode.runtime_info".into(),
        observed_at_ms: observed,
    }
}

async fn handle_set_model(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SetModelRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let before = match blocking(move || backend.runtime(&session_id)).await {
        Ok(runtime) => runtime,
        Err(error) => return error_response(&state, &request, error),
    };
    let Some(route) = before
        .routes
        .iter()
        .find(|route| route.model == payload.model)
    else {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput(format!(
                "model {} is not an advertised route",
                payload.model
            )),
        );
    };
    if let Some(expected_provider) = payload.expected_provider.as_deref() {
        if !route.provider.eq_ignore_ascii_case(expected_provider) {
            return error_response(
                &state,
                &request,
                CoreError::Conflict(format!(
                    "route provider is {}, not {}",
                    route.provider, expected_provider
                )),
            );
        }
    }
    if !route.available {
        return error_response(
            &state,
            &request,
            CoreError::BackendRejected(format!("route is unavailable: {}", route.detail)),
        );
    }
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let model = payload.model.clone();
    if let Err(error) = blocking(move || backend.set_model(&session_id, &model)).await {
        return error_response(&state, &request, error);
    }
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let after = match blocking(move || backend.runtime(&session_id)).await {
        Ok(runtime) => runtime,
        Err(error) => return error_response(&state, &request, error),
    };
    if after.model.as_deref() != Some(payload.model.as_str()) {
        return error_response(
            &state,
            &request,
            CoreError::Conflict(format!(
                "daemon reports model {:?} after selecting {}",
                after.model, payload.model
            )),
        );
    }
    state.set_command_code_available(
        after
            .providers
            .iter()
            .any(|provider| provider.eq_ignore_ascii_case("command-code")),
    );
    ok(
        &state,
        &request,
        "models.set",
        serde_json::to_value(models_payload(after, None)).unwrap_or_default(),
    )
}

async fn handle_set_reasoning(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SetReasoningRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    const ALLOWED: &[&str] = &["minimal", "low", "medium", "high", "xhigh", "max"];
    if !ALLOWED.contains(&payload.effort.as_str()) {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput(format!("unknown reasoning effort: {}", payload.effort)),
        );
    }
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let effort = payload.effort.clone();
    if let Err(error) = blocking(move || backend.set_reasoning_effort(&session_id, &effort)).await {
        return error_response(&state, &request, error);
    }
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let runtime = match blocking(move || backend.runtime(&session_id)).await {
        Ok(runtime) => runtime,
        Err(error) => return error_response(&state, &request, error),
    };
    if runtime.reasoning_effort.as_deref() != Some(payload.effort.as_str()) {
        return error_response(
            &state,
            &request,
            CoreError::Conflict(format!(
                "daemon reports reasoning effort {:?} after selecting {}",
                runtime.reasoning_effort, payload.effort
            )),
        );
    }
    ok(
        &state,
        &request,
        "reasoning.set",
        serde_json::to_value(runtime.view(now_ms())).unwrap_or_default(),
    )
}

async fn handle_context(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SessionRef = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    let runtime = blocking(move || backend.runtime(&session_id)).await.ok();
    let mut context = state.usage(&payload.session_id).unwrap_or(ContextView {
        input_tokens: None,
        output_tokens: None,
        cache_read_input: None,
        cache_creation_input: None,
        effective_budget: None,
        provider: None,
        model: None,
        observed_at_ms: now_ms(),
        source: "jcode.token_usage".into(),
    });
    if let Some(runtime) = runtime {
        context.provider = runtime.provider;
        context.model = runtime.model;
    }
    ok(
        &state,
        &request,
        "context.snapshot",
        serde_json::to_value(context).unwrap_or_default(),
    )
}

async fn handle_plan(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SessionRef = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let session_id = payload.session_id.clone();
    match blocking(move || backend.plan(&session_id)).await {
        Ok(plan) => ok(
            &state,
            &request,
            "plan.snapshot",
            serde_json::to_value(PlanSnapshotPayload {
                session_id: payload.session_id,
                plan,
                source: "jcode.todo_state".into(),
                observed_at_ms: now_ms(),
            })
            .unwrap_or_default(),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_activity(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: SessionRef = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let items = state.activity(&payload.session_id);
    ok(
        &state,
        &request,
        "activity.snapshot",
        serde_json::to_value(ActivitySnapshotPayload {
            session_id: payload.session_id,
            truncated: items.len() >= 200,
            items,
            source: "adapter.observed_events".into(),
            observed_at_ms: now_ms(),
        })
        .unwrap_or_default(),
    )
}

async fn handle_permission(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: PermissionResponseRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let backend = std::sync::Arc::clone(&state.backend);
    let result = blocking(move || {
        backend.permission_response(&payload.session_id, &payload.request_id, &payload.decision)
    })
    .await;
    match result {
        Ok(()) => ok(
            &state,
            &request,
            "tool.permission_response",
            json!({"accepted": true}),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_create_project(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: CreateProjectRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let label = payload.label.trim();
    if label.is_empty() || label.chars().count() > 100 {
        return error_response(
            &state,
            &request,
            CoreError::InvalidInput("project label is required".into()),
        );
    }
    let canonical = match state
        .roots
        .canonical_project_root(std::path::Path::new(payload.path.trim()))
    {
        Ok(path) => path,
        Err(error) => return error_response(&state, &request, error),
    };
    match state
        .store
        .upsert_project(label, &canonical.to_string_lossy(), payload.pinned)
    {
        Ok(project) => {
            state.hub.sessions_changed();
            ok(
                &state,
                &request,
                "projects.create",
                json!({"project": project}),
            )
        }
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_list_dir(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: ListDirRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let (root, project) = match state.project_root(&payload.project_id) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    match state.roots.list_dir(
        &root,
        &payload.path,
        payload.limit,
        payload.cursor.as_deref(),
    ) {
        Ok(mut listing) => {
            listing.project_id = project.project_id;
            ok(
                &state,
                &request,
                "files.list_dir",
                serde_json::to_value(listing).unwrap_or_default(),
            )
        }
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_read_preview(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: ReadPreviewRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let (root, project) = match state.project_root(&payload.project_id) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    match state
        .roots
        .read_preview(&root, &payload.path, state.config.max_file_bytes)
    {
        Ok(mut preview) => {
            preview.project_id = project.project_id;
            ok(
                &state,
                &request,
                "files.read_preview",
                serde_json::to_value(preview).unwrap_or_default(),
            )
        }
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_create_folder(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: CreateFolderRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    let (root, project) = match state.project_root(&payload.project_id) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    match state
        .roots
        .create_folder(&root, &payload.parent, &payload.name)
    {
        Ok(path) => ok(
            &state,
            &request,
            "folders.create",
            serde_json::to_value(CreateFolderResponse {
                project_id: project.project_id,
                path,
                created: true,
            })
            .unwrap_or_default(),
        ),
        Err(error) => error_response(&state, &request, error),
    }
}

async fn handle_revoke(state: std::sync::Arc<AppState>, request: Envelope) -> Envelope {
    let payload: DeviceRevokeRequest = match decode(&request.payload) {
        Ok(value) => value,
        Err(error) => return error_response(&state, &request, error),
    };
    match state.auth.revoke(&payload.device_id) {
        Ok(revoked) => {
            if revoked {
                let _ = state.revocation.send(payload.device_id.clone());
            }
            ok(
                &state,
                &request,
                "device.revoke",
                json!({"revoked": revoked, "device_id": payload.device_id}),
            )
        }
        Err(error) => error_response(&state, &request, error),
    }
}

/// Handle backend events on a Tokio task. Every branch preserves the
/// difference between "written to the socket" and "accepted by the agent".
pub async fn handle_backend_event(state: std::sync::Arc<AppState>, event: BackendEvent) {
    match event {
        BackendEvent::Connected { info } => {
            tracing::info!(server = %info.server, "JCode link connected");
            state.set_connection_message(None);
            let _ = state.hub.subscribe().try_recv();
            crate::events::broadcast_connection(&state, true, "JCode harness connected".into());
            state.hub.sessions_changed();
        }
        BackendEvent::Disconnected { message } => {
            tracing::warn!(message = %message, "JCode link disconnected");
            state.set_connection_message(Some(message.clone()));
            crate::events::broadcast_connection(&state, false, message);
        }
        BackendEvent::Accepted { session_id } => {
            let operation = match state.store.pending_operation_for_session(&session_id) {
                Ok(operation) => operation,
                Err(error) => {
                    tracing::warn!(%error, "could not read pending operation");
                    return;
                }
            };
            if let Some(operation) = operation {
                if matches!(
                    operation.state,
                    OperationState::Dispatching | OperationState::Unknown
                ) {
                    let from = operation.state;
                    if let Ok(updated) = state.store.transition_operation(
                        &operation.operation_id,
                        from,
                        OperationState::Accepted,
                        None,
                        None,
                    ) {
                        state
                            .turns
                            .mark_accepted(&session_id, &operation.operation_id);
                        state.hub.publish_operation(updated);
                    }
                }
            }
        }
        BackendEvent::RequestError { code, message } => {
            tracing::warn!(code = %code, message = %message, "JCode request error");
            let operations = state.store.dispatching_operations().unwrap_or_default();
            for operation in operations {
                if let Ok(updated) = state.store.transition_operation(
                    &operation.operation_id,
                    OperationState::Dispatching,
                    OperationState::Unknown,
                    Some((&code, &message)),
                    None,
                ) {
                    state.hub.publish_operation(updated);
                    state.hub.publish(
                        &operation.session_id,
                        operation.turn_id.clone(),
                        Some(operation.operation_id.clone()),
                        SessionEvent::AdapterError {
                            code: code.clone(),
                            message: message.clone(),
                            retryable: false,
                        },
                    );
                }
            }
        }
        BackendEvent::Session { session_id, event } => {
            handle_session_event(state, session_id, event);
        }
    }
}

fn handle_session_event(state: std::sync::Arc<AppState>, session_id: String, event: SessionEvent) {
    let active = state.turns.active(&session_id);
    let turn_id = active.as_ref().map(|turn| turn.turn_id.clone());
    let operation_id = active.as_ref().map(|turn| turn.operation_id.clone());
    if let SessionEvent::TitleChanged { title, .. } = &event {
        match title {
            Some(title) => {
                let _ = state.store.set_session_title(&session_id, title);
            }
            None => {
                let _ = state.store.clear_session_title(&session_id);
            }
        }
        state.hub.sessions_changed();
    }
    state.record_usage(&session_id, &event);
    state.record_activity(&session_id, turn_id.as_deref(), &event);
    state
        .hub
        .publish(&session_id, turn_id.clone(), operation_id, event.clone());
    if matches!(
        event,
        SessionEvent::TurnDone { .. } | SessionEvent::TurnStopped { .. }
    ) {
        let finished = state.turns.finish(&session_id);
        let operation = state.store.pending_operation_for_session(&session_id);
        if let Ok(Some(operation)) = operation {
            if operation.state == OperationState::Dispatching {
                if let Ok(updated) = state.store.transition_operation(
                    &operation.operation_id,
                    OperationState::Dispatching,
                    OperationState::Unknown,
                    Some((
                        "delivery_unconfirmed",
                        "turn ended without a message acknowledgment",
                    )),
                    None,
                ) {
                    state.hub.publish_operation(updated);
                }
            }
        }
        let _ = finished;
        state.hub.sessions_changed();
    }
}
