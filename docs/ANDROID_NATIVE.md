# Android native integration

Status: implemented on `feat/android-native`, verified on an API 36 arm64 emulator.
Last updated: 2026-11-14.

This document covers the Android platform layer only. The daemon and the adapter
stay on the VPS. The phone is a client: it observes turns, posts local
notifications, and performs a bounded background health check. Nothing here
moves execution onto the device.

## Architecture

| Layer | Location | Role |
| --- | --- | --- |
| TypeScript API | `apps/stillness/src/lib/native.ts` | Typed wrapper over Tauri commands |
| TypeScript types | `apps/stillness/src/lib/native-types.ts` | Mirrors the Rust and Kotlin payloads |
| Rust contract | `apps/stillness/src-tauri/src/native_android.rs` | Typed request and response structs, explicit error codes |
| Rust registration | `apps/stillness/src-tauri/src/lib.rs` | App-level invoke handler plus the `android-native` plugin |
| Kotlin bridge | `gen/android/app/src/main/java/dev/jcode/stillness/native/` | Real platform APIs |
| Activity host | `gen/android/app/src/main/java/dev/jcode/stillness/MainActivity.kt` | Insets, IME, back, inbound intents |

Why the commands are app-level: Tauri v2 checks every *plugin* command against a
generated ACL permission set. This plugin is in-tree and has no generated
permission schema, so plugin commands would fail with "Plugin not found". The
`android-native` plugin still exists because it owns
`register_android_plugin`, which is the only way to construct the Kotlin
bridge. The commands are registered by the app's own `invoke_handler`, the same
mechanism the existing credential commands use.

The Kotlin class is registered as package `dev.jcode.stillness.native` plus the
simple class name `NativeBridgePlugin`. Passing a fully qualified class name
double-prefixes the package and the app aborts at startup.

Errors are explicit. Rust returns `{ code, message }`, preserving the Kotlin
`invoke.reject(message, code)` code instead of collapsing everything into
`native_error`. Off Android every command returns
`unsupported_platform`, never a plausible default.

Typed results are camelCase on the wire. Request structs that take arguments
arrive as `{ args: { ... } }`, matching the Rust command signatures.

## File map

| File | Contents |
| --- | --- |
| `native_android.rs` | Plugin registration, typed structs, commands, 10 unit tests |
| `NativeBridgePlugin.kt` | The Kotlin `@Command` surface |
| `Notifications.kt` | Channels, permission state, grouping, deep-linked taps |
| `PushRegistration.kt` | Registration store and non-exported relay receiver |
| `BackgroundSync.kt` | WorkManager worker and schedule control |
| `Share.kt` | Inbound queue and outbound chooser |
| `DeepLinks.kt` | `jcode-mobile://` queue and parsing |
| `BiometricLock.kt` | BiometricPrompt gate and lock state |
| `SecretVault.kt` | Android Keystore AES-GCM secret storage |
| `Pickers.kt` | Photo Picker, SAF, camera capture |
| `QrScanner.kt` | ZXing decode from a captured or picked image |
| `ImageGuard.kt` | Pure 4 MiB and `image/*` guards (unit tested) |
| `ImageReader.kt` | Base64 image read for adapter attachments |
| `Downloads.kt` | MediaStore downloads and open-with |
| `ClipboardHaptics.kt` | Privacy-safe clipboard and HapticFeedbackConstants |
| `LayoutState.kt` | Edge-to-edge and IME inset application |
| `Launchers.kt` | Dynamic shortcuts, home widget, Quick Settings tile |
| `NativeSettings.kt` | Typed SharedPreferences surface |
| `NativeEvents.kt` | Event fan-out to the JavaScript channel |
| `MainActivity.kt` | Insets, IME resize, back dispatch, intent routing |

## JavaScript surface

Install once from the app shell after credential initialization:

```ts
import { installNativeBridge } from './lib/native';

const native = await installNativeBridge({
  onDeepLink: (link) => navigateToSession(link.sessionId),
  onShareInbound: () => refreshSharedDraft(),
  onLockStateChanged: (status) => setLocked(status.locked),
  onInsetsChanged: (layout) => applySafeArea(layout.insets),
  onBack: () => sheetOpen, // true consumes the gesture
});
```

