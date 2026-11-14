//! Rust Adapter v3 server for JCode Mobile.

pub mod dispatch;
pub mod events;
pub mod faults;
pub mod hub;
pub mod metrics;
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
            dispatch::handle_backend_event(std::sync::Arc::clone(&state), event).await;
        }
    });
}

/// Start the adapter server. Shared by the `jcode-adapter-v2` rollback alias
/// and the `jcode-adapter-v3` binary so both run identical code.
pub async fn run_main() -> anyhow::Result<()> {
    use std::net::SocketAddr;
    use std::sync::Arc;

    use adapter_core::{AdapterConfig, AuthService, JcodeLive, Store};
    use tokio::net::TcpListener;
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,jcode_adapter_v3=info")),
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
        "JCode Adapter v3 listening on http://{address} (protocol {})",
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
