# 0.4.0 evidence index

Scope: JCode Mobile 0.4.0, Adapter v3, Stillness 12, and the Android release
APK. Captured 2026-11-14 against an isolated staging daemon and an isolated
Adapter v3. Nothing here contacted the production daemon or the live adapter.

Statuses are `PASS`, `PARTIAL`, `NOT_RUN`, or `NOT_APPLICABLE`. A `PASS` names
the observation that produced it. Browser evidence is Chromium on the web
target; it is never used to claim Android behaviour.

## Artifacts in this directory

| File | What it is | What it proves | Status |
| --- | --- | --- | --- |
| [`adapter-v3-smoke.txt`](adapter-v3-smoke.txt) | Console trace of the v3 smoke harness plus the health payload and JSON result | Adapter v3 negotiates protocol 3, lists `min_protocol_version: 2`, opens a real session, runs one real agent turn that answers `OK`, records journal `latest_seq: 7`, replays 0 events on reconnect, and leaves exactly one operation `accepted` | PASS |
| [`stillness-e2e.txt`](stillness-e2e.txt) | Playwright run against the real staging daemon + Adapter v3 | Pairing persists the exact server; mobile session restores draft, plan, activity, files, and preferences; delivery reports acceptance honestly and Stop is the only cancellation; desktop three-pane layout renders. Final merged run: 5 passed / 3 skipped | PASS |
| [`stillness-e2e-perf.txt`](stillness-e2e-perf.txt) | Same suite with `perf.spec.ts` added, including the `JCODE_PERF` line | 5 passed / 3 skipped; online first interactive screen 26 ms, cached paint with the socket blocked 71 ms, shell to first paint 63 ms, 6 cold requests / 933,522 bytes, offline saved marker visible | PASS |
| [`stillness-mobile-accepted.png`](stillness-mobile-accepted.png) | Mobile web target after a real turn | The prompt `Reply with exactly: stillness-mwgnmgn4-ok` was answered verbatim, the header shows `Ready · gpt-6.1-sol`, the composer is re-enabled, and the footer states navigation never stops a running turn | PASS |
| [`android-emulator-release.png`](android-emulator-release.png) | 0.4.0 release APK on an API 36 arm64 emulator, fresh install | The release build launches to the welcome/pairing screen with no fatal crash | PASS |
| [`android-emulator-paired.png`](android-emulator-paired.png) | Same install after pairing to a staging Adapter v3 | `DEVICE TOKEN ACCEPTED`, `Adapter 0.4.0`, `Harness jcode-harness-api-bridge/0.1.0`, `JCode harness connected` | PASS |
| [`android-emulator-home.png`](android-emulator-home.png) | Same install after entering the session list | `Harness online` and real sessions from the staging daemon, including the `Adapter v3 smoke` session; not a fixture | PASS |
| Emulator restart | Relaunch the installed release build after the emulator restarts | The app restored the exact session with its history instead of creating a replacement | PASS |
| On-device turn | Type a prompt through `adb` and send it | The prompt reached the agent and a generated reply rendered. The typed prompt was truncated to `Repl`, and the agent answered by asking about a REPL. A real accepted turn and reply, not a fixture; not a completed task | PASS, real turn |
| `ui/verify.json` | Browser interaction results | 14 named checks, all `PASS`: edge-follow drawer, Escape close, one-open-row, local pin, long-press menu, quick switcher, pull-to-refresh offline honesty, sheet dismiss, history back, model search/chips, reasoning slider keyboard + ARIA, icon-button names, reduced motion, interruptible spring | PASS |
| `ui/report.json` | Capture run metadata | Viewport 390 x 844, drawer `aria-hidden` closed state, four expected `ERR_CONNECTION_REFUSED` console entries because `127.0.0.1:7666` was intentionally not running. This is an offline-rendering capture, not a live turn | PASS, offline only |
| `ui/01-home.png` | Home | Pinned-first session list, command affordance, row menu | PASS |
| `ui/02-drawer.png` | Drawer | Drawer open with navigation layers | PASS |
| `ui/03-session-restored.png` | Session restored | Cache-first paint, `Connection closed (1006).` banner, `SAVED ON THIS PHONE`, diff card, copy control, draft preserved | PASS |
| `ui/04-sessions.png` | Sessions list | Archived sessions hidden, refresh controls present | PASS |
| `ui/05-row-swiped.png` | Swipe-left tray | Archive/Delete tray with one row open | PASS |
| `ui/06-quick-switcher.png` | Quick switcher | Pinned group, offline notice, archived sessions excluded | PASS |
| `ui/07-session-timeline.png` | Timeline | Transcript at the latest activity | PASS |
| `ui/07b-session-top.png` | Timeline top | Chronological history, tool card, copy controls | PASS |
| `ui/08-model-picker.png` | Model sheet | Entry state of the model sheet | PASS |
| `ui/09-model-search.png` | Model search | Search, provider chips, duplicate route disambiguation | PASS |
| `ui/10-reasoning-slider.png` | Reasoning slider | Discrete stops and committed value | PASS |
| `ui/11-copied.png` | Copy confirmation | Check icon plus `Copied.` toast | PASS |
| `ui/12-tool-diff.png` | Tool detail | Expanded tool input and diff output | PASS |
| `ui/13-pull-to-refresh.png` | Pull-to-refresh | Finger-following pull with `RELEASE TO REFRESH` | PASS |

