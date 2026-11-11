# JCode Mobile v0.3.0 evidence

This directory records what was actually built and tested for Adapter v2 and
Stillness 12. It does not repeat the design intent in
`docs/V0_3_0_ADAPTER_V2_STILLNESS_V12.md`.

## Host

- Debian 13 (trixie), Linux 6.12, x86_64, 11.7 GiB RAM.
- Rust 1.99.1, Bun 1.4.4, Vite 7.3.8, Playwright 1.65 (Chromium).
- No system GTK/WebKit development packages and no passwordless `sudo`.
  Native Linux was built against a user-space prefix under
  `$HOME/tauri-sysroot`.
- OpenJDK 21.0.13, Android SDK 37, NDK 27.1, and Gradle 9.6.1.
- No Xcode or iOS simulator.

Pinned JCode fork: `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8`,
`jcode v0.99.999-dev (0abff12c7)`, release binary built locally.

## Status matrix

Statuses are `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, or `NOT_APPLICABLE`.

| Check | Status | Evidence |
| --- | --- | --- |
| Rust adapter compiles (`adapter-protocol`, `adapter-core`, `adapter-server`) | PASS | `cargo test --workspace` builds every crate |
| Protocol, store, auth, path, turn, hub, and operation tests | PASS | 30 Rust tests: 18 core, 4 protocol, 4 server unit, 4 operation-flow |
| `cargo fmt --all -- --check` | PASS | exit 0 |
| Root TypeScript typecheck | PASS | `bun run typecheck`; root config excludes `apps/stillness`, which has its own strict `tsc --noEmit` build |
| Legacy unit/RNTL suite | PASS | `bun run test`: 14 suites, 139 tests |
| Stillness typecheck and production web build | PASS | `tsc --noEmit && vite build`; 431.88 kB JS / 142.43 kB gzip, 39.89 kB CSS / 8.37 kB gzip |
| Stillness lint | PASS | `eslint apps/stillness/src`: 0 errors, 0 warnings |
| Repository-wide ESLint | PASS | `eslint .`: 0 errors, 0 warnings after removing generated/vendored paths and fixing the remaining unused symbols |
| Real isolated JCode daemon + curated SDK handshake | PASS | `scripts/stillness-e2e.sh` with the pinned fork binary; adapter health reports `jcode_connected:true` |
| Pairing, reload persistence, mobile session/draft/rename/plan/activity/files/preferences | PASS | Playwright Chromium, isolated daemon, real adapter |
| Desktop three-pane layout | PASS | Playwright Chromium 1280x900 |
| Delivery truth and stop-only cancellation | PASS | Unique-token Command Code generation, accepted state, no pending card, navigation does not cancel, explicit Stop hides the control |
| Command Code live model generation | PASS | `deepseek/deepseek-v4-flash` returned `stillness-mwch91ic-ok`; transcript journal and `stillness-mobile-accepted.png` |
| Native Linux Tauri release build | PASS | `scripts/build-tauri-linux.sh`; 5,071,384-byte binary |
| Native Linux Tauri launch | PASS | Xvfb capture `native-tauri-launch.png` |
| Native Secret Service keyring round trip | PASS | `keyring_smoke` wrote, read, and deleted an item in an unlocked `gnome-keyring` session |
| Native OS-keyring pairing and relaunch | PASS | UI pairing created a real device token in the Secret Service; relaunch restored the credential and reconnected (`native-keyring-pairing.png`, `native-keyring-relaunch.png`) |
| Android build and runtime | PASS (JCode Mobile 0.3.0) | `jcode-mobile-0.3.0-android-release.apk` static verification PASS, 11,020,965 bytes, SHA-256 `4a79ba0a...`; a same-source x86_64 debug build installed on the API 36 emulator, paired with a real adapter, and restored credentials after force-stop |
| iOS build | NOT_APPLICABLE | requires macOS and Xcode; outside this Linux host |

## Commands and observed results

```sh
cargo test --workspace
# 30 passed, 0 failed

