//! Android native bridge plugin.
//!
//! Every command in this module forwards to a Kotlin `@Command` method on
//! `dev.jcode.stillness.native.NativeBridgePlugin`. The Rust side owns the
//! typed request/response contract so JavaScript never receives an untyped
//! blob, and so a missing platform implementation surfaces as an explicit
//! `unsupported_platform` error instead of a silent success.
//!
//! The Android-side work is real platform integration (NotificationManager,
//! WorkManager, BiometricPrompt, SAF, MediaStore, AppWidget, TileService), not
//! a WebView facsimile. The daemon and adapter stay on the VPS.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
use tauri::{Manager, State, Wry};

pub const PLUGIN_NAME: &str = "android-native";
/// The Tauri mobile bridge takes the Kotlin package and the simple class name
/// separately and joins them as `package/Class`; passing a fully qualified class
/// name here doubles the package prefix and the plugin fails to load.
const ANDROID_PACKAGE: &str = "dev.jcode.stillness.native";
const ANDROID_CLASS: &str = "NativeBridgePlugin";

/// Outcome of one native capability probe.
///
/// `not_configured` and `blocked` are deliberately distinct from `unavailable`
/// so the UI can explain *why* a feature is inert without inventing success.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityState {
    Available,
    NotConfigured,
    Unavailable,
    Blocked,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CapabilityMatrix {
    pub notifications: CapabilityState,
    pub push: CapabilityState,
    pub background_sync: CapabilityState,
    pub share_in: CapabilityState,
    pub share_out: CapabilityState,
    pub biometric_lock: CapabilityState,
    pub photo_picker: CapabilityState,
    pub document_picker: CapabilityState,
    pub camera: CapabilityState,
    pub qr_camera: CapabilityState,
    pub qr_image: CapabilityState,
    pub downloads: CapabilityState,
    pub open_with: CapabilityState,
    pub clipboard: CapabilityState,
    pub haptics: CapabilityState,
    pub shortcuts: CapabilityState,
    pub widget: CapabilityState,
    pub quick_settings_tile: CapabilityState,
    /// Human-readable reasons for any non-`available` entry, keyed by field.
    pub reasons: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlatformStatus {
    pub platform: String,
    pub api_level: i32,
    pub device_model: String,
    pub app_version: String,
    pub edge_to_edge: bool,
    pub predictive_back: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsSnapshot {
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationChannelStatus {
    pub id: String,
    pub name: String,
    pub importance: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationStatus {
    /// `granted`, `denied`, `prompt`, or `unsupported`.
    pub permission: String,
    pub notifications_enabled: bool,
    pub channels: Vec<NotificationChannelStatus>,
    pub group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PostNotificationRequest {
    /// `turn_complete`, `turn_failed`, `approval_needed`, or `test`.
    pub kind: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationPosted {
    pub posted: bool,
    pub id: Option<i32>,
    pub channel: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PushStatus {
    /// Always `not_configured` until a Firebase project or relay is supplied.
    pub state: String,
    pub token: Option<String>,
    pub registered_at: Option<i64>,
    pub transport: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BackgroundSyncStatus {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub last_run_at: Option<i64>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_http_status: Option<i32>,
    pub last_checked_base_url: Option<String>,
    /// `periodic_work` when scheduled, `none` when disabled.
    pub worker: String,
    pub queued: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShareItem {
    /// `text`, `url`, `image`, or `file`.
    pub kind: String,
    pub text: Option<String>,
    pub url: Option<String>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
    /// `content://` URI the webview can fetch through the asset protocol.
    pub uri: Option<String>,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SharePending {
    pub items: Vec<ShareItem>,
    pub discarded: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShareOutboundRequest {
    pub text: Option<String>,
    pub url: Option<String>,
    pub uri: Option<String>,
    pub mime_type: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShareLaunched {
    pub launched: bool,
    pub chooser: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DeepLinkPending {
    /// Fully qualified `jcode-mobile://` URL when one is queued.
    pub url: Option<String>,
    /// `open_session`, `new_session`, or `none`.
    pub action: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BiometricStatus {
    pub enabled: bool,
    pub locked: bool,
    pub available: bool,
    pub enrolled: bool,
    /// `biometric_or_device_credential`, `device_credential`, `none`.
    pub method: String,
    pub secret_stored: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BiometricUnlock {
    pub unlocked: bool,
    /// `approved`, `cancelled`, `unavailable`, or `not_enabled`.
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultValue {
    pub present: bool,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PickedUris {
    /// `picked`, `cancelled`, or `unavailable`.
    pub status: String,
    pub uris: Vec<String>,
    pub mime_types: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct QrScanResult {
    /// `decoded`, `cancelled`, `unreadable`, or `unavailable`.
    pub status: String,
    pub text: Option<String>,
    pub format: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadedFile {
    /// `saved_to_downloads`, `stored_in_app_files`, or `failed`.
    pub status: String,
    pub uri: Option<String>,
    pub display_name: Option<String>,
    pub location: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenWithResult {
    pub launched: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipboardRead {
    pub available: bool,
    pub text: Option<String>,
    pub sensitive: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipboardWrite {
    pub written: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HapticResult {
    pub performed: bool,
    pub kind: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct InsetsSnapshot {
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub left: i32,
    pub ime_bottom: i32,
    pub status_bar: i32,
    pub nav_bar: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutStatus {
    pub edge_to_edge: bool,
    pub ime_visible: bool,
    pub predictive_back: bool,
    /// `predictive_callback` on API 33+, `back_dispatcher` earlier.
    pub back_strategy: String,
    pub insets: InsetsSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShortcutsResult {
    pub count: u32,
    pub ids: Vec<String>,
    pub widget: bool,
    pub error: Option<String>,
}

/// Explicit, serializable bridge error.
///
/// Tauri command errors must be `Serialize`; returning `(code, message)` lets
/// the JavaScript wrapper distinguish "this platform has no bridge" from "the
/// native call failed".
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NativeError {
    pub code: String,
    pub message: String,
}

impl NativeError {
    fn unsupported_platform(platform: &str) -> Self {
        Self {
            code: "unsupported_platform".into(),
            message: format!("the Android native bridge is not available on {platform}"),
        }
    }

    fn bridge_unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "bridge_unavailable".into(),
            message: message.into(),
        }
    }

    fn native(message: impl Into<String>) -> Self {
        Self {
            code: "native_error".into(),
            message: message.into(),
        }
    }
}

/// Preserve the Kotlin rejection code instead of collapsing every failure into
/// a generic `native_error`. `invoke.reject(message, code)` sets this code, and
/// the JavaScript wrapper surfaces it verbatim.
#[cfg(mobile)]
fn map_plugin_error(error: tauri::plugin::mobile::PluginInvokeError) -> NativeError {
    match error {
        tauri::plugin::mobile::PluginInvokeError::InvokeRejected(response) => NativeError {
            code: response
                .code
                .filter(|code| !code.trim().is_empty())
                .unwrap_or_else(|| "native_error".into()),
            message: response
                .message
                .filter(|message| !message.trim().is_empty())
                .unwrap_or_else(|| "the native call was rejected".into()),
        },
        other => NativeError::native(other.to_string()),
    }
}

/// Holds the Kotlin plugin handle created during `setup`.
pub struct NativeBridge {
    handle: Mutex<Option<PluginHandle<Wry>>>,
}

impl NativeBridge {
    fn new(handle: Option<PluginHandle<Wry>>) -> Self {
        Self {
            handle: Mutex::new(handle),
        }
    }

    #[cfg(mobile)]
    fn handle(&self) -> Result<PluginHandle<Wry>, NativeError> {
        let guard = self
            .handle
            .lock()
            .map_err(|_| NativeError::bridge_unavailable("the bridge handle lock was poisoned"))?;
        guard
            .clone()
            .ok_or_else(|| NativeError::unsupported_platform(std::env::consts::OS))
    }

    /// Forward one command to Kotlin. The awaited native response is decoded
    /// into the typed Rust result, so a shape mismatch is an explicit error.
    #[cfg(mobile)]
    async fn call<T>(&self, command: &str, payload: Value) -> Result<T, NativeError>
    where
        T: serde::de::DeserializeOwned,
    {
        let handle = self.handle()?;
        handle
            .run_mobile_plugin_async(command, payload)
            .await
            .map_err(map_plugin_error)
    }

    /// Desktop, web, and test builds have no mobile plugin runtime. This must
    /// be an explicit error: a silent `Ok` would make the UI claim native
    /// behavior that cannot exist off Android.
    #[cfg(not(mobile))]
    async fn call<T>(&self, _command: &str, _payload: Value) -> Result<T, NativeError>
    where
        T: serde::de::DeserializeOwned,
    {
        Err(NativeError::unsupported_platform(std::env::consts::OS))
    }

    #[cfg(mobile)]
    fn call_blocking<T>(&self, command: &str, payload: Value) -> Result<T, NativeError>
    where
        T: serde::de::DeserializeOwned,
    {
        let handle = self.handle()?;
        handle
            .run_mobile_plugin(command, payload)
            .map_err(map_plugin_error)
    }

    #[cfg(not(mobile))]
    fn call_blocking<T>(&self, _command: &str, _payload: Value) -> Result<T, NativeError>
    where
        T: serde::de::DeserializeOwned,
    {
        Err(NativeError::unsupported_platform(std::env::consts::OS))
    }
}

macro_rules! forward_command {
    (
        $(#[$meta:meta])*
        $name:ident($method:literal) -> $result:ty
    ) => {
        $(#[$meta])*
        #[tauri::command]
        pub async fn $name(bridge: State<'_, NativeBridge>) -> Result<$result, NativeError> {
            bridge.call($method, json!({})).await
        }
    };
    (
        $(#[$meta:meta])*
        $name:ident($method:literal, $args:ty) -> $result:ty
    ) => {
        $(#[$meta])*
        #[tauri::command]
        pub async fn $name(
            bridge: State<'_, NativeBridge>,
            args: $args,
        ) -> Result<$result, NativeError> {
            bridge.call($method, serde_json::to_value(args).map_err(|error| NativeError::native(error.to_string()))?).await
        }
    };
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsGetRequest {
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsSetRequest {
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PushRegisterRequest {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BackgroundSyncSetRequest {
    pub enabled: bool,
    pub interval_minutes: Option<u32>,
    /// Non-secret adapter base URL used by the bounded health probe.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultPutRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultKeyRequest {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PickRequest {
    pub max: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UriRequest {
    pub uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SaveDownloadRequest {
    pub file_name: String,
    pub mime_type: String,
    /// Bounded base64 payload (the native side rejects anything over 24 MiB).
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenWithRequest {
    pub uri: String,
    pub mime_type: Option<String>,
}

/// One picked image read into base64 for the adapter attachment path.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PickedImageData {
    /// `ok`, `too_large`, `unsupported_type`, or `unreadable`.
    pub status: String,
    pub mime_type: Option<String>,
    pub name: Option<String>,
    /// Decoded byte count when the read succeeded.
    pub size: Option<u64>,
    pub base64: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipboardWriteRequest {
    pub text: String,
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HapticRequest {
    /// `light`, `medium`, `heavy`, `success`, or `error`.
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShortcutsRefreshRequest {
    pub recent_session_id: Option<String>,
    pub recent_session_label: Option<String>,
}

forward_command!(native_platform_status("platformStatus") -> PlatformStatus);
forward_command!(native_capabilities("capabilities") -> CapabilityMatrix);
forward_command!(native_notification_status("notificationStatus") -> NotificationStatus);
forward_command!(
    native_request_notification_permission("requestNotificationPermission") -> NotificationStatus
);
forward_command!(
    native_post_notification("postNotification", PostNotificationRequest) -> NotificationPosted
);
forward_command!(native_push_status("pushStatus") -> PushStatus);
forward_command!(
    native_push_register_local("pushRegisterLocal", PushRegisterRequest) -> PushStatus
);
forward_command!(native_background_sync_status("backgroundSyncStatus") -> BackgroundSyncStatus);
forward_command!(
    native_background_sync_set("backgroundSyncSet", BackgroundSyncSetRequest) -> BackgroundSyncStatus
);
forward_command!(
    native_background_sync_run_now("backgroundSyncRunNow") -> BackgroundSyncStatus
);
forward_command!(native_share_consume_pending("shareConsumePending") -> SharePending);
forward_command!(
    native_share_outbound("shareOutbound", ShareOutboundRequest) -> ShareLaunched
);
forward_command!(native_deep_link_consume_pending("deepLinkConsumePending") -> DeepLinkPending);
forward_command!(native_biometric_status("biometricStatus") -> BiometricStatus);
forward_command!(native_biometric_enable("biometricEnable") -> BiometricStatus);
forward_command!(native_biometric_unlock("biometricUnlock") -> BiometricUnlock);
forward_command!(native_biometric_lock_now("biometricLockNow") -> BiometricStatus);
forward_command!(native_biometric_disable("biometricDisable") -> BiometricStatus);
forward_command!(native_vault_put("vaultPut", VaultPutRequest) -> VaultValue);
forward_command!(native_vault_get("vaultGet", VaultKeyRequest) -> VaultValue);
forward_command!(native_vault_delete("vaultDelete", VaultKeyRequest) -> VaultValue);
forward_command!(native_pick_images("pickImages", PickRequest) -> PickedUris);
forward_command!(native_pick_document("pickDocument") -> PickedUris);
forward_command!(native_capture_photo("capturePhoto") -> PickedUris);
forward_command!(native_scan_qr("scanQr") -> QrScanResult);
forward_command!(native_decode_qr_image("decodeQrImage", UriRequest) -> QrScanResult);
forward_command!(
    native_save_to_downloads("saveToDownloads", SaveDownloadRequest) -> DownloadedFile
);
forward_command!(native_open_with("openWith", OpenWithRequest) -> OpenWithResult);
forward_command!(
    native_read_image_base64("readImageBase64", UriRequest) -> PickedImageData
);
forward_command!(native_clipboard_read("clipboardRead") -> ClipboardRead);
forward_command!(
    native_clipboard_write("clipboardWrite", ClipboardWriteRequest) -> ClipboardWrite
);
forward_command!(native_haptic("haptic", HapticRequest) -> HapticResult);
forward_command!(native_insets_snapshot("insetsSnapshot") -> InsetsSnapshot);
forward_command!(native_layout_status("layoutStatus") -> LayoutStatus);
forward_command!(
    native_refresh_shortcuts("refreshShortcuts", ShortcutsRefreshRequest) -> ShortcutsResult
);
forward_command!(native_text_selection_noop("textSelectionNoop") -> ClipboardWrite);

#[tauri::command]
pub async fn native_settings_get(
    bridge: State<'_, NativeBridge>,
    args: SettingsGetRequest,
) -> Result<SettingsSnapshot, NativeError> {
    bridge
        .call("settingsGet", serde_json::to_value(args).map_err(|error| NativeError::native(error.to_string()))?)
        .await
}

#[tauri::command]
pub async fn native_settings_set(
    bridge: State<'_, NativeBridge>,
    args: SettingsSetRequest,
) -> Result<SettingsSnapshot, NativeError> {
    bridge
        .call("settingsSet", serde_json::to_value(args).map_err(|error| NativeError::native(error.to_string()))?)
        .await
}

/// Register a JavaScript channel for one native event.
///
/// `src/lib/native.ts` creates a `Channel` and calls this command. The channel is
/// registered in the Rust IPC layer and forwarded to Kotlin, which sends
/// `trigger(event, payload)` messages back through it. Using an app command
/// instead of `addPluginListener` avoids the plugin ACL for an in-tree plugin.
#[tauri::command]
pub async fn native_register_listener(
    bridge: State<'_, NativeBridge>,
    event: String,
    handler: Channel<Value>,
) -> Result<(), NativeError> {
    bridge
        .call(
            "registerListener",
            json!({ "event": event, "handler": handler }),
        )
        .await
}

#[tauri::command]
pub async fn native_remove_listener(
    bridge: State<'_, NativeBridge>,
    event: String,
    channel_id: i64,
) -> Result<(), NativeError> {
    bridge
        .call(
            "removeListener",
            json!({ "event": event, "channelId": channel_id }),
        )
        .await
}

/// Synchronous probe used by `lib.rs` before the webview exists.
pub fn platform_supports_native() -> bool {
    cfg!(target_os = "android")
}

/// Build the plugin that registers the Kotlin class on Android.
///
/// Commands live on the app's own invoke handler, not on this plugin. Tauri's
/// plugin ACL requires a generated permission set for every plugin command, and
/// this app does not ship a permission schema for an in-tree plugin: registering
/// the commands at the app level keeps the ACL out of the way while the plugin
/// still owns the mobile `register_android_plugin` hook.
pub fn plugin() -> TauriPlugin<Wry> {
    PluginBuilder::new(PLUGIN_NAME)
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api
                    .register_android_plugin(ANDROID_PACKAGE, ANDROID_CLASS)
                    .map_err(|error| {
                        format!(
                            "could not register the Android native bridge ({ANDROID_CLASS}): {error}"
                        )
                    })?;
                app.manage(NativeBridge::new(Some(handle)));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(NativeBridge::new(None));
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_command_names_stay_unique() {
        // A duplicate name would make one Kotlin method unreachable.
        let names = [
            "platformStatus",
            "capabilities",
            "settingsGet",
            "settingsSet",
            "notificationStatus",
            "requestNotificationPermission",
            "postNotification",
            "pushStatus",
            "pushRegisterLocal",
            "backgroundSyncStatus",
            "backgroundSyncSet",
            "backgroundSyncRunNow",
            "shareConsumePending",
            "shareOutbound",
            "deepLinkConsumePending",
            "biometricStatus",
            "biometricEnable",
            "biometricUnlock",
            "biometricLockNow",
            "biometricDisable",
            "vaultPut",
            "vaultGet",
            "vaultDelete",
            "pickImages",
            "pickDocument",
            "capturePhoto",
            "scanQr",
            "decodeQrImage",
            "saveToDownloads",
            "openWith",
            "readImageBase64",
            "clipboardRead",
            "clipboardWrite",
            "haptic",
            "insetsSnapshot",
            "layoutStatus",
            "refreshShortcuts",
            "textSelectionNoop",
        ];
        let unique: std::collections::BTreeSet<_> = names.iter().collect();
        assert_eq!(unique.len(), names.len());
    }

    #[test]
    fn post_notification_request_uses_camel_case() {
        let request: PostNotificationRequest = serde_json::from_value(json!({
            "kind": "turn_complete",
            "title": "Turn complete",
            "body": "Ready",
            "sessionId": "sess-1",
            "turnId": "turn-9"
        }))
        .expect("request should deserialize");
        assert_eq!(request.session_id.as_deref(), Some("sess-1"));
        assert_eq!(request.turn_id.as_deref(), Some("turn-9"));
    }

    #[test]
    fn background_sync_set_accepts_optional_fields() {
        let request: BackgroundSyncSetRequest =
            serde_json::from_value(json!({ "enabled": true })).expect("minimal request");
        assert!(request.enabled);
        assert!(request.interval_minutes.is_none());
        assert!(request.base_url.is_none());
    }

    #[test]
    fn notification_status_decodes_platform_payload() {
        let status: NotificationStatus = serde_json::from_value(json!({
            "permission": "granted",
            "notificationsEnabled": true,
            "group": "dev.jcode.stillness.turns",
            "channels": [
                { "id": "turns_complete", "name": "Turn complete", "importance": 3, "enabled": true }
            ]
        }))
        .expect("platform payload");
        assert_eq!(status.permission, "granted");
        assert_eq!(status.channels.len(), 1);
        assert_eq!(status.channels[0].importance, 3);
    }

    #[test]
    fn missing_optional_fields_default_instead_of_failing() {
        let status: BackgroundSyncStatus =
            serde_json::from_value(json!({ "enabled": false })).expect("partial payload");
        assert!(!status.enabled);
        assert_eq!(status.interval_minutes, 0);
        assert!(status.last_run_at.is_none());
    }

    #[test]
    fn capability_states_are_snake_case() {
        let matrix = CapabilityMatrix {
            push: CapabilityState::NotConfigured,
            qr_camera: CapabilityState::Blocked,
            notifications: CapabilityState::Available,
            ..Default::default()
        };
        let value = serde_json::to_value(&matrix).expect("serialize");
        assert_eq!(value["push"], "not_configured");
        assert_eq!(value["qrCamera"], "blocked");
        assert_eq!(value["notifications"], "available");
        assert_eq!(value["widget"], "unknown");
    }

    #[test]
    fn picked_image_data_decodes_platform_payload() {
        let data: PickedImageData = serde_json::from_value(json!({
            "status": "ok",
            "mimeType": "image/png",
            "name": "shot.png",
            "size": 8,
            "base64": "iVBORw0KGgo=",
            "error": null
        }))
        .expect("image payload");
        assert_eq!(data.status, "ok");
        assert_eq!(data.size, Some(8));
        assert_eq!(data.mime_type.as_deref(), Some("image/png"));

        let too_large: PickedImageData = serde_json::from_value(json!({
            "status": "too_large",
            "error": "exceeds_4_mib"
        }))
        .expect("partial image payload");
        assert!(too_large.base64.is_none());
        assert_eq!(too_large.status, "too_large");
    }

    #[test]
    fn native_error_serializes_code_and_message() {
        let error = NativeError::unsupported_platform("linux");
        let value = serde_json::to_value(&error).expect("serialize");
        assert_eq!(value["code"], "unsupported_platform");
        assert!(value["message"].as_str().unwrap().contains("linux"));
    }

    #[test]
    fn bridge_without_handle_reports_unsupported_platform() {
        let bridge = NativeBridge::new(None);
        let error = bridge
            .call_blocking::<PlatformStatus>("platformStatus", json!({}))
            .expect_err("desktop bridge must not pretend to work");
        assert_eq!(error.code, "unsupported_platform");
    }

    #[test]
    fn platform_probe_matches_target() {
        assert_eq!(platform_supports_native(), cfg!(target_os = "android"));
    }
}
