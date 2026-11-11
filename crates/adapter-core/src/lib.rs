//! Adapter v2 core: configuration, secure pairing, durable operations,
//! root-scoped workspace access, and the live JCode SDK link.

pub mod auth;
pub mod backend;
pub mod config;
pub mod live;
pub mod paths;
pub mod store;

pub use auth::AuthService;
pub use backend::{
    Backend, BackendErrorKind, BackendEvent, BackendInfo, BackendRoute, BackendRuntime,
    BackendSession, CoreError, CoreResult, SessionTurnRegistry, now_ms,
};
pub use config::AdapterConfig;
pub use live::{JcodeLive, classify_backend_error};
pub use paths::{ProjectRow, RootScope};
pub use store::Store;
