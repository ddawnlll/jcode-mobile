# Build state

Updated: 2026-11-21

## Current line

| Item | Value |
| --- | --- |
| Branch | `main` (`release/0.7.1-ziran`) |
| Release | `v0.7.1` (Ziran — Wu wei), prepared 2026-11-21 |
| App version | 0.7.1 |
| Adapter | Rust Adapter v4, protocol 4, minimum 2 |
| Binary names | `jcode-adapter-v4` (preferred), `jcode-adapter-v3` and `jcode-adapter-v2` (aliases) |
| Client | Ziran (native Kotlin + Jetpack Compose, `apps/android/`) |
| Android package | `dev.ziran.android` |
| Android versionCode | 74 (`versionName 0.7.4`, `minSdk 26`, `targetSdk 37`, `compileSdk 37`) |
| Signed APK | `artifacts/ziran-0.7.1-android-release.apk` (`11,624,585` bytes / `11.09 MiB`) |
| APK SHA-256 | `e1612a7071399c3f116b2718ec18aadd22c68f726d3653b2d9d4b188f4f62f6b` |
| JCode | Pinned fork `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8` |
| JCode harness API | v1.11 |
| Runtime | JDK 24 / Gradle 9.6.1, Bun 1.4.4, Rust 1.96.0-nightly |
| Live deployment | `https://dawnll.duckdns.org` → `127.0.0.1:7644`, unit `jcode-mobile-adapter-v4.service` |
| Repository | `https://github.com/ddawnlll/jcode-mobile` |

Ziran 0.7.1 results are recorded in
[`V0_7_0_RELEASE_NOTES.md`](V0_7_0_RELEASE_NOTES.md),
[`V0_7_1_RELEASE_NOTES.md`](V0_7_1_RELEASE_NOTES.md), and
[`evidence/v0.7.1/README.md`](evidence/v0.7.1/README.md): 90 Android JVM unit
tests, strict `lintDebug` (0 errors), signed and zipaligned `ziran-0.7.1-android-release.apk`
(v2 + v3 signatures), all 9 Wu wei flows verified side-by-side at 1x and 0.25x,
10 Day/Night screen comparisons, 120 Hz peak refresh-rate mode selection,
UI p50 `0.5–2.0 ms` on Metal GPU emulator, 96 Adapter v4 Rust tests, and full
`bun run marketing:test` pass on the rebranded Ziran website.

The detailed checks and artifact sections below describe earlier 0.4.0–0.6.0
Stillness builds and are kept as history.

The live host was moved from the pre-v4 adapter to Adapter v4 on 2026-11-15.
That cutover, its checks and its rollback are recorded in
[`ADAPTER_V4_DEPLOYMENT.md`](ADAPTER_V4_DEPLOYMENT.md). The step before it was
Adapter v2 (`0.3.1`, protocol 2). No v3 build was ever deployed. The deployment
reused the existing data directory, so the `server_id` and paired device tokens
were preserved rather than re-issued.

## Components

| Component | Path | State |
| --- | --- | --- |
| Adapter protocol | `crates/adapter-protocol` | v4 envelopes, negotiation, 10 tests |
| Adapter core | `crates/adapter-core` | native links, journal, cursors, delta index, auth, paths, 42 tests |
| Adapter server | `crates/adapter-server` | Axum, WebSocket, dispatch, diagnostics, push, 25 unit + 19 integration tests |
| Stillness web | `apps/stillness` | React 19, Vite 7, intent-first tools, gestures and semantic motion |
| Tauri shell | `apps/stillness/src-tauri` | Desktop and Android; `native_android.rs` contract |
| Android project | `apps/stillness/src-tauri/gen/android` | Committed, patched Tauri CLI path |
| Kotlin bridge | `.../java/dev/jcode/stillness/native/` | Notifications, push, background sync, share, deep links, biometrics, pickers, downloads, clipboard, layout, launchers |
| Legacy Expo app | `src/` | 0.2.x client, not the 0.6.0 artifact |
| Legacy adapter | `integration/jcode-adapter` | 0.2.x Bun adapter |

## Checks

Every result below comes from the 0.4.0 build and test run recorded in this
repository, except where the row says `NOT_RUN` or "carried forward". "Carried
forward" means it was not re-run for 0.4.0.

