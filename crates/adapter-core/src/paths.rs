use std::path::{Component, Path};

use adapter_protocol::{DirEntry, DirListing, FilePreview};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{0}")]
    Message(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("path escapes the allowed root")]
    PathEscape,
    #[error("operation transition rejected: {from:?} -> {to:?}")]
    InvalidTransition {
        from: adapter_protocol::OperationState,
        to: adapter_protocol::OperationState,
    },
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("backend unavailable: {0}")]
    BackendUnavailable(String),
    #[error("backend rejected: {0}")]
    BackendRejected(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

pub type CoreResult<T> = Result<T, CoreError>;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// A project maps an adapter id to one canonical directory under an allowed
/// server root. The client never supplies an unchecked absolute path.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectRow {
    pub project_id: String,
    pub label: String,
    pub path: String,
    pub pinned: bool,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct RootScope {
    roots: Vec<std::path::PathBuf>,
}

fn is_denied_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        ".jcode"
            | ".ssh"
            | ".aws"
            | ".gnupg"
            | ".netrc"
            | "command_code_accounts.json"
            | "auth.json"
            | ".auth.json"
            | "config.toml.bak"
    ) || lower.starts_with(".env")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower == "id_rsa"
        || lower == "id_ed25519"
}

fn is_denied_relative(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(is_denied_name)
            .unwrap_or(false)
    })
}

impl RootScope {
    pub fn new(roots: impl IntoIterator<Item = std::path::PathBuf>) -> CoreResult<Self> {
        let mut canonical = Vec::new();
        for root in roots {
            let root = root.canonicalize().map_err(|_| {
                CoreError::InvalidPath(format!("allowed root does not exist: {}", root.display()))
            })?;
            if !root.is_dir() {
                return Err(CoreError::InvalidPath(format!(
                    "allowed root is not a directory: {}",
                    root.display()
                )));
            }
            if !canonical
                .iter()
                .any(|existing: &std::path::PathBuf| existing == &root)
            {
                canonical.push(root);
            }
        }
        if canonical.is_empty() {
            return Err(CoreError::InvalidPath("no allowed roots configured".into()));
        }
        Ok(Self { roots: canonical })
    }

    pub fn roots(&self) -> &[std::path::PathBuf] {
        &self.roots
    }

    pub fn canonical_project_root(&self, candidate: &Path) -> CoreResult<std::path::PathBuf> {
        let canonical = candidate.canonicalize().map_err(|_| {
            CoreError::InvalidPath(format!("project does not exist: {}", candidate.display()))
        })?;
        if !canonical.is_dir() {
            return Err(CoreError::InvalidPath(
                "project root is not a directory".into(),
            ));
        }
        self.ensure_under_root(&canonical)
    }

    fn ensure_under_root(&self, path: &Path) -> CoreResult<std::path::PathBuf> {
        for root in &self.roots {
            if path == root || path.starts_with(root) {
                return Ok(path.to_path_buf());
            }
        }
        Err(CoreError::PathEscape)
    }

    pub fn ensure_path_under(&self, root: &Path, path: &Path) -> CoreResult<std::path::PathBuf> {
        if !(path == root || path.starts_with(root)) {
            return Err(CoreError::PathEscape);
        }
        self.ensure_under_root(path)
    }