`installNativeBridge` returns `null` off Android. It consumes any pending deep
link and inbound share before returning, so startup does not race the first
event. Every listener is registered through a `Channel` passed to
`native_register_listener`. `setNativeBackHandler` is exported separately for
screens that need to change the back behavior later.

| TypeScript | Command | Result |
| --- | --- | --- |
| `platformStatus()` | `native_platform_status` | platform, API level, model, version |
| `capabilities()` | `native_capabilities` | per-feature capability state and reasons |
| `getSettings()` | `native_settings_get` | typed settings snapshot |
| `setSettings()` | `native_settings_set` | stored values for the changed keys |
| `notificationStatus()` | `native_notification_status` | permission, enabled, channels |
| `requestNotificationPermission()` | `native_request_notification_permission` | status after the system prompt |
| `postNotification()` | `native_post_notification` | posted, id, channel, error |
| `pushStatus()` | `native_push_status` | always `not_configured` today |
| `registerPushToken()` | `native_push_register_local` | stored token, still `not_configured` |
| `backgroundSyncStatus()` | `native_background_sync_status` | schedule and last probe result |
| `setBackgroundSync()` | `native_background_sync_set` | reschedules or cancels WorkManager |
| `runBackgroundSyncNow()` | `native_background_sync_run_now` | queued one-shot |
| `consumePendingShare()` | `native_share_consume_pending` | items and discarded count, then clears |
| `shareOutbound()` | `native_share_outbound` | launched, target, error |
| `consumePendingDeepLink()` | `native_deep_link_consume_pending` | URL, action, session id |
| `biometricStatus()` | `native_biometric_status` | enabled, locked, available, secret |
| `enableBiometricLock()` | `native_biometric_enable` | status after authentication |
| `unlockWithBiometrics()` | `native_biometric_unlock` | approved, cancelled, unavailable |
| `lockNow()` | `native_biometric_lock_now` | locked status |
| `disableBiometricLock()` | `native_biometric_disable` | disabled status |
| `vaultPut/Get/Delete()` | `native_vault_*` | present, value |
| `pickImages(max)` | `native_pick_images` | picked URIs or cancelled |
| `pickDocument()` | `native_pick_document` | picked URI or cancelled |
| `capturePhoto()` | `native_capture_photo` | camera output URI |
| `scanQr()` | `native_scan_qr` | decoded, cancelled, unreadable |
| `decodeQrImage(uri)` | `native_decode_qr_image` | decoded text and format |
| `readPickedImage(uri)` | `native_read_image_base64` | status, MIME, name, size, base64 |
| `saveToDownloads()` | `native_save_to_downloads` | saved or explicit failure |
| `openWith()` | `native_open_with` | launched or explicit failure |
| `clipboardRead/Write()` | `native_clipboard_*` | text or a redaction reason |
| `haptic(kind)` | `native_haptic` | performed and reason |
| `insetsSnapshot()` | `native_insets_snapshot` | current insets |
| `layoutStatus()` | `native_layout_status` | edge-to-edge, IME, back strategy |
| `refreshShortcuts()` | `native_refresh_shortcuts` | shortcut ids and widget state |
| `textSelectionNoop()` | `native_text_selection_noop` | no-op, never touches selection |

Events: `deepLink`, `shareInbound`, `lockStateChanged`, `insetsChanged`,
`backgroundSyncChanged`.

## Attachments (#49, #64)

`pickImages()` returns content URIs. The adapter needs bytes, so
`readPickedImage(uri)` reads one image and returns:

```ts
type PickedImageStatus = 'ok' | 'too_large' | 'unsupported_type' | 'unreadable';

interface PickedImageData {
  status: PickedImageStatus;
  mimeType: string | null;
  name: string | null;
  size: number | null;   // decoded bytes
  base64: string | null; // null unless status is ok
  error: string | null;
}
```