| Check | Command | Result |
| --- | --- | --- |
| Adapter v3 Rust tests | `cargo test --workspace` | PASS, 72 tests: 28 core, 10 protocol, 17 server lib, 17 integration |
| Rust formatting | `cargo fmt --all -- --check` | PASS |
| Rust clippy | `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| Root typecheck | `bun run typecheck` | PASS for 0.4.0 after the final merge |
| Repository lint | `bun run lint` | PASS, 0 errors, 0 warnings after the final merge |
| Legacy Jest/RNTL | `bun run test` | PASS, 14 suites / 139 tests for 0.4.0 |
| Stillness typecheck and bundle | `cd apps/stillness && bun run build` | PASS after the native shell and attachment UI merge |
| UX helper checks | `node scripts/check-stillness-ux.mjs` | PASS, 14/14 (`docs/STILLNESS_UX_0_4.md`) |
| Browser interaction checks | `node .staging/ui-0.4/verify.mjs` | PASS, 14/14 (`ui/verify.json`); staging script, not committed |
| Browser e2e, real daemon + Adapter v3 | `bash scripts/stillness-e2e.sh` | PASS, 5 passed / 3 skipped (skips are the designed desktop duplicates and the mobile-only delivery case) |
| Startup measurements | same run, `JCODE_PERF` line | PASS, web target only: 26 ms online, 71 ms cached with the socket blocked, 63 ms shell to paint, 6 requests / 933,522 bytes |
| Adapter v3 real-stack smoke | `bash scripts/v3-smoke-up.sh` | PASS, real agent turn `OK`, seq 7, replay 0 duplicates, one accepted operation |
| Android Kotlin compile | `./gradlew :app:compileUniversalDebugKotlin` | PASS, JDK 24, SDK 37, NDK 27.1.12297006 |
| Android release APK | `bash scripts/build-android-release.sh` | PASS, 12,718,529 bytes, v2 + v3 signatures |
| Android release APK static verification | `aapt2 dump badging`, `apksigner verify`, `zipalign -c` | PASS |
| Android release APK on emulator | install, launch, pair, restart, one turn | PASS, API 36 arm64-v8a: versionCode 4000 installed and launched with no fatal crash after the Room keep fix; paired to staging Adapter v3; emulator restart restored the exact session with history; the final build shows the enabled Add image control, the v0.4.0 drawer footer and the quick switcher; one real turn was accepted and answered on device. The adb-typed prompt was truncated to `Repl` and the agent asked about a REPL, so this is a real accepted turn, not a completed task |
| Android native interaction matrix | see `docs/ANDROID_NATIVE.md` | PASS on the emulator for notifications, sharesheet, biometric device-credential, downloads, clipboard/haptics, lifecycle/insets/back, settings |
| Android image pickers | photo picker, image read | PARTIAL: decode works, camera capture blocked on the AVD |
| FCM push | registration, preferences, dedupe, FCM v1 sender | PARTIAL: `not_configured`, no Firebase credentials, no delivery |
| Home widget | provider and layout registered | PARTIAL: launcher placement `NOT_RUN` |
| Native Linux Tauri build and launch | `bash scripts/build-tauri-linux.sh` | NOT_RUN for 0.4.0; last verified for 0.3.1 |
| Secret Service keyring | carried forward | PASS for 0.3.1, not re-run |
| Marketing site build and browser matrix | `bun run marketing:test` | NOT_RUN for 0.4.0; last verified for 0.3.1 |
| Physical Android device (Samsung A34) | none attached | NOT_RUN |
| Manual screen-reader pass | none | NOT_RUN |
| Battery measurement (mAh, wake locks) | none | NOT_RUN |
| Frame pacing / 120 Hz | none | NOT_RUN |
| Native cold start and memory | none | NOT_RUN |
| Process death and airplane mode | none | NOT_RUN |
| iOS | requires macOS + Xcode signing | NOT_APPLICABLE for this artifact |

CI: `.github/workflows/check.yml` runs the JavaScript job, the Rust job
(`fmt`, `clippy -D warnings`, `test`), and the Stillness Android APK job
(JDK 21, platform 36, build-tools 36.0.0, NDK 27.2.12479018). The workflow is
committed; the run itself has not been pushed or executed.

## Release artifacts

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `artifacts/jcode-mobile-0.5.0-android-release.apk` | 12,718,529 (12.1 MiB) | `d1f5662fca569e3a0bba725b862ae7cc27c121af1861562bb821cd0c3a98f227` |

```text
package dev.jcode.stillness
versionCode 5000, versionName 0.5.0
minSdk 24, targetSdk 37, compileSdk 37
native-code arm64-v8a, armeabi-v7a
APK Signature Scheme v2 true, v3 true, Android Debug certificate
zipalign 4-byte check: successful
```

The `.sha256` file beside the APK contains:

```text
d1f5662fca569e3a0bba725b862ae7cc27c121af1861562bb821cd0c3a98f227  jcode-mobile-0.5.0-android-release.apk
```

`shasum -a 256` over the APK reproduces that digest. The 0.5.0 APK is signed
with the same `android/app/debug.keystore` as 0.4.0, so it updates in place and
keeps the device token.

Historical artifacts remain in `artifacts/` and are recorded in
[`evidence/v0.3.1/README.md`](evidence/v0.3.1/README.md) and the earlier
verification pages. The 0.3.1 APK was 11,016,925 bytes with SHA-256
`03a6d808524461e12dca1370540eede2e040e179e9f116cec980effb180da562`.

## Android build

```text
Host:        macOS 26.1, arm64
JDK:         24.0.1
Android SDK: 37
Build tools: 37.0.0
NDK:         27.1.12297006
Gradle:      9.6.1
compileSdk 37, minSdk 24, targetSdk 37
ABIs:        arm64-v8a, armeabi-v7a
```

Build and verify:

```sh
bash scripts/build-android-release.sh
aapt2 dump badging artifacts/jcode-mobile-0.4.0-android-release.apk
apksigner verify --print-certs -v artifacts/jcode-mobile-0.4.0-android-release.apk
zipalign -c -v 4 artifacts/jcode-mobile-0.4.0-android-release.apk
shasum -a 256 artifacts/jcode-mobile-0.4.0-android-release.apk
```

The script detects JDK/SDK/NDK, installs the ARM Rust targets, builds the web
bundle, runs `tauri android build --apk --target aarch64 armv7`, zipaligns,
signs with the repository debug keystore, verifies v2/v3 signatures, and writes
the checksum. `local.properties`, `jniLibs`, build output, and generated Wry
Kotlin remain ignored.

Kotlin-only compile check (no packaging):

```sh
cd apps/stillness/src-tauri/gen/android
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-24.jdk/Contents/Home \
ANDROID_HOME=$HOME/.local/android-toolchain/sdk \
  ./gradlew :app:compileUniversalDebugKotlin
