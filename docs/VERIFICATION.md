# Verification

Updated: 2026-11-12

This page records what actually ran for the current 0.3.0 code. Statuses are
`PASS`, `FAIL`, `PARTIAL`, `NOT_RUN`, `BLOCKED`, or `NOT_APPLICABLE`.

The full command log, screenshots, and build notes are in
[`evidence/v0.3.0/README.md`](evidence/v0.3.0/README.md). Historical release
records remain in:

- [`V0_2_3_VERIFICATION.md`](V0_2_3_VERIFICATION.md)
- [`V0_2_2_VERIFICATION.md`](V0_2_2_VERIFICATION.md)
- [`V0_2_1_VERIFICATION.md`](V0_2_1_VERIFICATION.md)
- [`V0_2_0_VERIFICATION.md`](V0_2_0_VERIFICATION.md)
- [`V0_1_4_VERIFICATION.md`](V0_1_4_VERIFICATION.md)

## 0.3.0 matrix

| Check | Result | Evidence |
| --- | --- | --- |
| Rust workspace tests | PASS | `cargo test --workspace`: 30 tests, 0 failed |
| Rust formatting | PASS | `cargo fmt --all -- --check` |
| Root TypeScript typecheck | PASS | `bun run typecheck` |
| Repository ESLint | PASS | `bun run lint`: 0 errors, 0 warnings |
| Legacy Jest/RNTL | PASS | `bun run test`: 14 suites, 139 tests |
| Stillness typecheck and bundle | PASS | `tsc --noEmit && vite build` |
| Stillness lint | PASS | 0 errors, 0 warnings |
| Isolated JCode daemon and SDK handshake | PASS | Adapter health reports `jcode_connected: true` |
| Real-stack Playwright | PASS | `bash scripts/stillness-e2e.sh`: 4 passed, 3 project-guarded skips |
| Marketing site build and browser matrix | PASS | `bun run marketing:test`: 25 unit tests; 76 Playwright passed, 3 project-guarded skips |
| Command Code generation | PASS | Real `deepseek/deepseek-v4-flash` answer, unique token |
| Android release build | PASS | `jcode-mobile-0.3.0-android-release.apk` |
| Android static verification | PASS | Package, version, label, ABIs, zipalign, v2/v3 signatures |
| Android emulator runtime | PASS | Same-source x86_64 debug build: launch, pair, Keystore restore |
| Physical Android device | NOT_RUN | No device attached |
| Native Linux release build | PASS | 5,071,384-byte Tauri binary |
| Native Linux launch | PASS | Xvfb launch |
| Native Secret Service keyring | PASS | Round trip, UI pairing, relaunch |
| iOS | NOT_APPLICABLE | Requires macOS and Xcode |
| Manual screen-reader pass | NOT_RUN | No human VoiceOver/TalkBack session |

## Android artifact

```text
jcode-mobile-0.3.0-android-release.apk
11,020,965 bytes
SHA-256 4a79ba0aeaf026949ecbdb57591fc7e18dd87fb47d10c67ff49bf03be63060d2
package dev.jcode.stillness
versionCode 3000, versionName 0.3.0
minSdk 24, targetSdk 37, compileSdk 37
arm64-v8a, armeabi-v7a
APK Signature Scheme v2 and v3, Android Debug certificate
```

The release APK is ARM-only and debug-signed. The API 36 x86_64 emulator check
used a debug build of the same source because the release APK has no x86_64
native library. That is a runtime check of the client code and adapter flow, not
an install test of the exact release binary.

## Real-stack test

The Stillness Playwright suite uses:

- An isolated `$JCODE_HOME` under `.staging/stillness`.
- The pinned JCode binary and harness API bridge.
- The Rust Adapter v2 on `127.0.0.1:7650`.
- The production Vite bundle served by that adapter.
- A real Command Code route.

The suite covers pairing, reload persistence, sessions, draft scope, rename,
plan, activity, file browsing, preferences, desktop three-pane layout, honest
delivery state, and stop-only cancellation.

## What the images show

The marketing images in `docs/media/marketing` were captured on 2026-11-12 from
a real isolated adapter and a real Command Code turn. They are not mockups. The
session title and prompt are sample content chosen for the capture; the answer,
model route, token counts, and delivery state came from the running stack.

The capture script is
`scripts/marketing-media/capture-stillness-screens.mjs`. It refuses to use a
production adapter. See the capture metadata in
`docs/media/marketing/capture.json`.

## Known limits

- The release APK has no release keystore. It is debug-signed for sideloading.
- The release APK has no x86_64 library. The emulator uses a debug build.
- No physical Android device was tested.
- No iOS build was produced on this Linux host.
- The adapter's upstream cancel is session-scoped. The client reports
  `atomic_turn_scope: false`.
- File-level diffs are not available from the curated JCode API.
- Attachments are not implemented in the mobile composer.
- A persisted snapshot may contain only the user side of a just-completed turn.
  The live event stream carries the assistant text. This is recorded as a known
  limit, not papered over with client-side invention.
- Manual screen-reader passes and physical-device performance remain `NOT_RUN`.

## Reproduce the checks

```sh
cargo test --workspace
cargo fmt --all -- --check

bun run typecheck
bun run lint
bun run test

cd apps/stillness
bun run build
cd ../..

bun run marketing:test
bash scripts/stillness-e2e.sh
bash scripts/build-android-release.sh
bash scripts/build-tauri-linux.sh
```

The current build state is [`BUILD_STATE.md`](BUILD_STATE.md).