Rules enforced natively:

- The URI must be `content:` or `file:`.
- The resolved MIME must start with `image/`. When the provider reports no type,
  the reader falls back to the file extension.
- The decoded size is capped at 4 MiB. The check happens before base64 encoding.
- Failure statuses carry a machine reason (`exceeds_4_mib`, `not_an_image`,
  `stream_unavailable`, and similar).
- Image bytes are never logged.

The caller then forwards `{ name, mediaType: mimeType, size, dataBase64: base64 }`
to `controller.addAttachment`. The adapter remains responsible for attachment
count, type, size, and magic-byte validation.

## Notifications (#61)

| Channel id | Name | Importance |
| --- | --- | --- |
| `turns_complete` | Turn complete | 3 (default) |
| `turn_failures` | Turn failures | 4 (high) |
| `approval_needed` | Approval needed | 4 (high) |

- Android 13 `POST_NOTIFICATIONS` is requested through the Tauri permission
  callback. The status distinguishes `granted`, `denied`, `prompt`, and
  `unsupported`.
- Notifications are grouped under `dev.jcode.stillness.turns` with a summary.
- Notification ids are stable per session and channel, so a newer turn replaces
  the older notification for that session.
- `notificationPreviews` off replaces the body with "Open JCode to view the
  result" before posting.
- Tapping opens `jcode-mobile://session/<id>` (or `new-session`). The activity
  queues the link, emits `deepLink` when a listener exists, and
  `deep_link_consume_pending` returns it for clients that started later.
- Delivery is local. The client posts when it observes a turn, failure, or
  approval request. Nothing claims remote delivery.

## Push (#60)

Delivery is **not wired**. There is no Firebase dependency, no
`FirebaseMessagingService`, and no `google-services.json` in this build. The
honest state is `not_configured`, and `pushStatus()` always returns it.

What exists:

- `PushRegistration` is a durable store for a device token and registration
  timestamp.
- `PushRelayReceiver` is a non-exported `BroadcastReceiver` for action
  `dev.jcode.stillness.PUSH_RELAY`. It accepts `token` plus `kind`, `title`,
  `body`, `sessionId`, and `turnId`. It rejects a missing or mismatched token.
- Registering a token never flips the state to configured. A token alone does
  not prove delivery.

To make delivery real you need a Firebase project, `google-services.json`, the
Firebase BOM plus `firebase-messaging`, a service that translates
`onMessageReceived` into the relay action, and a server-side sender. Until then
the UI must show `not_configured` and explain that delivery is unverified.

## Background sync (#59)

- WorkManager `PeriodicWorkRequest`, unique name `jcode-background-sync`.
- Interval is clamped to 15 to 1440 minutes. The default is 30.
- Constraint: `requiresBatteryNotLow`. WorkManager owns Doze and maintenance
  windows. There is no foreground service and no infinite polling.
- The worker performs exactly one unauthenticated `GET <baseUrl>/health` with an
  8 second connect timeout, an 8 second read timeout, no redirects, and a 64 KiB
  response cap. It records status, HTTP code, last error, protocol, and the base
  URL.
- `baseUrl` is a non-secret adapter URL stored in the same preferences. The
  worker never reads the adapter bearer token.
- `runBackgroundSyncNow` enqueues a one-shot request and reports `queued: true`.
  It does not report completion.
- The worker returns success even when the probe fails, and records the failure
  instead of retrying in a tight loop.

**Scope limit:** the probe only proves the adapter and daemon link health. It
does not reconcile sessions, because session v2 lives on an authenticated
WebSocket. A real background session reconciliation would need a new
authenticated endpoint and a credential the worker can read safely. That is not
implemented and must not be claimed.

## Sharesheet (#62)

Inbound filters: `ACTION_SEND` for `text/plain`, `image/*`, `application/*`, and
`ACTION_SEND_MULTIPLE` for text and images.

- Text and URLs are classified (`text` or `url`).
- Streams are copied into `cache/share-in` under a 25 MiB per-item bound and a
  5 item per-intent bound. The returned URI is an app FileProvider URI, so the
  webview does not depend on a transient grant.
