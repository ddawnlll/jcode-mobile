//! Rust Adapter v2 server for JCode Mobile.

pub mod dispatch;
pub mod events;
pub mod hub;
pub mod state;
pub mod ws;

pub use dispatch::handle_backend_event;
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
