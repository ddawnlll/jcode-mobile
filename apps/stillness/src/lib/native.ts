import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import {
  type BackgroundSyncStatus,
  type BiometricStatus,
  type BiometricUnlock,
  type CapabilityMatrix,
  type ClipboardRead,
  type ClipboardWrite,
  type DeepLinkPending,
  type DownloadedFile,
  type HapticKind,
  type HapticResult,
  type InsetsSnapshot,
  type LayoutStatus,
  type NativeEventMap,
  type NativeEventName,
  NativeBridgeError,
  type NotificationPosted,
  type NotificationStatus,
  type OpenWithResult,
  type PickedUris,
  type PlatformStatus,
  type PostNotificationRequest,
  type PushStatus,
  type QrScanResult,
  type SettingsKey,
  type SettingsSnapshot,
  type SettingsValue,
  type ShareLaunched,
  type ShareOutboundRequest,
  type SharePending,
  type ShortcutsResult,
  type VaultValue,
} from './native-types';

/**
 * Typed client for the Android native bridge.
 *
 * Native work happens in Kotlin (`dev.jcode.stillness.native.NativeBridgePlugin`).
 * The Rust `android-native` plugin registers that Kotlin class, and the Rust
 * commands themselves are app-level commands so an in-tree plugin does not need
 * a generated Tauri ACL permission set. Off Android every command replies with
 * an explicit `unsupported_platform` error, which callers receive as a
 * [NativeBridgeError]; nothing resolves with a fabricated success.
 *
 * This module is additive and does not change any existing screen. Wire it in
 * with [installNativeBridge] from the app shell.
 */


export interface NativeBridgeHandlers {
  onDeepLink?: (link: DeepLinkPending) => void;
  onShareInbound?: (payload: NativeEventMap['shareInbound']) => void;
  onLockStateChanged?: (status: BiometricStatus) => void;
  onInsetsChanged?: (status: LayoutStatus) => void;
  onBackgroundSyncChanged?: (status: BackgroundSyncStatus) => void;
  /** Return true when the app consumed the back gesture. */
  onBack?: () => boolean;
}

export interface NativeBridgeSession {
  platform: PlatformStatus;
  capabilities: CapabilityMatrix;
  pendingDeepLink: DeepLinkPending;
  pendingShare: SharePending;
  layout: LayoutStatus;
  dispose(): void;
}

function normalizeError(raw: unknown): NativeBridgeError {
  if (raw instanceof NativeBridgeError) return raw;
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as { code?: unknown; message?: unknown };
    const code = typeof record.code === 'string' ? record.code : 'native_error';
    const message =
      typeof record.message === 'string' ? record.message : 'the native call failed';
    return new NativeBridgeError(code, message);
  }
  return new NativeBridgeError('native_error', String(raw));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new NativeBridgeError(
      'unsupported_platform',
      'the native bridge is only available inside the Android Tauri shell',
    );
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

export function isNativeBridgeError(error: unknown): error is NativeBridgeError {
  return error instanceof NativeBridgeError;
}

/** True when the platform reports an Android native bridge. */
export async function nativeBridgeAvailable(): Promise<boolean> {
  try {
    await platformStatus();
    return true;
  } catch (error) {
    if (isNativeBridgeError(error) && error.code === 'unsupported_platform') return false;
    return false;
  }
}

export function platformStatus(): Promise<PlatformStatus> {
  return call<PlatformStatus>('native_platform_status');
}

export function capabilities(): Promise<CapabilityMatrix> {
  return call<CapabilityMatrix>('native_capabilities');
}

export function getSettings(keys?: SettingsKey[]): Promise<SettingsSnapshot> {
  return call<SettingsSnapshot>('native_settings_get', { args: { keys: keys ?? [] } });
}

export function setSettings(
  values: Partial<Record<SettingsKey, SettingsValue>>,
): Promise<SettingsSnapshot> {
  return call<SettingsSnapshot>('native_settings_set', { args: { values } });
}

export function notificationStatus(): Promise<NotificationStatus> {
  return call<NotificationStatus>('native_notification_status');
}

export function requestNotificationPermission(): Promise<NotificationStatus> {
  return call<NotificationStatus>('native_request_notification_permission');
}