    pub fn resolve_relative(&self, root: &Path, relative: &str) -> CoreResult<std::path::PathBuf> {
        if relative.contains('\0') {
            return Err(CoreError::InvalidPath("NUL byte in path".into()));
        }
        let rel = Path::new(relative);
        if rel.is_absolute() {
            return Err(CoreError::InvalidPath(
                "absolute paths are not accepted".into(),
            ));
        }
        if rel
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(CoreError::PathEscape);
        }
        if is_denied_relative(rel) {
            return Err(CoreError::InvalidPath(
                "path is in a protected location".into(),
            ));
        }
        let joined = root.join(rel);
        let canonical = joined
            .canonicalize()
            .map_err(|_| CoreError::NotFound(relative.to_string()))?;
        self.ensure_path_under(root, &canonical)
    }

    pub fn list_dir(
        &self,
        root: &Path,
        relative: &str,
        limit: u32,
        cursor: Option<&str>,
    ) -> CoreResult<DirListing> {
        let directory = self.resolve_relative(root, relative)?;
        let metadata = std::fs::symlink_metadata(&directory)?;
        if !metadata.is_dir() {
            return Err(CoreError::InvalidInput("not a directory".into()));
        }
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(&directory)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_denied_name(&name) {
                continue;
            }
            let path = entry.path();
            let symlink = entry.file_type()?.is_symlink();
            let metadata = match std::fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let kind = if symlink {
                // Do not advertise a navigable directory for a link. The client
                // can display it but cannot traverse it.
                "symlink"
            } else if metadata.is_dir() {
                "dir"
            } else if metadata.is_file() {
                "file"
            } else {
                "other"
            };
            let modified_at_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            entries.push((
                DirEntry {
                    name: name.clone(),
                    kind: kind.into(),
                    size: metadata.is_file().then_some(metadata.len()),
                    modified_at_ms,
                    hidden: name.starts_with('.'),
                },
                path,
            ));
        }
        entries.sort_by(|a, b| {
            let a_dir = a.0.kind == "dir";
            let b_dir = b.0.kind == "dir";
            b_dir.cmp(&a_dir).then_with(|| {
                a.0.name
                    .to_ascii_lowercase()
                    .cmp(&b.0.name.to_ascii_lowercase())
            })
        });
        let offset = cursor
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0)
            .min(entries.len());
        let limited = limit.clamp(1, 500) as usize;
        let page: Vec<DirEntry> = entries
            .iter()
            .skip(offset)
            .take(limited)
            .map(|(entry, _)| entry.clone())
            .collect();
        let next = offset + page.len();
        Ok(DirListing {
            project_id: String::new(),
            path: relative.to_string(),
            entries: page,
            next_cursor: (next < entries.len()).then(|| next.to_string()),
            truncated: next < entries.len(),
            observed_at_ms: now_ms(),
        })
    }

    pub fn read_preview(
        &self,
        root: &Path,
        relative: &str,
        max_bytes: u64,
    ) -> CoreResult<FilePreview> {
        let path = self.resolve_relative(root, relative)?;
        let metadata = std::fs::metadata(&path)?;
        if !metadata.is_file() {
            return Err(CoreError::InvalidInput("not a regular file".into()));
        }
        let size = metadata.len();
        let take = size.min(max_bytes) as usize;
        let mut bytes = Vec::with_capacity(take.min(64 * 1024));
        use std::io::Read;
        let mut file = std::fs::File::open(&path)?;
        file.by_ref().take(max_bytes).read_to_end(&mut bytes)?;
        let binary = bytes.contains(&0);
        let content = if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        };
        Ok(FilePreview {
            project_id: String::new(),
            path: relative.to_string(),
            content,
            size,
            truncated: size > max_bytes,
            binary,
            observed_at_ms: now_ms(),
        })
    }

    pub fn create_folder(&self, root: &Path, parent: &str, name: &str) -> CoreResult<String> {
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.contains('/')
            || name.contains('\\')
            || name.contains('\0')
        {
            return Err(CoreError::InvalidInput(
                "folder name must be one safe path segment".into(),
            ));
        }
        if is_denied_name(name) {
            return Err(CoreError::InvalidPath("protected folder name".into()));
        }
        let parent_path = self.resolve_relative(root, parent)?;
        if !parent_path.is_dir() {
            return Err(CoreError::InvalidInput("parent is not a directory".into()));
        }
        let target = parent_path.join(name);
        if target.exists() {
            return Err(CoreError::Conflict("folder already exists".into()));
        }
        std::fs::create_dir(&target)?;
        let canonical = target.canonicalize()?;
        self.ensure_path_under(root, &canonical)?;
        Ok(if parent.is_empty() {
            name.to_string()
        } else {
            format!("{parent}/{name}")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> (tempfile::TempDir, RootScope) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        let scope = RootScope::new([dir.path().to_path_buf()]).unwrap();
        (dir, scope)
    }

    #[test]
    fn relative_paths_stay_under_the_root() {
        let (dir, scope) = temp_root();
        let root = dir.path().canonicalize().unwrap();
        assert!(scope.resolve_relative(&root, "src/main.rs").is_ok());
        assert!(matches!(
            scope.resolve_relative(&root, "../etc/passwd"),
            Err(CoreError::PathEscape)
        ));
        assert!(matches!(
            scope.resolve_relative(&root, "/etc/passwd"),
            Err(CoreError::InvalidPath(_))
        ));
    }

    #[test]
    fn protected_names_are_not_listed() {
        let (dir, scope) = temp_root();
        std::fs::create_dir(dir.path().join(".jcode")).unwrap();
        std::fs::write(dir.path().join(".env"), "SECRET=1").unwrap();
        let root = dir.path().canonicalize().unwrap();
        let listing = scope.list_dir(&root, "", 100, None).unwrap();
        assert!(!listing.entries.iter().any(|entry| entry.name == ".jcode"));
        assert!(!listing.entries.iter().any(|entry| entry.name == ".env"));
    }

    #[test]
    fn external_symlink_is_not_traversable() {
        let (dir, scope) = temp_root();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), "nope").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("escape")).unwrap();
        let root = dir.path().canonicalize().unwrap();
        assert!(matches!(
            scope.resolve_relative(&root, "escape/secret"),
            Err(CoreError::PathEscape)
        ));
        let listing = scope.list_dir(&root, "", 100, None).unwrap();
        let link = listing
            .entries
            .iter()
            .find(|entry| entry.name == "escape")
            .unwrap();
        assert_eq!(link.kind, "symlink");
    }

    #[test]
    fn folder_creation_is_confined_and_collision_safe() {
        let (dir, scope) = temp_root();
        let root = dir.path().canonicalize().unwrap();
        let created = scope.create_folder(&root, "src", "nested").unwrap();
        assert_eq!(created, "src/nested");
        assert!(matches!(
            scope.create_folder(&root, "src", "nested"),
            Err(CoreError::Conflict(_))
        ));
        assert!(matches!(
            scope.create_folder(&root, "src", "../escape"),
            Err(CoreError::InvalidInput(_))
        ));
    }

    #[test]
    fn binary_previews_do_not_claim_text() {
        let (dir, scope) = temp_root();
        std::fs::write(dir.path().join("bin"), [0u8, 1, 2, 3]).unwrap();
        let root = dir.path().canonicalize().unwrap();
        let preview = scope.read_preview(&root, "bin", 1024).unwrap();
        assert!(preview.binary);
        assert!(preview.content.is_empty());
    }
}
