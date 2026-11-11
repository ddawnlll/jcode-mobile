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
- No Java, Android SDK, Xcode, or iOS simulator.

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
| Stillness typecheck and production web build | PASS | `tsc --noEmit && vite build`; 431.88 kB JS / 142.43 kB gzip, 39.89 kB CSS / 8.37 kB gzip |
| Stillness lint | PASS (new surface) | `eslint apps/stillness/src`: 0 errors, 11 unused-symbol warnings |
| Repository-wide ESLint | FAIL (pre-existing) | `bun run lint` also covers the legacy Expo app: 953 errors / 1003 warnings, none in the v0.3.0 surface except the 11 warnings above |
| Real isolated JCode daemon + curated SDK handshake | PASS | `scripts/stillness-e2e.sh` with the pinned fork binary; adapter health reports `jcode_connected:true` |
| Pairing, reload persistence, mobile session/draft/rename/plan/activity/files/preferences | PASS | Playwright Chromium, isolated daemon, real adapter |
| Desktop three-pane layout | PASS | Playwright Chromium 1280x900 |
| Delivery truth and stop-only cancellation | PASS | Unique-token Command Code generation, accepted state, no pending card, navigation does not cancel, explicit Stop hides the control |
| Command Code live model generation | PASS | `deepseek/deepseek-v4-flash` returned `stillness-mwch91ic-ok`; transcript journal and `stillness-mobile-accepted.png` |
| Native Linux Tauri release build | PASS | `scripts/build-tauri-linux.sh`; 5,071,384-byte binary |
| Native Linux Tauri launch | PASS (shell + frontend) | Xvfb capture `native-tauri-launch.png`; not an OS-keyring pairing test |
| Android build | BLOCKED | no Java or Android SDK installed on this host |
| iOS build | NOT_APPLICABLE | requires macOS and Xcode; outside this Linux host |

## Commands and observed results

```sh
cargo test --workspace
# 30 passed, 0 failed

cargo fmt --all -- --check
# exit 0

bun run typecheck
# exit 0; the legacy Expo surface and root scripts typecheck

cd apps/stillness && bun run build
# tsc --noEmit passes; Vite production build succeeds

cd ../.. && ./node_modules/.bin/eslint apps/stillness/src
# exit 0, 0 errors, 11 warnings

bun run lint
# FAIL: 953 errors / 1003 warnings in the legacy Expo surface; kept as a
# baseline observation, not reported as a pass

bash scripts/stillness-e2e.sh
# exit 0; 4 passed, 3 skipped (project-specific guards), ~30 s
```

The pinned e2e run creates an isolated home at `.staging/stillness/daemon`,
requires no production daemon, and serves the production bundle from the Rust
adapter on `127.0.0.1:7650`.

## Native Linux evidence

`scripts/build-tauri-linux.sh` used the user-space GTK 3 / WebKitGTK 4.1 prefix
because the host lacks development packages and sudo. The release build took
3m55s with `--no-bundle` and produced:

```text
apps/stillness/src-tauri/target/release/stillness   5,071,384 bytes
```

Launch evidence required three host workarounds, all outside the repository:

- `Xvfb :99` from the same user-space prefix, with `xkbcomp` and `dash`
  exposed in a private mount namespace.
- `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` pointed at writable
  scratch directories because `$HOME/.local` is root-owned.
- A user-namespace overlay exposed the extracted
  `webkit2gtk-4.1/WebKitNetworkProcess` at its compiled `/usr` path.

The app stayed alive and rendered the Stillness welcome screen; the framebuffer
capture is `native-tauri-launch.png`. This proves the native shell and embedded
bundle launch. It does **not** prove OS-keyring pairing: no Secret Service or
D-Bus session was available under Xvfb, so credential storage and a full native
pairing round trip are `NOT_RUN`.

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
| Adapter RSS | 21,472 KB | debug binary, 88 s uptime, after full Playwright suite |
| Adapter CPU | 0.9% average | same run, `ps` average |
| Adapter threads | 16 | includes Tokio workers and one global-event supervisor |
| Adapter store-ready to harness-connected | 22 ms | adapter log timestamps; process spawn-to-ready not instrumented |
| Native Tauri RSS | ~110 MiB (112,552 KB) | release binary, welcome screen under Xvfb |
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

## Claim boundaries

- Playwright Chromium is browser coverage. It is not Android, iOS, or native
  Tauri verification.
- The web preview stores the device token in `localStorage`; Settings says so.
  The Tauri shell uses `keyring`, but its OS secret-service path was not
  exercised under Xvfb.
- No Command Code API key is read, logged, or stored by the adapter, the web
  bundle, SQLite, or Playwright state.
- A model appearing in `ListModels` is reported as listed; entitlement is not
  invented.
- File-level changes are not exposed by the curated SDK. The Changes screen
  says so explicitly.
- The repository-wide ESLint failure predates this work and remains open. The
  v0.3.0 surface was linted separately.
- Android release and iOS builds are not claimed.
