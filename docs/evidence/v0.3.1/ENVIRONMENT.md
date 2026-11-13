# Environment

## Host

| Item | Value |
| --- | --- |
| OS | macOS 26 (Darwin 25.1.0), arm64 |
| CPU / RAM | Apple silicon, 18 GiB (19,327,352,832 bytes) |
| Disk free | ~101 GiB at start |
| Xcode | 26.1.1 (`xcode-select` full Xcode) |
| Bun | 1.4.4 |
| Node driver | Bun (`bunx --bun`) |
| Java | OpenJDK 24.0.1 (system); Android build may need JDK 21 |
| Android SDK | `~/Library/Android/sdk` |
| SDK packages | platform-tools 37.0.1, platforms;android-35, build-tools;35.0.0, emulator 37.2.13, system-images;android-35;google_apis;arm64-v8a |
| AVD | `jcode-audit-api35` (Pixel 7, API 35, google_apis, arm64-v8a) |
| Existing AVD | `jcode-mobile` is invalid: config points at missing `android-36/google_apis/arm64-v8a` |

## Repository / build under audit

| Item | Value |
| --- | --- |
| Repo | `ddawnlll/jcode-mobile` |
| Branch | `debug/v0.3.0-android-audit` (from `main` 43ddfd7) |
| Release tag | `v0.3.0` = `368abc8ef5d939e069318a38db33a8bac39f3bdc` |
| `main` at audit start | `43ddfd77ff1be4f346ce97bc55870b1369bb68ce` |
| Release APK | `jcode-mobile-0.3.0-android-release.apk`, 11,020,965 bytes |
| APK SHA-256 | `4a79ba0aeaf026949ecbdb57591fc7e18dd87fb47d10c67ff49bf03be63060d2` (verified) |
| Patched APK | `.staging/audit-v030/apktool/patched-release-cleartext.apk` (manifest `usesCleartextTraffic=true` only, debug-signed) |
| Branch source build | `artifacts/jcode-mobile-0.3.0-android-release.apk`, SHA-256 `edc6e27f9263a0ebb0e30e53069a79469613ebb880b76879136bf7207db391af` (contains all fixes; verified on AVD) |
| Branch build toolchain | OpenJDK 17 (`~/.local/android-toolchain/jdk17`), SDK+NDK under `~/.local/android-toolchain/sdk`, compileSdk 37, NDK 27.1.12297006 |
| Android package | `dev.jcode.stillness` |
| APK ABIs | arm64-v8a, armeabi-v7a (no x86_64) |
| Client | Tauri 2 + Stillness 12 (`apps/stillness`) |
| Adapter | Rust Adapter v2 (`crates/adapter-protocol`, `adapter-core`, `adapter-server`) |

## JCode daemon

| Item | Value |
| --- | --- |
| Required pin | `ddawnlll/jcode` `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8` (harness API 1.11) |
| Local checkout | `~/src/jcode-fork` at `0abff12c7` |
| Installed prod binary | `jcode v0.99.1-dev (7206efd0c, dirty)` — **not** the pinned commit; production instance is not touched |
| Isolated home | `.staging/audit-v030/daemon/home` |
| Isolated runtime | `.staging/audit-v030/daemon/run` |

## Isolation rules

- No production daemon or live adapter is stopped, restarted, or reconfigured.
- Adapter listens on a dedicated audit port (see PROGRESS.md), with its own SQLite data dir.
- Pairing codes and device tokens are generated per run and never copied into reports; logs are sanitized before inclusion.