- The queue holds at most 10 items. Overflow and unreadable streams increase the
  `discarded` count instead of disappearing silently.
- Outbound uses `ACTION_SEND` plus `Intent.createChooser`. Content URIs are
  shared with `FLAG_GRANT_READ_URI_PERMISSION` and a `ClipData` entry.

## Biometric lock (#63)

- AndroidX `BiometricPrompt` with `BIOMETRIC_WEAK or DEVICE_CREDENTIAL` on
  Android 11 and newer. Older releases use biometrics only, and a device with no
  enrolled biometric reports unavailable rather than unlocking implicitly.
- The lock secret is a random value encrypted with an Android Keystore AES-GCM
  key (`SecretVault`). The keystore key is not user-authentication-bound, because
  `BiometricPrompt` cannot combine `CryptoObject` with `DEVICE_CREDENTIAL`.
  The authentication gate and the keystore secret are therefore separate, and
  this document says so instead of claiming hardware-bound key release.
- `lockNow` sets the persisted locked state and emits `lockStateChanged`.
- `disable` clears the state and deletes the vault secret.
- The adapter bearer token is **not** stored here. It stays in the OS credential
  store through the existing `android-keyring` crate.
- What this protects: secrets at rest from other apps and raw preference dumps.
  What it does not protect: a rooted or compromised device while the app is
  running.

## Pickers, camera, QR (#64, #49)

- Photo Picker (`MediaStore.ACTION_PICK_IMAGES`) on Android 13 and newer, with
  `ACTION_OPEN_DOCUMENT` as the fallback. No storage permission is requested.
- Storage Access Framework document picker with a persistable grant attempt.
- Camera capture uses `ACTION_IMAGE_CAPTURE` with a FileProvider output URI.
  There is no `CAMERA` permission and no camera preview of our own.
- QR decoding uses ZXing core (`com.google.zxing:core:3.5.3`) on an image
  returned by the camera activity or an image URI. A failed decode reports
  `unreadable`, never a fabricated pairing value.
- The QR camera leg is blocked on the API 36 emulator image because no camera
  activity resolves there. The capability matrix reports `qrCamera: blocked`
  with that reason. The image-decode leg is verified (`QR_CODE`,
  `jcode-pair://ABC123-DEV`).

## Downloads and open-with (#65)

- API 29 and newer: `MediaStore.Downloads` into `Download/JCode`, with
  `IS_PENDING` handling and no storage permission.
- API 24 to 28: writes into the app-specific external Downloads directory and
  shares through the FileProvider. `WRITE_EXTERNAL_STORAGE` is not requested.
- Payload bound: 24 MiB decoded, 32 MiB base64 input, explicit `too_large` or
  `invalid_base64` failures.
- `openWith` uses `ACTION_VIEW` with a read grant. When no activity resolves it
  returns `launched: false` with `no_activity_handles_this_file` rather than
  claiming success.

## Clipboard and haptics (#68)

- Clipboard reads require window focus on Android 10 and newer. Without focus
  the result is `available: false`, `reason: app_not_focused`.
- Content flagged `EXTRA_IS_SENSITIVE` is redacted when
  `privacyClipboardRedact` is on (the default). Writes can mark content
  sensitive on Android 13 and newer.
- Haptics map `light`, `medium`, `heavy`, `success`, and `error` to
  `HapticFeedbackConstants`. The app toggle and the system haptic and ringer
  settings are checked first. A refused call returns the reason.
- `textSelectionNoop` exists for the selection seam. It touches nothing, so
  native long-press selection keeps working.

## Lifecycle, insets, and back (#66)

- `enableEdgeToEdge` plus `WindowCompat.setDecorFitsSystemWindows(false)`.
- System bar and cutout insets are applied as **margins** on the WebView. Padding
  is not reliable because the WebView renders through its own surface.
- The IME inset is added to the bottom margin when the keyboard is visible. On
  the emulator the CSS viewport shrank from 839 to 527 CSS pixels, so the focused
  field stayed above the keyboard. `adjustResize` remains declared.
