# Verification

Updated: 2026-11-13

This page records what actually ran for the current 0.3.1 code. Statuses are
`PASS`, `FAIL`, `PARTIAL`, `NOT_RUN`, `BLOCKED`, or `NOT_APPLICABLE`.

The full command log, screenshots, and build notes are in
[`evidence/v0.3.1/README.md`](evidence/v0.3.1/README.md). Historical release
records remain in:

- [`V0_2_3_VERIFICATION.md`](V0_2_3_VERIFICATION.md)
- [`V0_2_2_VERIFICATION.md`](V0_2_2_VERIFICATION.md)
- [`V0_2_1_VERIFICATION.md`](V0_2_1_VERIFICATION.md)
- [`V0_2_0_VERIFICATION.md`](V0_2_0_VERIFICATION.md)
- [`V0_1_4_VERIFICATION.md`](V0_1_4_VERIFICATION.md)

## 0.3.1 matrix

| Check | Result | Evidence |
| --- | --- | --- |
| Rust workspace tests | PASS | `cargo test --workspace`: 32 passed, 0 failed |
| Rust formatting | PASS | `cargo fmt --all -- --check` |
| Root typecheck | PASS | `bun run typecheck` |
| Repository ESLint | PASS | `bun run lint`: 0 errors, 0 warnings |
| Legacy Jest/RNTL | PASS | `bun run test`: 14 suites, 139 tests |
| Stillness typecheck and bundle | PASS | `tsc --noEmit && vite build` (Stillness production build passes) |
| Isolated JCode daemon and SDK handshake | PASS | Adapter health reports `adapter_version: 0.3.1`, `jcode_connected: true` |
| Android release build | PASS | `jcode-mobile-0.3.1-android-release.apk`, sha256 below |
| Android static verification | PASS | Package, version, label, ABIs, zipalign, v2/v3 signatures |
| Android emulator runtime | PASS | AVD `jcode-audit-api35` (arm64-v8a, API 35): pair, restore, tool turns, Stop, reconnect |
| Marketing site build and browser matrix | PASS | `bun run marketing:test`: 25 unit tests; Playwright matrix across 320/390/768/1440 and server projects |
| Android release APK runtime checks | PASS | AVD jcode-audit-api35 (arm64-v8a, API 35); release build matches the shipped artifact |
| Marketing capture pipeline page errors | PASS | `errors: []` for welcome, pairing, home, session, models, settings, desktop |
| Native Linux release build | PASS | 5,071,384-byte Tauri binary (carried forward) |
| Native Linux launch | PASS | Xvfb launch (carried forward) |
| Native Secret Service keyring | PASS | Round trip, pairing, relaunch (carried forward) |
| Physical Android device | NOT_RUN | No device attached |
| iOS | NOT_APPLICABLE | Requires macOS and Xcode |
| Manual screen-reader pass | NOT_RUN | No human VoiceOver/TalkBack session |

## Android artifact

```text
jcode-mobile-0.3.1-android-release.apk
11,016,925 bytes
SHA-256 03a6d808524461e12dca1370540eede2e040e179e9f116cec980effb180da562
package dev.jcode.stillness
versionCode 3001, versionName 0.3.1
minSdk 24, targetSdk 37, compileSdk 37
arm64-v8a, armeabi-v7a
APK Signature Scheme v2 and v3, Android Debug certificate
```

The release APK is debug-signed for sideloading. The Android runtime checks
ran on the same arm64-v8a release build that ships in the release.

## Real-stack test

An isolated JCode daemon under `.staging/audit-v030/` and a Rust Adapter v2
totally isolated from production served this audit:

- Background/force-stop during a running turn; completion reconciled on resume.
- Adapter kill: honest "Connection closed (1006). SAVED ON THIS PHONE";
  adapter restart: automatic reconnect, banner cleared, session restored.
- Explicit Stop cancels exactly the current turn.
- Consecutive turns both promote to `observed_in_history`.
- Session creation yields distinct ids; titles and history are untouched.
- Switching sessions mid-turn keeps the turn alive in its own session.

Delivery truth is covered by the pinned daemon journal and the adapter's
`operations` table, not by client-side invention.

## Known limits

- The release APK has no release keystore. It is debug-signed for sideloading.
- Pairing over plain HTTP to a non-loopback address is not supported; use TLS
  or a tunnel to the adapter.
- No physical Android device was tested.
- No iOS build was produced on this Linux host.
- Interactive tool input/approval remains unimplemented by this client.
- Attachment support and provider credentials are not implemented in the
  mobile composer.
- R-01 (network drop during stream) and R-05 (duplicate-event injection) are
  untested.
- Manual screen-reader passes and physical-device performance remain
  `NOT_RUN`.

## Reproduce the checks

```sh
cargo test --workspace
cargo fmt --all -- --check

cd apps/stillness
bun run build
cd ../..

bun run marketing:test
node scripts/marketing-media/capture-stillness-screens.mjs
bash scripts/build-android-release.sh
bash scripts/build-tauri-linux.sh
```

The current build state is [`BUILD_STATE.md`](BUILD_STATE.md).
