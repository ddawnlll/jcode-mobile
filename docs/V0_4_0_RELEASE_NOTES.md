# JCode Mobile 0.4.0 — Elegance

Release date: 2026-11-14
Protocol: Adapter v3 (minimum v2)
Android package: `dev.jcode.stillness`, versionCode 4000

## What changed

### Adapter v3

- Versioned handshake with explicit capability negotiation. A v2 phone keeps
  working; a v3 phone negotiates v3 and never receives a frame above its range.
- Durable SQLite event journal with transactional per-session sequence,
  bounded retention, cursor replay, gap markers and per-device acknowledgements.
- `sessions.delta` with a durable revision index and removal tombstones; a
  daemon outage returns the saved index as `stale` instead of an invented state.
- Authenticated `diagnostics.snapshot` with real journal, connection, operation
  and latency counters, plus opt-in fault injection for conformance tests.
- Validated inline image attachments (PNG/JPEG/WebP/GIF, four per message,
  4 MiB each) sent through the harness image channel.
- Push registration, per-kind preferences and dedupe, with FCM HTTP v1 delivery
  when operator credentials are configured. Payloads never contain transcript
  content.
- Adapter-owned favorites and authoritative archive/restore. Delete is refused
  honestly because the daemon has no delete capability.
- `jcode-adapter-v3` binary name; `jcode-adapter-v2` remains as a rollback alias
  and runs the same versioned server.

### Stillness client

- Cache-first startup: the last authorized session and draft paint before the
  network handshake, clearly marked as saved on this phone until reconciled.
- Reconnect uses journal replay from the last cursor; a gap or epoch mismatch
  falls back to an authoritative snapshot.
- Delta session sync with local merge and tombstone removal; no full-list flash.
- Gesture system: finger-following drawer with rubber band and velocity spring,
  draggable sheets, swipe actions with undo, long-press menus, pull-to-refresh,
  predictive back guards that never hijack navigation when nothing is open.
- Motion system: one dependency-free spring loop, transform/opacity only,
  reduced-motion crossfade, rAF-batched streaming text, 220 ms stage transitions.
- Conversation timeline: interleaved reasoning, tool start/input/exec/done and
  assistant text in observed order, expandable results, stable call-id keys.
- One-tap copy on messages, reasoning, tool calls, tool inputs, tool outputs and
  code fences.
- Quick switcher (`Ctrl/Cmd+K`), server-scoped search, favorites, offline use.
- Model picker with instant search, provider chips, grouped routes and duplicate
  name disambiguation by provider and API method. Reasoning effort is a discrete
  snapping slider with haptics and ARIA.
- "Waiting for your approval" panel wired to the real permission response.
- Title stability: the confirmed snapshot title is used while it exists, with
  inventory only as a fallback.

### Native Android (see `docs/ANDROID_NATIVE.md` for the exact matrix)

- Notification channels, Android 13 permission flow, deep links.
- WorkManager reconciliation scheduling with an on/off setting (minimum 15 min).
- Sharesheet in/out, photo picker, document picker, camera, downloads,
  open-with, clipboard and haptics.
- Biometric/Keystore app lock, edge-to-edge insets, IME behavior, predictive
  back bridge, app shortcuts, widget and Quick Settings tile where implemented.
- Unified settings bridge for notifications, background sync, motion, haptics
  and privacy.

## Verification

| Check | Result |
| --- | --- |
| `cargo test --workspace` | PASS, see `docs/evidence/v0.4.0/` |
| `cargo fmt --check`, `cargo clippy -D warnings` | PASS |
| Stillness `tsc --noEmit && vite build` | PASS |
| UX helper checks (`scripts/check-stillness-ux.mjs`) | PASS 7/7 |
| Browser e2e against real daemon + Adapter v3 | PASS 4, skipped 3 by design |
| Adapter v3 real-stack smoke (real agent turn) | PASS |
| Android Kotlin compile | PASS on this host (JDK 24, SDK 36) |
| Android release APK | see `docs/BUILD_STATE.md` |
| Android emulator install/launch | see `docs/BUILD_STATE.md` |
| Physical Android device | NOT_RUN (no device attached) |
| FCM delivery | NOT_RUN (no Firebase credentials) |
| Screen reader, frame pacing, battery | NOT_RUN / PARTIAL as recorded |

## Known limitations

- `sessions.delete` is not available: the daemon has no delete operation. The UI
  reports the refusal and changes nothing. Archive is the supported alternative.
- FCM delivery requires `JCODE_FCM_PROJECT_ID` and a refreshed
  `JCODE_FCM_ACCESS_TOKEN`. Without them push is explicitly `not_configured`.
- The adapter journal stores event payloads with bounded retention. It is not an
  unbounded transcript archive; authoritative history still comes from the daemon.
- Exactly-once agent execution is guarded by the operation journal, not by the
  event cursor.
- Browser e2e is not native Android verification. Native checks are listed
  separately and are not inferred from Playwright.

## Install

- APK: `artifacts/jcode-mobile-0.4.0-android-release.apk` with the adjacent
  `.sha256`.
- Adapter: run `jcode-adapter-v3` (or keep `jcode-adapter-v2`) with the same
  data directory. Existing devices stay paired.
- Migration and rollback: `docs/V0_4_0_MIGRATION.md`.