export function postNotification(request: PostNotificationRequest): Promise<NotificationPosted> {
  return call<NotificationPosted>('native_post_notification', { args: request });
}

export function pushStatus(): Promise<PushStatus> {
  return call<PushStatus>('native_push_status');
}

/**
 * Store a token produced by a future push transport. This never claims delivery:
 * the returned status stays `not_configured` until a real transport is present.
 */
export function registerPushToken(token: string): Promise<PushStatus> {
  return call<PushStatus>('native_push_register_local', { args: { token } });
}

export function backgroundSyncStatus(): Promise<BackgroundSyncStatus> {
  return call<BackgroundSyncStatus>('native_background_sync_status');
}

export function setBackgroundSync(input: {
  enabled: boolean;
  intervalMinutes?: number;
  baseUrl?: string | null;
}): Promise<BackgroundSyncStatus> {
  return call<BackgroundSyncStatus>('native_background_sync_set', {
    args: {
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
      baseUrl: input.baseUrl ?? null,
    },
  });
}

export function runBackgroundSyncNow(): Promise<BackgroundSyncStatus> {
  return call<BackgroundSyncStatus>('native_background_sync_run_now');
}

export function consumePendingShare(): Promise<SharePending> {
  return call<SharePending>('native_share_consume_pending');
}

export function shareOutbound(request: ShareOutboundRequest): Promise<ShareLaunched> {
  return call<ShareLaunched>('native_share_outbound', { args: request });
}

export function consumePendingDeepLink(): Promise<DeepLinkPending> {
  return call<DeepLinkPending>('native_deep_link_consume_pending');
}

export function biometricStatus(): Promise<BiometricStatus> {
  return call<BiometricStatus>('native_biometric_status');
}

export function enableBiometricLock(): Promise<BiometricStatus> {
  return call<BiometricStatus>('native_biometric_enable');
}

export function unlockWithBiometrics(): Promise<BiometricUnlock> {
  return call<BiometricUnlock>('native_biometric_unlock');
}

export function lockNow(): Promise<BiometricStatus> {
  return call<BiometricStatus>('native_biometric_lock_now');
}

export function disableBiometricLock(): Promise<BiometricStatus> {
  return call<BiometricStatus>('native_biometric_disable');
}

export function vaultPut(key: string, value: string): Promise<VaultValue> {
  return call<VaultValue>('native_vault_put', { args: { key, value } });
}

export function vaultGet(key: string): Promise<VaultValue> {
  return call<VaultValue>('native_vault_get', { args: { key } });
}

export function vaultDelete(key: string): Promise<VaultValue> {
  return call<VaultValue>('native_vault_delete', { args: { key } });
}

export function pickImages(max = 10): Promise<PickedUris> {
  return call<PickedUris>('native_pick_images', { args: { max } });
}

export function pickDocument(): Promise<PickedUris> {
  return call<PickedUris>('native_pick_document');
}

export function capturePhoto(): Promise<PickedUris> {
  return call<PickedUris>('native_capture_photo');
}

export function scanQr(): Promise<QrScanResult> {
  return call<QrScanResult>('native_scan_qr');
}

export function decodeQrImage(uri: string): Promise<QrScanResult> {
  return call<QrScanResult>('native_decode_qr_image', { args: { uri } });
}

export function saveToDownloads(input: {
  fileName: string;
  mimeType: string;
  base64: string;
}): Promise<DownloadedFile> {
  return call<DownloadedFile>('native_save_to_downloads', { args: input });
}

export function openWith(uri: string, mimeType?: string | null): Promise<OpenWithResult> {
  return call<OpenWithResult>('native_open_with', {
    args: { uri, mimeType: mimeType ?? null },
  });
}

export function clipboardRead(): Promise<ClipboardRead> {
  return call<ClipboardRead>('native_clipboard_read');
}

export function clipboardWrite(text: string, sensitive = false): Promise<ClipboardWrite> {
  return call<ClipboardWrite>('native_clipboard_write', { args: { text, sensitive } });
}

export function haptic(kind: HapticKind): Promise<HapticResult> {
  return call<HapticResult>('native_haptic', { args: { kind } });
}

export function insetsSnapshot(): Promise<InsetsSnapshot> {
  return call<InsetsSnapshot>('native_insets_snapshot');
}

