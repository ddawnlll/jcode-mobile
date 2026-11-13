# Build state

Updated: 2026-11-13

## Current line

| Item | Value |
| --- | --- |
| Branch | `main` |
| Release | `v0.3.1` |
| App version | 0.3.1 |
| Adapter | Rust Adapter v2, protocol v2 |
| Client | Stillness 12, Tauri 2 |
| Android package | `dev.jcode.stillness` |
| Android versionCode | 3001 |
| JCode | Pinned fork `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8` |
| JCode harness API | v1.11 |
| Runtime | Bun 1.4.4, Rust stable |
| Repository | `https://github.com/ddawnlll/jcode-mobile` |

## Components

| Component | Path | State |
| --- | --- | --- |
| Adapter protocol | `crates/adapter-protocol` | v2 envelopes, events, errors |
| Adapter core | `crates/adapter-core` | SQLite WAL, auth, paths, SDK link |
| Adapter server | `crates/adapter-server` | Axum, WebSocket, dispatch |
| Stillness web | `apps/stillness` | React 19, Vite 7 |
| Tauri shell | `apps/stillness/src-tauri` | Desktop and Android |
| Android project | `apps/stillness/src-tauri/gen/android` | Committed, patched Tauri CLI path |
| Legacy Expo app | `src/` | 0.2.x client, not the 0.3.1 artifact |
| Legacy adapter | `integration/jcode-adapter` | 0.2.x Bun adapter |

## Checks

| Check | Result |
| --- | --- |
| `cargo test --workspace` | PASS, 30 tests |
| `cargo fmt --all -- --check` | PASS |
| `bun run typecheck` | PASS |
| `bun run lint` | PASS, 0 errors, 0 warnings |
| `bun run test` | PASS, 14 suites / 139 tests |
| `cd apps/stillness && bun run build` | PASS |
| `bash scripts/stillness-e2e.sh` | PASS, 4 passed / 3 skipped |
| `bun run marketing:test` | PASS, 25 unit tests; 76 passed / 3 skipped |
| Native Linux Tauri build | PASS, 5,071,384-byte release binary |
| Native Linux launch | PASS under Xvfb |
| Native Secret Service keyring | PASS |
| Android release APK | PASS, static verification |
| Android emulator runtime | PASS, same-source x86_64 debug build |
| Physical Android | NOT_RUN |
| iOS | NOT_APPLICABLE on Linux |

## Release artifacts

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `artifacts/jcode-mobile-0.3.1-android-release.apk` | 11,016,925 | `03a6d808524461e12dca1370540eede2e040e179e9f116cec980effb180da562` |

The 0.3.1 APK is a Tauri 2 build for `arm64-v8a` and `armeabi-v7a`,
debug-signed for sideloading. It is attached to the
[`v0.3.1` release](https://github.com/ddawnlll/jcode-mobile/releases/tag/v0.3.1)
with its `.sha256` file. Artifacts are not committed.

Historical artifacts:

- Expo 0.2.2 Android APK, 65,731,410 bytes, SHA-256
  `f2ee7c4f0eae836c8361f956cd3ffe0403ddae389bac4c3a2fd59a17c001ddf9`.
- Expo 0.2.2 iOS Simulator `.app` zip, 29 MiB, SHA-256
  `33269e4e09d34d3da5d35653451172c4f49225edee0e22966d8343c84e8e3859`.
- Older Android and iOS artifacts are recorded in
  [`V0_2_2_VERIFICATION.md`](V0_2_2_VERIFICATION.md) and the v0.2.1 notes.

The 0.2.2 iOS artifact is a Simulator `.app`, not a signed IPA. There is no
signed iOS artifact in 0.3.1.

## Android build

```text
JDK 21.0.13
Android SDK 37
Build tools 37.0.0
NDK 27.1.12297006
Gradle 9.6.1
compileSdk 37, minSdk 24, targetSdk 37
```

Build:

```sh
bash scripts/build-android-release.sh
```

The script detects JDK/SDK/NDK, installs the ARM Rust targets, builds the web
bundle, runs `tauri android build --apk --target aarch64 armv7`, zipaligns,
signs with the repository debug keystore, verifies v2/v3 signatures, and writes
the checksum. The generated Android project is committed; build output,
`local.properties`, `jniLibs`, and generated Wry Kotlin remain ignored.

## Native Linux build

```sh
bash scripts/build-tauri-linux.sh
```

Without system GTK 3/WebKitGTK 4.1 development packages:

```sh
TAURI_SYSROOT="$HOME/tauri-sysroot" bash scripts/build-tauri-linux.sh
```

The 5,071,384-byte release binary is local-only and is not attached to the
GitHub release.

## Test environment

| Item | Value |
| --- | --- |
| Host | Debian 13 (trixie), Linux 6.12, x86_64 |
| RAM | 11.7 GiB |
| Rust | 1.99.1 |
| Bun | 1.4.4 |
| JCode staging | Pinned fork commit, isolated home |
| Playwright | Chromium 1.65 |
| Android emulator | API 36, x86_64 |
| Native Linux | Xvfb + user-space GTK/WebKit prefix |

## Resumption point

1. The current release is `v0.3.1` on `main`.
2. The release APK and checksum are attached to the GitHub release and verified
   by download.
3. The evidence matrix is [`VERIFICATION.md`](VERIFICATION.md).
4. The full command log and captures are in
   [`evidence/v0.3.1/README.md`](evidence/v0.3.1/README.md).
5. Physical Android, iOS, and a human screen-reader pass remain open.
6. Staging runs use `.staging/` and must never touch the production daemon.

## Known gaps

- No release keystore or Play Store listing.
- No x86_64 library in the release APK.
- No physical Android validation.
- No iOS build on this host.
- The adapter uses session-scoped upstream cancellation.
- File-level diffs are not available.
- Attachments are not implemented.
- A persisted snapshot may omit the assistant side of a just-completed turn;
  the live stream carries it.
