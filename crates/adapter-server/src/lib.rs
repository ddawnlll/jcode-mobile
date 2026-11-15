//! Rust Adapter v4 server for JCode Mobile.

pub mod dispatch;
pub mod events;
pub mod faults;
pub mod hub;
pub mod metrics;
pub mod push;
pub mod state;
pub mod ws;

pub use dispatch::handle_backend_event;
pub use faults::FaultInjection;
pub use metrics::LatencyTracker;
pub use ws::{router, serve};

pub fn now_ms() -> i64 {
    adapter_core::now_ms()
}

pub fn spawn_backend_pump(
    state: std::sync::Arc<state::AppState>,
    mut receiver: tokio::sync::mpsc::Receiver<adapter_core::BackendEvent>,
) {
    tokio::spawn(async move {
        while let Some(event) = receiver.recv().await {
            let mut ready = vec![event];
            // Drain what is ready without delaying the first event to fill a
            // batch. Collapse contiguous deltas before assigning journal seqs.
            for _ in 1..64 {
                let Ok(next) = receiver.try_recv() else { break };
                if !merge_delta(ready.last_mut().expect("batch is nonempty"), &next) {
                    ready.push(next);
                }
            }
            let state = std::sync::Arc::clone(&state);
            if let Err(error) = tokio::task::spawn_blocking(move || {
                for event in ready {
                    dispatch::process_backend_event(std::sync::Arc::clone(&state), event);
                }
            })
            .await
            {
                tracing::error!(%error, "JCode event journal worker stopped");
                break;
            }
        }
    });
}

fn merge_delta(first: &mut adapter_core::BackendEvent, next: &adapter_core::BackendEvent) -> bool {
    use adapter_core::BackendEvent::Session;
    use adapter_protocol::SessionEvent::*;
    let (
        Session { session_id, event },
        Session {
            session_id: next_session,
            event: next_event,
        },
    ) = (first, next)
    else {
        return false;
    };
    if session_id != next_session {
        return false;
    }
    let (text, append) = match (event, next_event) {
        (
            TextDelta { text, message_id },
            TextDelta {
                text: append,
                message_id: next_id,
            },
        ) if message_id == next_id => (text, append),
        (ReasoningDelta { text }, ReasoningDelta { text: append }) => (text, append),
        (
            ToolInputDelta { call_id, delta },
            ToolInputDelta {
                call_id: next_id,
                delta: append,
            },
        ) if call_id == next_id && !call_id.is_empty() => (delta, append),
        _ => return false,
    };
    if text.len() + append.len() > 16 * 1024 {
        return false;
    }
    text.push_str(append);
    true
}

/// Start the adapter server for the current binary and legacy service aliases.
pub async fn run_main() -> anyhow::Result<()> {
    use std::net::SocketAddr;
    use std::sync::Arc;

    use adapter_core::{AdapterConfig, AuthService, JcodeLive, Store};
    use tokio::net::TcpListener;
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,jcode_adapter_v4=info")),
        )
        .with_target(false)
        .init();

    let config = AdapterConfig::from_env()?;
    let store = Store::open(&config.data_dir)?;
    let auth = AuthService::new(Arc::clone(&store));
    let pairing_code = auth.install_pairing_code(config.pairing_code.as_deref())?;
    let socket_path = config
        .jcode_api_socket
        .clone()
        .unwrap_or_else(jcode_sdk::api::api_socket_path);
    let live = JcodeLive::new(socket_path.clone());
    let (event_tx, event_rx) = tokio::sync::mpsc::channel(config.event_queue.max(64));
    live.start(event_tx);
    let backend: Arc<dyn adapter_core::Backend> =
        Arc::clone(&live) as Arc<dyn adapter_core::Backend>;
    let epoch = format!("epoch_{}", uuid::Uuid::new_v4().simple());
    let state = state::AppState::new(config.clone(), store, backend, epoch)?;
    // Bound disk use at startup and then periodically. Retention windows are
    // deliberately longer than any plausible phone-offline window; older rows
    // are reported as gaps instead of being invented.
    let _ = state
        .store
        .compact_journal_older_than(14 * 24 * 60 * 60 * 1000);
    let _ = state.store.compact_session_index(30 * 24 * 60 * 60 * 1000);
    spawn_backend_pump(Arc::clone(&state), event_rx);
    spawn_maintenance(Arc::clone(&state));

    let listener = TcpListener::bind(&config.bind).await?;
    let address = listener.local_addr()?;
    println!(
        "JCode Adapter v4 listening on http://{address} (protocol {})",
        adapter_protocol::PROTOCOL_VERSION
    );
    println!("JCode harness socket: {}", socket_path.display());
    println!("Pairing code (valid for 10 minutes, single use): {pairing_code}");
    println!("Allowed roots:");
    for root in state.roots.roots() {
        println!("  - {}", root.display());
    }
    if config.web_dir.is_none() {
        println!("No web UI configured (set JCODE_ADAPTER_WEB_DIR to serve a build)");
    }

    axum::serve(
        listener,
        router(Arc::clone(&state)).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

/// Periodic retention. Runs on the adapter's own runtime and never blocks a
/// request: each pass is a bounded indexed delete.
fn spawn_maintenance(state: std::sync::Arc<state::AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 60 * 60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if let Err(error) = state
                .store
                .compact_journal_older_than(14 * 24 * 60 * 60 * 1000)
            {
                tracing::warn!(%error, "journal compaction failed");
            }
            if let Err(error) = state.store.compact_session_index(30 * 24 * 60 * 60 * 1000) {
                tracing::warn!(%error, "session index compaction failed");
            }
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown requested");
}

#[cfg(test)]
mod stream_batch_tests {
    use super::merge_delta;
    use adapter_core::BackendEvent;
    use adapter_protocol::SessionEvent;

    fn text(session_id: &str, message_id: &str, text: &str) -> BackendEvent {
        BackendEvent::Session {
            session_id: session_id.into(),
            event: SessionEvent::TextDelta {
                text: text.into(),
                message_id: Some(message_id.into()),
            },
        }
    }

    #[test]
    fn coalescing_respects_session_message_type_and_byte_fences() {
        let mut first = text("a", "one", "İ");
        assert!(merge_delta(&mut first, &text("a", "one", " 🪶")));
        assert!(!merge_delta(
            &mut first,
            &text("b", "one", "another session")
        ));
        assert!(!merge_delta(&mut first, &text("a", "two", "another block")));
        assert!(!merge_delta(
            &mut first,
            &text("a", "one", &"x".repeat(16 * 1024))
        ));
        assert!(!merge_delta(
            &mut first,
            &BackendEvent::Session {
                session_id: "a".into(),
                event: SessionEvent::TextDone {
                    message_id: Some("one".into())
                }
            }
        ));
        assert!(
            matches!(first, BackendEvent::Session { event: SessionEvent::TextDelta { text, .. }, .. } if text == "İ 🪶")
        );
    }
}
