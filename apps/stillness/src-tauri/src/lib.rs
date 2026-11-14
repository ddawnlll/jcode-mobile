use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

mod native_android;

const SERVICE: &str = "dev.jcode.stillness";

#[derive(Debug, Default, Serialize, Deserialize)]
struct Metadata {
    active_base_url: Option<String>,
    accounts: Vec<String>,
}

#[derive(Debug, Serialize)]
struct CredentialSnapshot {
    credentials: std::collections::BTreeMap<String, String>,
    active_base_url: Option<String>,
}

fn metadata_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("credentials.json"))
        .map_err(|error| format!("app config directory unavailable: {error}"))
}

fn read_metadata(app: &AppHandle) -> Metadata {
    let Ok(path) = metadata_path(app) else {
        return Metadata::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Metadata::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_metadata(app: &AppHandle, metadata: &Metadata) -> Result<(), String> {
    let path = metadata_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "credential metadata has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create config directory: {error}"))?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|error| format!("could not open credential metadata: {error}"))?;
        let encoded = serde_json::to_vec(metadata)
            .map_err(|error| format!("could not encode credential metadata: {error}"))?;
        file.write_all(&encoded)
            .map_err(|error| format!("could not write credential metadata: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("could not sync credential metadata: {error}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, &path)
        .map_err(|error| format!("could not replace credential metadata: {error}"))
}

fn entry(base_url: &str) -> Result<keyring::Entry, String> {
    if base_url.trim().is_empty() {
        return Err("server URL is required for credential storage".into());
    }
    keyring::Entry::new(SERVICE, base_url)
        .map_err(|error| format!("credential store unavailable: {error}"))
}

#[tauri::command]
fn credential_load_all(app: AppHandle) -> Result<CredentialSnapshot, String> {
    let metadata = read_metadata(&app);
    let mut credentials = std::collections::BTreeMap::new();
    for base_url in &metadata.accounts {
        match entry(base_url)?.get_password() {
            Ok(value) => {
                credentials.insert(base_url.clone(), value);
            }
            Err(keyring::Error::NoEntry) => {}
            Err(error) => {
                return Err(format!(
                    "could not read the OS credential store for {base_url}: {error}"
                ));
            }
        }
    }
    Ok(CredentialSnapshot {
        credentials,
        active_base_url: metadata.active_base_url,
    })
}

#[tauri::command]
fn credential_set(app: AppHandle, base_url: String, secret: String) -> Result<(), String> {
    entry(&base_url)?
        .set_password(&secret)
        .map_err(|error| format!("could not write to the OS credential store: {error}"))?;
    let mut metadata = read_metadata(&app);
    if !metadata.accounts.iter().any(|item| item == &base_url) {
        metadata.accounts.push(base_url.clone());
    }
    metadata.active_base_url = Some(base_url);
    write_metadata(&app, &metadata)
}

#[tauri::command]
fn credential_delete(app: AppHandle, base_url: String) -> Result<(), String> {
    if let Ok(entry) = entry(&base_url) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => {
                return Err(format!(
                    "could not remove the OS credential for {base_url}: {error}"
                ));
            }
        }
    }
    let mut metadata = read_metadata(&app);
    metadata.accounts.retain(|item| item != &base_url);
    if metadata.active_base_url.as_deref() == Some(base_url.as_str()) {
        metadata.active_base_url = metadata.accounts.first().cloned();
    }
    write_metadata(&app, &metadata)
}

#[tauri::command]
fn credential_kind() -> &'static str {
    "OS credential store"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    android_keyring::set_android_keyring_credential_builder()
        .expect("Android credential store unavailable");

    tauri::Builder::default()
        // The plugin only registers the Kotlin class on Android. Its commands are
        // registered below as app commands so an in-tree plugin does not need a
        // generated ACL permission set.
        .plugin(native_android::plugin())
        .invoke_handler(tauri::generate_handler![
            credential_load_all,
            credential_set,
            credential_delete,
            credential_kind,
            native_android::native_platform_status,
            native_android::native_capabilities,
            native_android::native_settings_get,
            native_android::native_settings_set,
            native_android::native_notification_status,
            native_android::native_request_notification_permission,
            native_android::native_post_notification,
            native_android::native_push_status,
            native_android::native_push_register_local,
            native_android::native_background_sync_status,
            native_android::native_background_sync_set,
            native_android::native_background_sync_run_now,
            native_android::native_share_consume_pending,
            native_android::native_share_outbound,
            native_android::native_deep_link_consume_pending,
            native_android::native_biometric_status,
            native_android::native_biometric_enable,
            native_android::native_biometric_unlock,
            native_android::native_biometric_lock_now,
            native_android::native_biometric_disable,
            native_android::native_vault_put,
            native_android::native_vault_get,
            native_android::native_vault_delete,
            native_android::native_pick_images,
            native_android::native_pick_document,
            native_android::native_capture_photo,
            native_android::native_scan_qr,
            native_android::native_decode_qr_image,
            native_android::native_save_to_downloads,
            native_android::native_open_with,
            native_android::native_read_image_base64,
            native_android::native_clipboard_read,
            native_android::native_clipboard_write,
            native_android::native_haptic,
            native_android::native_insets_snapshot,
            native_android::native_layout_status,
            native_android::native_refresh_shortcuts,
            native_android::native_text_selection_noop,
            native_android::native_register_listener,
            native_android::native_remove_listener
        ])
        .run(tauri::generate_context!())
        .expect("Stillness failed to start");
}