```

## Native Linux build

Not re-run for 0.4.0. The 0.3.1 path is unchanged:

```sh
bash scripts/build-tauri-linux.sh
TAURI_SYSROOT="$HOME/tauri-sysroot" bash scripts/build-tauri-linux.sh
```

The 5,071,384-byte 0.3.1 release binary was local-only and is not attached to a
GitHub release.

## Test environment

| Item | Value |
| --- | --- |
| Host | macOS 26.1, arm64, no sudo assumptions |
| Rust | 1.96.0-nightly (2026-03-21) |
| Bun | 1.4.4 (pinned by `.bun-version`) |
| JDK | 24.0.1 |
| Android SDK / build tools / NDK | 37 / 37.0.0 / 27.1.12297006 |
| Android emulator | API 36, arm64-v8a, `dev.jcode.stillness` |
| Browser | Playwright Chromium, web target only |
| JCode staging | Pinned fork commit, isolated `JCODE_HOME` and socket |
| Adapter under test | Adapter v3, ports 7655/7658/7660/7661 (staging only) |

Staging runs use `.staging/` and never contact the production daemon or the live
adapter on port 7644.

## Resumption point

1. 0.4.0 is prepared on `feat/adapter-v3`; the release tag, GitHub release,
   and release download URL are still to be created.
2. The APK and checksum exist locally under `artifacts/` and are verified.
3. The evidence index is
   [`evidence/v0.4.0/README.md`](evidence/v0.4.0/README.md).
4. Physical Android, FCM delivery, a human screen-reader pass, battery
   measurement, frame pacing, native cold start/memory, and process
   death/airplane mode remain `NOT_RUN`.
5. The CI workflow is committed but has not run.

## Known gaps

- No release keystore or Play Store listing; the APK is debug-signed.
- No x86_64 library in the release APK.
- No physical Android validation.
- No FCM delivery without operator credentials.
- No iOS build on this host.
- The adapter uses session-scoped upstream cancellation.
- File-level diffs are not available; only aggregate edit statistics.
- Push registration exists, but authenticated background session
  reconciliation does not.
- Native Linux and marketing builds were not re-verified for 0.4.0.