The release APK itself is not committed (`*.apk` is gitignored). It is built to
`artifacts/jcode-mobile-0.4.0-android-release.apk`:

| Field | Value |
| --- | --- |
| Bytes | 12,693,953 (12.1 MiB) |
| SHA-256 | `8f5467aad760371facca6603fe38e5b205d895b1fd02f5242af980fc81af9035` (final build with the native shell UI) |
| `.sha256` file | present beside the APK, same digest |
| Package | `dev.jcode.stillness` |
| versionCode / versionName | 4000 / 0.4.0 |
| SDK | minSdk 24, targetSdk 37, compileSdk 37 |
| ABIs | `arm64-v8a`, `armeabi-v7a` |
| Signatures | APK Signature Scheme v2 and v3, `CN=Android Debug` |

## Not covered by these artifacts

These live in other documents and are listed here so the index is not mistaken
for the whole matrix.

| Area | Result | Where |
| --- | --- | --- |
| Adapter v3 unit and integration tests | PASS, 72 (28 core + 10 protocol + 17 server lib + 17 integration) | `docs/BUILD_STATE.md` |
| `cargo fmt --check`, `cargo clippy -D warnings` | PASS | `docs/BUILD_STATE.md` |
| v2 client against a v3 adapter | PASS, negotiates v2 | `docs/V0_4_0_MIGRATION.md` |
| Full-list then incremental delta sync | PASS | `adapter-v3-smoke.txt` (`delta_ids`, `delta_revision`, `unchanged_resent`) |
| Android notifications, sharesheet, downloads, clipboard/haptics, insets, back, settings | PASS on the API 36 emulator | `docs/ANDROID_NATIVE.md` |
| Android biometric path | PASS, device-credential fallback; no enrolled biometric on the AVD | `docs/ANDROID_NATIVE.md` |
| Android image pickers | PARTIAL: photo picker and image decode work, camera capture blocked on the AVD | `docs/ANDROID_NATIVE.md` |
| FCM push | PARTIAL: registration, preferences, dedupe, and the v1 sender exist; `not_configured`, no Firebase credentials, no delivery | `docs/ANDROID_NATIVE.md` |
| Home widget | PARTIAL: provider and layout registered, launcher placement NOT_RUN | `docs/ANDROID_NATIVE.md` |
| Permission minimization, payload privacy, contrast, reduced motion | PASS by code and inspection | `docs/V0_4_0_AUDIT.md` |
| CI workflow | Committed, not executed | `.github/workflows/check.yml` |

## PASS / PARTIAL / NOT_RUN matrix

