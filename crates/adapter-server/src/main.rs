use std::net::SocketAddr;
use std::sync::Arc;

use adapter_core::{AdapterConfig, AuthService, JcodeLive, Store};
use adapter_server::state::AppState;
use adapter_server::{router, spawn_backend_pump};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,jcode_adapter_v2=info")),
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
    let state = AppState::new(config.clone(), store, backend, epoch)?;
    spawn_backend_pump(Arc::clone(&state), event_rx);

    let listener = TcpListener::bind(&config.bind).await?;
    let address = listener.local_addr()?;
    println!("JCode Adapter v2 listening on http://{address}");
    println!("JCode harness socket: {}", socket_path.display());
    println!("Pairing code (valid for 10 minutes, single use): {pairing_code}");
    println!("Allowed roots:");
    for root in state.roots.roots() {
        println!("  - {}", root.display());
    }
    if config.web_dir.is_none() {
        println!("No web UI configured (set JCODE_ADAPTER_WEB_DIR to serve a build)");
    }

    let server_state = Arc::clone(&state);
    let result = axum::serve(
        listener,
        router(Arc::clone(&server_state)).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await;
    result?;
    Ok(())
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