- Insets changes are emitted as `insetsChanged` and are also readable through
  `layoutStatus()`.
- Back goes through the AndroidX `OnBackPressedDispatcher`. On API 33+ the
  framework bridges it to predictive back. The activity calls
  `window.__jcodeBackHandler()` with an 800 ms deadline. A `true` answer keeps
  the app open, an explicit `false` or a timeout finishes it. A separate direct
  `OnBackInvokedCallback` is wrong here: `ComponentActivity` already installs
  one and would preempt it.
- `android:configChanges` covers orientation, keyboard, screen size, density,
  font scale, navigation, and UI mode. Rotation was verified to keep the same
  process and WebView (pid unchanged, viewport 863 by 360 in landscape).

## Shortcuts, widget, tile (#67)

- Dynamic shortcuts: the native shell requests publication of generic
  `new-session` and `sessions` shortcuts. Launcher limits or rate limiting can
  prevent publication. These routes have no session title or token.
  The old `recent-session` shortcut is disabled on refresh because its link
  contains no server identity. A previously pinned shortcut may retain its old
  label in the launcher until the user removes it. Last-session shortcuts remain
  blocked on end-to-end server-scoped routing. This revision's launcher behavior
  has not been verified on an Android device.
- Home widget: a plain `RemoteViews` provider (`StillnessWidgetProvider`) with a
  dark 110 by 40 dp card that opens a new session. The provider is registered
  and the provider XML parses. Placement on a launcher is **not verified**,
  because there is no reliable shell path to add a widget and launcher UI
  automation was out of scope.
- Quick Settings tile: `NewSessionTileService`, protected by
  `BIND_QUICK_SETTINGS_TILE`, with lock-screen handling through `unlockAndRun`.
  Verified: it appears in the QS panel and tapping it queued
  `jcode-mobile://new-session`.

## Settings surface (#76)

Native keys, all persisted in `jcode_native_settings` and validated on write:

| Key | Type | Default | Behavior it controls |
| --- | --- | --- | --- |
| `notificationsEnabled` | boolean | true | Blocks local notification posting |
| `backgroundSyncEnabled` | boolean | false | Schedules or cancels WorkManager |
| `backgroundSyncIntervalMinutes` | integer | 30 | Clamped to 15 to 1440 |
| `notificationPreviews` | boolean | true | Redacts notification bodies |
| `hapticsEnabled` | boolean | true | Blocks haptic requests |
| `motion` | string | `full` | `full` or `reduced` |
| `privacyClipboardRedact` | boolean | true | Redacts sensitive clipboard reads |

Unknown keys and wrong types are rejected with code `invalid_setting`. The
returned snapshot contains the values that were actually stored, so the UI
cannot show a toggle that did not take effect.

## Permissions

| Permission | Why |
| --- | --- |
| `INTERNET` | Adapter WebSocket and health probe |
| `POST_NOTIFICATIONS` | Local turn notifications on Android 13+ |
| `USE_BIOMETRIC` | Biometric prompt |
| `VIBRATE` | Haptic feedback |
| `WAKE_LOCK`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` | Merged by WorkManager, not requested by app code |

No `CAMERA`, no storage permissions, no location, no contacts, no
`QUERY_ALL_PACKAGES`.

## Verification

Environment: macOS, JDK 24 at
`/Library/Java/JavaVirtualMachines/jdk-24.jdk`, Android SDK at
`$HOME/.local/android-toolchain/sdk`, Gradle 9.6.1, API 36 arm64 emulator.

Builds and tests run:

```sh
cd apps/stillness && bun run build
# tsc --noEmit and vite build pass

cd apps/stillness/src-tauri && cargo test
# 10 passed, 0 failed

cd apps/stillness/src-tauri/gen/android
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-24.jdk/Contents/Home \
  ./gradlew :app:testUniversalDebugUnitTest \
  --tests dev.jcode.stillness.native.ImageGuardTest
# 4 tests, 0 failures

