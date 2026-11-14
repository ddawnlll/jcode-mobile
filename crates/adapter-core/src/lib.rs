//! Adapter v3 core: configuration, secure pairing, durable operations, the
//! durable per-session event journal, root-scoped workspace access, and the
//! live JCode SDK link.

pub mod auth;
pub mod backend;
pub mod config;
pub mod journal;
pub mod live;
pub mod paths;
pub mod store;

pub use auth::AuthService;
pub use backend::{
    Backend, BackendErrorKind, BackendEvent, BackendInfo, BackendRoute, BackendRuntime,
    BackendSession, CoreError, CoreResult, SessionTurnRegistry, is_command_code_provider, now_ms,
};
pub use config::AdapterConfig;
pub use journal::{JournalRecord, JournalReplay, JournalStats, MAX_REPLAY_LIMIT};
pub use live::{JcodeLive, classify_backend_error};
pub use paths::{ProjectRow, RootScope};
pub use store::{PushRegistrationRow, Store};