cargo fmt --all -- --check
# exit 0

bun run typecheck
# exit 0; the legacy Expo surface and root scripts typecheck

bun run test
# 14 suites / 139 tests passed

cd apps/stillness && bun run build
# tsc --noEmit passes; Vite production build succeeds

cd ../.. && ./node_modules/.bin/eslint apps/stillness/src
# exit 0, 0 errors, 0 warnings

bun run lint
# exit 0, 0 errors, 0 warnings

cd apps/stillness/src-tauri
cargo run --release --example keyring_smoke
# keyring round trip ok (inside an unlocked Secret Service session)

bash scripts/stillness-e2e.sh
# exit 0; 4 passed, 3 skipped (project-specific guards), ~30 s

bash scripts/build-android-release.sh
# Java 21.0.13, Android SDK /home/quant/android-sdk, build-tools 37.0.0
# Tauri Android build + sign completed
# artifacts/jcode-mobile-0.3.0-android-release.apk
# SHA-256 4a79ba0aeaf026949ecbdb57591fc7e18dd87fb47d10c67ff49bf03be63060d2
```

The pinned e2e run creates an isolated home at `.staging/stillness/daemon`,
requires no production daemon, and serves the production bundle from the Rust
adapter on `127.0.0.1:7650`.

## Native Linux evidence

`scripts/build-tauri-linux.sh` used the user-space GTK 3 / WebKitGTK 4.1 prefix
because the host lacks development packages and sudo. The final release build took
4m15s with `--no-bundle` and produced:

```text
apps/stillness/src-tauri/target/release/stillness   5,071,384 bytes
```

Launch evidence required three host workarounds, all outside the repository:

- `Xvfb :99` from the same user-space prefix, with `xkbcomp` and `dash`
  exposed in a private mount namespace.
- `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` pointed at writable
  scratch directories because `$HOME/.local` is root-owned.
- The extracted WebKitGTK helper binaries are not installed at the compiled
  `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1` path. A disposable copy of
  `libwebkit2gtk-4.1.so.0` was patched to use `/tmp/w` for that prefix, with
  the three helper binaries copied there. This keeps the app in the host user
  namespace.

The app stayed alive and rendered the Stillness welcome screen; the framebuffer
capture is `native-tauri-launch.png`.

### Native keyring pairing

A private session bus ran `gnome-keyring-daemon --unlock --components=secrets`.
`secret-tool store`/`lookup` and the repo's
`cargo run --release --example keyring_smoke` both completed against that bus.
The app itself was then launched on the same bus with the disposable WebKit
helper prefix described above.

Driving the real onboarding form at `http://127.0.0.1:7652` produced:

- `CreateItem` and `ItemCreated` on `org.freedesktop.secrets`, followed by a
  device row named `Native Keyring Proof` in the adapter database;
- adapter log `device connected device=dev_13d1... connection=1`;
- the Stillness verified screen, `DEVICE TOKEN ACCEPTED`, `Back to work.`
  (`native-keyring-pairing.png`);
- after terminating and relaunching the app against the same XDG directories,
  the keyring item was read back, the credential metadata was loaded, and the
  app opened directly on the paired home with `Harness online`
  (`native-keyring-relaunch.png`).

An earlier attempt used a user-namespace overlay for the WebKit helper path.
That overlay made the app's D-Bus calls fail with `NoReply`; the same
`keyring_smoke` binary succeeded outside the user namespace and failed inside
it. That was a test-harness limitation, not an app credential failure, and is
why the final evidence launches without a user namespace.

### Android release APK

`scripts/build-android-release.sh` now builds the Stillness 12 Tauri client
(`dev.jcode.stillness`, versionCode 3000, versionName 0.3.0). JDK 21 and the
Android SDK/NDK are auto-detected, the Rust targets are installed if needed,
and the APK is signed and verified. The older Expo client remains available
through `scripts/build-expo-android-release.sh`.

