use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct AdapterConfig {
    pub bind: String,
    pub data_dir: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
    pub pairing_code: Option<String>,
    pub web_dir: Option<PathBuf>,
    pub jcode_api_socket: Option<PathBuf>,
    pub jcode_binary: Option<PathBuf>,
    pub server_name: String,
    pub max_file_bytes: u64,
    pub event_queue: usize,
    pub disconnect_grace: Duration,
    pub allowed_origins: Vec<String>,
    pub session_create_default_dir: Option<PathBuf>,
}

impl AdapterConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind = std::env::var("JCODE_ADAPTER_BIND").unwrap_or_else(|_| "127.0.0.1:7646".into());
        let data_dir = std::env::var_os("JCODE_ADAPTER_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_data_dir);
        let allowed_roots = match std::env::var("JCODE_ADAPTER_ALLOWED_ROOTS") {
            Ok(value) if !value.trim().is_empty() => {
                std::env::split_paths(&value).collect::<Vec<_>>()
            }
            _ => vec![std::env::current_dir()?],
        };
        let pairing_code = std::env::var("JCODE_ADAPTER_PAIRING_CODE").ok();
        let web_dir = std::env::var_os("JCODE_ADAPTER_WEB_DIR").map(PathBuf::from);
        let jcode_api_socket = std::env::var_os("JCODE_API_SOCKET").map(PathBuf::from);
        let jcode_binary = std::env::var_os("JCODE_BINARY").map(PathBuf::from);
        let server_name =
            std::env::var("JCODE_ADAPTER_NAME").unwrap_or_else(|_| "JCode Mobile".into());
        let max_file_bytes = std::env::var("JCODE_ADAPTER_MAX_FILE_BYTES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(256 * 1024);
        let event_queue = std::env::var("JCODE_ADAPTER_EVENT_QUEUE")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(512);
        let allowed_origins = std::env::var("JCODE_ADAPTER_ALLOWED_ORIGINS")
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|origin| !origin.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let session_create_default_dir = std::env::var_os("JCODE_ADAPTER_DEFAULT_WORKDIR")
            .map(PathBuf::from)
            .or_else(|| allowed_roots.first().cloned());
        Ok(Self {
            bind,
            data_dir,
            allowed_roots,
            pairing_code,
            web_dir,
            jcode_api_socket,
            jcode_binary,
            server_name,
            max_file_bytes,
            event_queue,
            disconnect_grace: Duration::from_secs(3),
            allowed_origins,
            session_create_default_dir,
        })
    }
}

pub fn default_data_dir() -> PathBuf {
    if let Some(base) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(base).join("jcode-mobile-adapter-v2");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".local/share/jcode-mobile-adapter-v2");
    }
    PathBuf::from(".jcode-mobile-adapter-v2")
}
