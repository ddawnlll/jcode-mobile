# JCode Mobile 0.3.0

JCode Mobile 0.3.0 is the Stillness 12 release. It replaces the Expo client
with a Tauri 2 client backed by the Rust Adapter v2, and ships an Android APK
alongside the native Linux build.

This is a development preview, not a Play Store release. The Android APK is
debug-signed for sideloading.

## Highlights

- **Rust Adapter v2.** One adapter process and one SQLite journal expose the
  authenticated mobile v2 API over the pinned JCode SDK and harness API.
  Sessions, operations, streaming snapshots, files, projects, and pairing live
  in `crates/adapter-*`.
- **Stillness 12 client.** The Tauri client in `apps/stillness` covers the
  mobile and desktop three-pane surfaces with saved drafts, delivery state,
  explicit Stop, stale-output fencing, and reduced-motion support.
- **Command Code provider.** The pinned JCode fork includes Command Code as a
  built-in provider. Live generation was verified against
  `deepseek/deepseek-v4-flash` with a real isolated daemon.
- **Android Keystore.** The Android build stores the device token with
  `android-keyring`; the credential survived a force-stop and relaunch. The
  desktop build uses the OS Secret Service.
- **JCode Mobile identity.** The Android launcher label is `JCode Mobile` and
  the adaptive icon matches the JCode Mobile mark.

## Android artifact

```text
jcode-mobile-0.3.0-android-release.apk
11,020,965 bytes
SHA-256 4a79ba0aeaf026949ecbdb57591fc7e18dd87fb47d10c67ff49bf03be63060d2
package dev.jcode.stillness
versionCode 3000, versionName 0.3.0
minSdk 24, targetSdk 37, compileSdk 37
ABIs arm64-v8a, armeabi-v7a
APK Signature Scheme v2 and v3, Android Debug certificate
```

Install with:

```sh
adb install -r jcode-mobile-0.3.0-android-release.apk
```

Verify the download with:

```sh
sha256sum jcode-mobile-0.3.0-android-release.apk
```

The package identifier is new. A clean install is expected; app data from the
Expo 0.2.2 package does not migrate, and 0.2.2 remains the previous release.

## What was verified

- 30 Rust adapter tests and `cargo fmt --all -- --check`.
- 14 legacy Jest suites / 139 tests, the root TypeScript typecheck, and
  repository-wide ESLint.
- Stillness typecheck, production Vite build, and lint.
- Real isolated JCode daemon plus curated SDK handshake.
- Playwright pairing, persistence, sessions, drafts, plans, files, delivery
  truth, and stop-only cancellation; 4 passed with 3 project-guarded skips on
  clean staging.
- Native Linux Tauri release build, Xvfb launch, Secret Service round trip, and
  keyring-backed pairing and relaunch.
- Android release APK static verification: package metadata, label, ABIs,
  zipalign, and v2/v3 signatures.
- Android runtime on an API 36 x86_64 emulator using a same-source debug build:
  launch, real adapter pairing, and credential restore after force-stop.

## Limits

- Physical-device Android validation is `NOT_RUN`.
- iOS is `NOT_APPLICABLE` on this Linux host. No IPA is provided.
- There is no Play Store listing, release keystore, auto-update channel, or
  signed iOS artifact.
- The Stillness Android release APK contains ARM ABIs only. The x86_64 emulator
  runtime check used a debug build of the same source.
- Adapter v2 and Stillness 12 remain under active development. Treat the 0.3.0
  client and adapter as a preview pair, not a drop-in replacement for the
  existing production adapter.

Full evidence:
[`docs/evidence/v0.3.0/README.md`](https://github.com/ddawnlll/jcode-mobile/blob/v0.3.0/docs/evidence/v0.3.0/README.md).