| Item | Status | Basis |
| --- | --- | --- |
| Adapter v3 negotiation (3 for v3, 2 for v2) | PASS | smoke + conformance tests |
| Durable journal, replay, ack, 0 duplicates | PASS | `adapter-v3-smoke.txt` |
| Delta session sync with tombstones | PASS | `adapter-v3-smoke.txt`, unit tests |
| Diagnostics counters | PASS | `adapter-v3-smoke.txt` |
| Image attachment validation and send | PASS | adapter and client tests |
| Push registration and dedupe | PARTIAL | no delivery |
| Real agent turn through the adapter | PASS | `adapter-v3-smoke.txt`, `stillness-mobile-accepted.png` |
| Browser e2e against the real daemon | PASS | `stillness-e2e*.txt` |
| Browser interaction checks | PASS | `ui/verify.json` 14/14 |
| Startup timings (web) | PASS | `stillness-e2e-perf.txt` |
| Android release APK build, signature, install, launch | PASS | `android-emulator-*.png`, APK inspection |
| Exact-session restore after emulator restart | PASS | emulator run |
| On-device real turn | PASS, accepted turn and reply | emulator run; prompt truncated to `Repl` |
| Android native interaction matrix | PASS on emulator | `docs/ANDROID_NATIVE.md` |
| Android image/camera pickers | PARTIAL | camera blocked on AVD |
| FCM delivery | PARTIAL, not_configured | no credentials |
| Widget launcher placement | NOT_RUN | registered only |
| Physical Samsung A34 | NOT_RUN | no device attached |
| TalkBack / VoiceOver walkthrough | NOT_RUN | no human session |
| Battery (mAh, wake locks) | NOT_RUN | not measured |
| Frame pacing / 120 Hz | NOT_RUN | not measured |
| Native cold start and memory | NOT_RUN | web timings are not native |
| Process death, airplane mode | NOT_RUN | not exercised |
| Native Linux 0.4.0 build | NOT_RUN | last verified 0.3.1 |
| iOS | NOT_APPLICABLE | no signing host or artifact |

## Reproduce

```sh
# 1. Isolated staging daemon and Adapter v3
bash scripts/v3-smoke-up.sh

# 2. Adapter contract
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# 3. Browser e2e against the staging adapter
cd apps/stillness && npx playwright test
cd ../..

# 4. UX helper checks
node scripts/check-stillness-ux.mjs

# 5. Release APK
bash scripts/build-android-release.sh
aapt2 dump badging artifacts/jcode-mobile-0.4.0-android-release.apk
apksigner verify --print-certs -v artifacts/jcode-mobile-0.4.0-android-release.apk
shasum -a 256 artifacts/jcode-mobile-0.4.0-android-release.apk
```

The browser interaction script (`verify.mjs`) and the capture script are
staging-only and not committed; their results are preserved in `ui/`.

## Reading notes and source inconsistencies

- `adapter-v3-smoke.txt` reports `journal_events: 34` in the initial health
  payload, `journal_events: 55` in diagnostics after the turn, and
  `journal_latest_seq: 7` for the turn. The turn produced seven journal events;
  the larger counters are the whole journal plus retention, not this turn.
- `stillness-e2e-final.txt` is the final merged run: 5 passed / 3 skipped. `stillness-e2e-perf.txt`
  records 5 passed / 3 skipped because `perf.spec.ts` is added. The three skips
  are the same in both: the desktop duplicates of the mobile session and
  delivery specs, plus the desktop delivery case.
- `docs/V0_4_0_RELEASE_NOTES.md` says 5 passed for the browser e2e; that is the
  non-perf run. It also says "SDK 36" for the Kotlin compile; the local compile
  used SDK 37, and CI is configured with platform 36. The Android APK itself is
  built against compileSdk/targetSdk 37.
- `TASKS.md` 11.12 says "12 browser checks PASS"; `ui/verify.json` contains 14
  named checks, all `PASS`.
- `docs/V0_4_0_AUDIT.md` cites `stillness-e2e-perf.txt` only for startup
  measurements. The interaction count (14/14) is recorded separately in
  `docs/STILLNESS_UX_0_4.md` and `ui/verify.json`.
- The Android screenshots were captured by the Android worker on an API 36
  arm64 emulator. They are committed here so the index references real files; no
  image was re-encoded.
