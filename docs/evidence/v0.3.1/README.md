# JCode Mobile v0.3.1 evidence

All times local to the test host (macOS 26, Darwin 25.1.0, arm64). The pinned
harness was `ddawnlll/jcode` at `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8`
(Harness API 1.11). The adapter ran from this repository, versioned `0.3.1`.
The legacy Expo client and the production daemon were not part of the run.

## Scope

This release fixes nine defects found by an on-device audit of the published
v0.3.0 APK on a real ARM emulator (`jcode-audit-api35`, Pixel 7, API 35,
google_apis, arm64-v8a) against an isolated staging JCode daemon and adapter.
Three of the defects were correctness failures in agent-state handling and are
detailed below.

Artifacts:

- Published release under audit: `jcode-mobile-0.3.0-android-release.apk`,
  SHA-256 `4a79ba0aeaf026949ecbdb57591fc7e18dd87fb47d10c67ff49bf03be63060d2`.
- Same-source patched artifact used to reproduce network-pairing failure:
  `.staging/audit-v030/apktool/patched-release-cleartext.apk`
  (manifest-only `usesCleartextTraffic` change, debug-signed).
- Branch release candidate built from this release:
  `artifacts/jcode-mobile-0.3.1-android-release.apk`,
  SHA-256 `03a6d808524461e12dca1370540eede2e040e179e9f116cec980effb180da562`,
  `versionCode 3001`, `versionName 0.3.1`.

## Environment

See `ENVIRONMENT.md`. The staging daemon, adapter, work directory, and
SQLite journals were isolated under `.staging/audit-v030/`. The production
daemon and live adapter were never started, stopped, or reconfigured.

## Verified fixes on-device (emulator)

| Check | Result |
| --- | --- |
| Published APK launches and renders welcome | PASS |
| Published APK pairs with loopback adapter | FAIL — blocked by manifest cleartext policy |
| Patched APK pairs with loopback adapter | PASS |
| Branch build pairs with loopback adapter (fresh pair, `pm clear`) | PASS |
| Branch build restores credential after force-stop/relaunch | PASS |
| Real multi-step turn (write → read → bash) end to end | PASS |
| Assistant text matches daemon journal ordering and content | PASS |
| Reopen session after tool turn: tool cards and assistant text present | PASS |
| Background during a running turn; server completes; UI catches up | PASS |
| Explicit Stop stops exactly the running turn | PASS |
| Adapter kill → honest offline banner + saved-on-phone state | PASS |
| Adapter restart → automatic reconnect, banner cleared, session restored | PASS |
| Consecutive sends both reach `observed_in_history` | PASS |
| Composer re-enables after each completed turn | PASS |
| New session creates a distinct id; titles and history are not mutated | PASS |
| Switch sessions mid-turn (A → B → A); no cross-contamination | PASS |
| Home shows `Harness online`; no false unavailable banner | PASS |
| Connection banner rendered once; no status-bar overlap | PASS |
| `…observed Ns` timer stops when `turn_done` reconciles | PASS |
| Artifact builds, zipaligns, signs, and verifies | PASS |

## Automated checks

| Check | Result |
| --- | --- |
| `cargo test --workspace` | PASS, 32 passed |
| `cargo fmt --all -- --check` | PASS |
| Stillness production bundle (`tsc --noEmit && vite build`) | PASS |
| `bun run adapter:test` | PASS, 27 passed |
| New regression tests (distinct create ids; tool rows survive snapshot; pending operation promotes) | PASS |
| Marketing site build + Playwright matrix | PASS |
| Root `bun run check` | PASS |

## Screenshots

| Capture | Meaning |
| --- | --- |
| `REL-A01-welcome.png` | Published APK, cold start, welcome render |
| `REL-A02-pair-cleartext-fail.png` | Published APK cannot reach the loopback adapter |
| `PATCH-A02-paired.png` | Patched artifact pairs |
| `PATCH-C01-session-done.png` | Completed live turn with 3 tool calls |
| `PATCH-D01-snapshot-loss.png` | v0.3.0 snapshot loses all tool rows |
| `PATCH-E01-composer-locked.png` | v0.3.0 composer locked after one turn |
| `PATCH-F01-stop.png` | Explicit Stop with scope note |
| `PATCH-R03-adapter-down.png` | Kill/reconnect banner and saved-on-phone state |
| `PATCH2-A02-paired-home.png` | Branch build: fresh loopback pair, `Harness online`, no false banner |
| `BR-FINAL-home.png` | Branch build home after relaunch/restore |
| `BR-FINAL-session.png` | Branch build session with completed tool turn |
| `V031-home.png` | Branch build rail footer reports `v0.3.1` |

## Known limits

- ARM emulator verification only; physical devices are `NOT_RUN`.
- No Play Store release, release keystore, or signed iOS artifact.
- LAN plain-http pairing to a non-loopback address is not allowed; use TLS
  or a tunnel.
- R-01 (network drop during stream) and R-05 (duplicate-event injection)
  remain untested.
- TypeScript/UI in the legacy Expo client was not exercised beyond its
  existing CI surface.
