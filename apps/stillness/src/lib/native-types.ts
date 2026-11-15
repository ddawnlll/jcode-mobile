/**
 * Typed results for the Android native bridge.
 *
 * These interfaces mirror `src-tauri/src/native_android.rs` and the Kotlin
 * `@Command` payloads one-for-one. Keep all three in sync: a field renamed in one
 * place is a compile error or an explicit native error, never a silent default.
 */

export type CapabilityState =
  | 'available'
  | 'not_configured'
  | 'unavailable'
  | 'blocked'
  | 'unknown';

export interface CapabilityMatrix {
  notifications: CapabilityState;
  push: CapabilityState;
  backgroundSync: CapabilityState;
  shareIn: CapabilityState;
  shareOut: CapabilityState;
  biometricLock: CapabilityState;
  photoPicker: CapabilityState;
  documentPicker: CapabilityState;
  camera: CapabilityState;
  qrCamera: CapabilityState;
  qrImage: CapabilityState;
  downloads: CapabilityState;
  openWith: CapabilityState;
  clipboard: CapabilityState;
  haptics: CapabilityState;
  shortcuts: CapabilityState;
  widget: CapabilityState;
  quickSettingsTile: CapabilityState;
  reasons: Record<string, string>;
}

export interface PlatformStatus {
  platform: string;
  apiLevel: number;
  deviceModel: string;
  appVersion: string;
  edgeToEdge: boolean;
  predictiveBack: boolean;
}

export type SettingsValue = boolean | number | string;

export type SettingsKey =
  | 'notificationsEnabled'
  | 'backgroundSyncEnabled'
  | 'backgroundSyncIntervalMinutes'
  | 'notificationPreviews'
  | 'hapticsEnabled'
  | 'motion'
  | 'privacyClipboardRedact';

export interface SettingsSnapshot {
  values: Record<string, SettingsValue>;
}

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface NotificationChannelStatus {
  id: string;
  name: string;
  importance: number;
  enabled: boolean;
}

export interface NotificationStatus {
  permission: NotificationPermission;
  notificationsEnabled: boolean;
  channels: NotificationChannelStatus[];
  group: string;
}

export type NotificationKind =
  | 'turn_complete'
  | 'turn_failed'
  | 'approval_needed'
  | 'test';

export interface PostNotificationRequest {
  kind: NotificationKind;
  title?: string | null;
  body?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
}

export interface NotificationPosted {
  posted: boolean;
  id: number | null;
  channel: string | null;
  error: string | null;
}

export type PushState = 'not_configured' | 'registered';

export interface PushStatus {
  state: PushState;
  token: string | null;
  registeredAt: number | null;
  transport: string;
  reason: string;
}

export type BackgroundSyncState =
  | 'connected'
  | 'adapter_only'
  | 'http_error'
  | 'unreachable'
  | 'not_configured'
  | 'skipped';

export interface BackgroundSyncStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: number | null;
  lastStatus: BackgroundSyncState | null;
  lastError: string | null;
  lastHttpStatus: number | null;
  lastCheckedBaseUrl: string | null;
  lastProtocol: string | null;
  worker: 'periodic_work' | 'none';
  queued: boolean;
}

export type ShareKind = 'text' | 'url' | 'image' | 'file';

export interface ShareItem {
  kind: ShareKind;
  text: string | null;
  url: string | null;
  mimeType: string | null;
  fileName: string | null;
  uri: string | null;
  sizeBytes: number | null;
}

export interface SharePending {
  items: ShareItem[];
  discarded: number;
}

export interface ShareOutboundRequest {
  text?: string | null;
  url?: string | null;
  uri?: string | null;
  mimeType?: string | null;
  title?: string | null;
}

export interface ShareLaunched {
  launched: boolean;
  chooser: string | null;
  error: string | null;
}

export type DeepLinkAction = 'open_session' | 'new_session' | 'sessions' | 'unknown' | 'none';

export interface DeepLinkPending {
  url: string | null;
  action: DeepLinkAction | null;
  sessionId: string | null;
}

export interface BiometricStatus {
  enabled: boolean;
  locked: boolean;
  available: boolean;
  enrolled: boolean;
  method: 'biometric_or_device_credential' | 'biometric' | 'none';
  secretStored: boolean;
  message: string;
}

export interface BiometricUnlock {
  unlocked: boolean;
  status: 'approved' | 'cancelled' | 'unavailable' | 'not_enabled';
  message: string;
}

export interface VaultValue {
  present: boolean;
  value: string | null;
}

export type PickStatus = 'picked' | 'cancelled' | 'unavailable';

export interface PickedUris {
  status: PickStatus;
  uris: string[];
  mimeTypes: string[];
  error: string | null;
}

export type PickedImageStatus = 'ok' | 'too_large' | 'unsupported_type' | 'unreadable';

/**
 * A picked image read into base64 for `controller.addAttachment`.
 *
 * `size` is the decoded byte count; `base64` is null unless `status === 'ok'`.
 * The native reader enforces a 4 MiB decoded limit and an `image/*` type gate.
 */
export interface PickedImageData {
  status: PickedImageStatus;
  mimeType: string | null;
  name: string | null;
  size: number | null;
  base64: string | null;
  error: string | null;
}

export type QrStatus = 'decoded' | 'cancelled' | 'unreadable' | 'unavailable';

export interface QrScanResult {
  status: QrStatus;
  text: string | null;
  format: string | null;
  error: string | null;
}

export type DownloadStatus = 'saved_to_downloads' | 'stored_in_app_files' | 'failed';

export interface DownloadedFile {
  status: DownloadStatus;
  uri: string | null;
  displayName: string | null;
  location: string | null;
  error: string | null;
}

export interface OpenWithResult {
  launched: boolean;
  error: string | null;
}

export interface ClipboardRead {
  available: boolean;
  text: string | null;
  sensitive: boolean;
  reason: string | null;
}

export interface ClipboardWrite {
  written: boolean;
  error: string | null;
}

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'error';

export interface HapticResult {
  performed: boolean;
  kind: string;
  reason: string | null;
}

export interface InsetsSnapshot {
  top: number;
  right: number;
  bottom: number;
  left: number;
  imeBottom: number;
  statusBar: number;
  navBar: number;
}

export interface LayoutStatus {
  edgeToEdge: boolean;
  imeVisible: boolean;
  predictiveBack: boolean;
  backStrategy: 'predictive_callback' | 'back_dispatcher';
  insets: InsetsSnapshot;
}

export interface ShortcutsResult {
  count: number;
  ids: string[];
  widget: boolean;
  error: string | null;
}

/** Events the Kotlin side delivers through a Tauri plugin channel. */
export interface NativeEventMap {
  deepLink: DeepLinkPending;
  shareInbound: { count: number; dropped?: number };
  lockStateChanged: BiometricStatus;
  insetsChanged: LayoutStatus;
  backgroundSyncChanged: BackgroundSyncStatus;
}

export type NativeEventName = keyof NativeEventMap;

/** Error thrown by every wrapper in `native.ts`. */
export class NativeBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NativeBridgeError';
    this.code = code;
  }
}