export function layoutStatus(): Promise<LayoutStatus> {
  return call<LayoutStatus>('native_layout_status');
}

export function refreshShortcuts(
  recentSessionId?: string | null,
  recentSessionLabel?: string | null,
): Promise<ShortcutsResult> {
  return call<ShortcutsResult>('native_refresh_shortcuts', {
    args: {
      recentSessionId: recentSessionId ?? null,
      recentSessionLabel: recentSessionLabel ?? null,
    },
  });
}

/**
 * A deliberate no-op for the text-selection seam. It never touches the WebView
 * selection, so native long-press selection keeps working.
 */
export function textSelectionNoop(): Promise<ClipboardWrite> {
  return call<ClipboardWrite>('native_text_selection_noop');
}

/**
 * Subscribe to one Kotlin bridge event. Returns an unsubscribe function.
 *
 * A `Channel` is passed to the app-level `native_register_listener` command,
 * which forwards it to Kotlin. This avoids the Tauri plugin ACL, which would
 * otherwise require a generated permission set for an in-tree plugin.
 */
export async function onNativeEvent<K extends NativeEventName>(
  event: K,
  handler: (payload: NativeEventMap[K]) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const channel = new Channel<NativeEventMap[K]>();
  channel.onmessage = handler;
  await call<void>('native_register_listener', { event, handler: channel });
  const channelId = channel.id;
  return () => {
    void call<void>('native_remove_listener', { event, channelId }).catch(() => {});
  };
}

const backHandlerSlot = (): { __jcodeBackHandler?: () => boolean } =>
  window as unknown as { __jcodeBackHandler?: () => boolean };

/**
 * Install the back handler the Android activity calls before it finishes.
 * Returning true keeps the app open (for example when a sheet is open).
 */
export function setNativeBackHandler(handler: (() => boolean) | null): void {
  const slot = backHandlerSlot();
  if (handler) {
    slot.__jcodeBackHandler = handler;
  } else {
    delete slot.__jcodeBackHandler;
  }
}

/**
 * Install listeners and return the current native state.
 *
 * Returns null off Android. Call it once from the app shell after credentials
 * are initialized. Pending deep links and shares are returned so the caller can
 * navigate without racing the first event.
 */
export async function installNativeBridge(
  handlers: NativeBridgeHandlers = {},
): Promise<NativeBridgeSession | null> {
  try {
    const platform = await platformStatus();
    const [caps, pendingDeepLink, pendingShare, layout] = await Promise.all([
      capabilities(),
      consumePendingDeepLink().catch(() => emptyDeepLink()),
      consumePendingShare().catch(() => ({ items: [], discarded: 0 })),
      layoutStatus().catch(() => emptyLayout()),
    ]);
    const disposers: Array<() => void> = [];
    const listen = async <K extends NativeEventName>(
      event: K,
      handler?: (payload: NativeEventMap[K]) => void,
    ) => {
      if (!handler) return;
      try {
        disposers.push(await onNativeEvent(event, handler));
      } catch {
        // An event channel that cannot be registered must not break startup.
      }
    };
    await Promise.all([
      listen('deepLink', handlers.onDeepLink),
      listen('shareInbound', handlers.onShareInbound),
      listen('lockStateChanged', handlers.onLockStateChanged),
      listen('insetsChanged', handlers.onInsetsChanged),
      listen('backgroundSyncChanged', handlers.onBackgroundSyncChanged),
    ]);
    if (handlers.onBack) {
      setNativeBackHandler(handlers.onBack);
    }
    return {
      platform,
      capabilities: caps,
      pendingDeepLink,
      pendingShare,
      layout,
      dispose() {
        setNativeBackHandler(null);
        for (const dispose of disposers) dispose();
      },
    };
  } catch (error) {
    if (isNativeBridgeError(error) && error.code === 'unsupported_platform') return null;
    throw error;
  }
}

function emptyDeepLink(): DeepLinkPending {
  return { url: null, action: 'none', sessionId: null };
}

function emptyLayout(): LayoutStatus {
  const emptyInsets: InsetsSnapshot = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    imeBottom: 0,
    statusBar: 0,
    navBar: 0,
  };
  return {
    edgeToEdge: false,
    imeVisible: false,
    predictiveBack: false,
    backStrategy: 'back_dispatcher',
    insets: emptyInsets,
  };
}