A Pixel API 36 x86_64 emulator installed a debug build of the same source,
rendered the Stillness welcome screen, paired through a real adapter on
`127.0.0.1:7646`, and reopened `Your work.` with `Harness online` after a
force-stop. Full toolchain, signature, and runtime output is in
[`android-build.md`](android-build.md).

## Command Code and delivery evidence

The isolated daemon inherited the host's authorized Command Code account only
for the test process. The provider key is never read by the adapter, the web
bundle, SQLite, or Playwright state.

The send test asks for a unique token per run. The accepted run returned
`stillness-mwch91ic-ok`, which the session journal records as an assistant
message. `stillness-mobile-accepted.png` shows the generated answer, `Ready`,
no pending card, and no inline error.

Acceptance is correlated from three independent observations:

1. the transport `message_accepted` event when the bridge emits it;
2. any daemon turn event (`text_delta`, reasoning, tool, turn done/stopped),
   which proves the message reached a turn;
3. the user message appearing in authoritative session history.

A five-second timeout marks an operation unknown only when none of those
observations exist. A turn ending normally is never reported as
"delivery unconfirmed". The client never resends automatically.

## Performance observations

These are single-run measurements on the host above, not percentile SLAs.

| Metric | Observed | Conditions |
| --- | --- | --- |
| Adapter RSS | 21,880 KB | debug binary, 12m28s uptime, idle after Playwright suite |
| Adapter CPU | 0.3% average | same 12m idle window, `ps` average |
| Adapter threads | 18 | Tokio workers, global-event supervisor, and per-session child readers |
| Adapter store-ready to harness-connected | 22 ms | adapter log timestamps; process spawn-to-ready not instrumented |
| Native Tauri RSS | ~109 MiB (111,776 KB) | release binary, welcome screen under Xvfb |
| Web JS bundle | 431.88 kB (142.43 kB gzip) | Vite production build |
| Web CSS bundle | 39.89 kB (8.37 kB gzip) | Vite production build |
| Cold-start latency | NOT_RUN | no reproducible frame-ready timestamp for the native shell |
| Frame timing / input latency | NOT_RUN | Xvfb is software-rendered and not representative |

## Screenshots

| Capture | Meaning |
| --- | --- |
| `stillness-mobile-home.png` | Paired home against the isolated pinned daemon |
| `stillness-mobile-session.png` | Session transcript and composer |
| `stillness-mobile-models.png` | Authoritative Command Code route list |
| `stillness-mobile-accepted.png` | Real generated token with accepted delivery, no pending card |
| `stillness-desktop-three-pane.png` | Desktop rail, conversation, and inspector |
| `native-tauri-launch.png` | Native Tauri release app rendering the welcome screen under Xvfb |
| `native-keyring-pairing.png` | Native pairing accepted after a real Secret Service write |
| `native-keyring-relaunch.png` | Relaunch restoring the keyring credential and reconnecting |
| `android-stillness-welcome.png` | JCode Mobile 0.3.0 (Stillness client) running on the API 36 emulator |
| `android-stillness-pairing.png` | Real adapter pairing accepted on Android |
| `android-stillness-relaunch.png` | Android Keystore credential restored after force-stop |

## Claim boundaries

- Playwright Chromium is browser coverage. It is not Android, iOS, or native
  Tauri verification.
- The web preview stores the device token in `localStorage`; Settings says so.
  The Tauri shell uses `keyring`; native pairing and credential reload were
  exercised against an unlocked Secret Service on the Linux test session.
- No Command Code API key is read, logged, or stored by the adapter, the web
  bundle, SQLite, or Playwright state.
- A model appearing in `ListModels` is reported as listed; entitlement is not
  invented.
- File-level changes are not exposed by the curated SDK. The Changes screen
  says so explicitly.
- Repository-wide ESLint now passes with 0 errors and 0 warnings. Generated
  Tauri output and build directories are ignored explicitly.
- Android runtime evidence is from a KVM emulator, not a physical phone. The
  release APK is ARM-only and debug-signed for sideloading.
- iOS builds are not claimed.