cd apps/stillness
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-24.jdk/Contents/Home \
  ANDROID_HOME=$HOME/.local/android-toolchain/sdk \
  CI=true node_modules/.bin/tauri android build --debug --apk --target aarch64
# Finished 1 APK
```

Runtime evidence on the emulator (`dev.jcode.stillness`, API 36):

| Check | Result |
| --- | --- |
| Platform command | `android`, API 36, `edgeToEdge: true`, `predictiveBack: true` |
| Notification channels | `turns_complete` importance 3, `turn_failures` and `approval_needed` importance 4 |
| Permission prompt | System dialog shown, `Allow` tapped, status returned `granted` |
| Notification post | `dumpsys notification` shows the grouped child and summary, correct channel and text |
| Preview redaction | Body became `Open JCode to view the result.` with previews off |
| Permission denied | `permission_denied`, no notification |
| Deep link | `jcode-mobile://session/sess-deep-link-42` consumed with `open_session` |
| Inbound share text and URL | Captured and classified `text` and `url` |
| Inbound share image and file | Copied to the cache, returned FileProvider URIs, sizes 2957 and 12 |
| Outbound share | Android chooser opened (`ChooserActivityLauncher`) |
| Background sync | Periodic job scheduled with `batteryNotLow=true`, next run about 14m45s |
| Background probe | `GET /health` returned 200, status `connected`, protocol recorded |
| Biometric lock | Device credential enabled, `lockNow`, `unlock` returned `approved` |
| Keystore vault | Put, get, delete round trip for a test value |
| Photo picker | `com.google.android.photopicker` opened, cancel returned `cancelled` |
| QR image decode | `jcode-pair://ABC123-DEV`, format `QR_CODE` |
| Image read | 2957-byte PNG returned `ok`, 5 MiB PNG `too_large`, text `unsupported_type` |
| Download | `Download/JCode/qr-test.png`, 2957 bytes on disk |
| Open with | No handler on the emulator, returned `launched: false` |
| Clipboard | Write and read round trip, sensitive content redacted |
| Haptics | `performed: true` when enabled, `haptics_disabled_in_app` when off |
| Insets | Top 136, bottom 63, applied as margins, content clear of the status bar |
| IME | `imeBottom` 883, CSS viewport 839 to 527, focused field above the keyboard |
| Back | Handler `true` kept the app open, `false` finished it, timeout path present |
| Rotation | Same pid, viewport 863 by 360, WebView preserved |
| Quick Settings tile | Visible in the panel, tap queued `jcode-mobile://new-session` |
| Dynamic shortcuts | `new-session` and `recent-session` present in `dumpsys shortcut` |

Not verified or blocked:

- **FCM delivery:** blocked by missing Firebase credentials and dependency.
  `pushStatus` stays `not_configured`.
- **Camera capture and camera QR:** blocked on this emulator image because no
  camera activity resolves. The capability matrix reports `camera: unavailable`
  and `qrCamera: blocked` with the reason. The image-decode path is verified.
- **Home widget placement:** the provider and layout are implemented and
  registered, but launcher placement is NOT_RUN.
- **Physical device:** NOT_RUN. All runtime evidence is from the emulator.
- **Biometric hardware:** the emulator has no enrolled biometric, so the tested
  path is the device-credential fallback on Android 11+. Fingerprint or face
  enrollment needs a human or a configured emulator fingerprint.
- **Authenticated background session reconciliation:** not implemented, see the
  background sync scope limit.

## Rebuild notes

- `local.properties` must point at a real SDK. It is gitignored and not
  committed.
- Only JDK 24 is installed on this host. Gradle 9.6.1 and AGP 9.3.1 build with
  it, with deprecation warnings for source and target 8.
- `:app:compileDebugKotlin` is ambiguous because the Tauri project has ABI
  flavors. Use `:app:compileUniversalDebugKotlin` or
  `:app:compileArmDebugKotlin`.
- The APK is debug-signed and large because it is a universal debug build with
  all ABIs and symbols. Release packaging is the repository's existing
  `scripts/build-android-release.sh` path.
