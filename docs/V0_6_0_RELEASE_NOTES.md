# JCode Mobile 0.6.0 — Animate!

Release date: 2026-11-16
Protocol: Adapter v4 (negotiates v2, v3, v4)
Android package: `dev.jcode.stillness`, versionCode 6000, versionName 0.6.0

## What changed

### Intent-first tools

- JCode's required model-supplied `input.intent` is now the primary collapsed
  label. The raw intent is shown verbatim; absence is never filled with a
  guessed goal.
- File tools are filename-first: `toolLabels.ts` is the collapsed identity,
  with a short relative directory hint and the full path plus copy action when
  expanded.
- Commands show the exact shell text, working directory when reported,
  combined output, attached source diff, and an exit code only when JCode wrote
  one. `not reported` is used otherwise; zero is never invented.
- Write/edit/apply-patch cards separate requested input from authoritative
  result. Edit cards show requested before/after; file results use JCode's
  own `File diff` block, with `+/-` counters computed only from those lines.
- Restored history rows are labelled `Result received` in a neutral style, not
  green `Completed`, because persisted rows lack the native error bit.
- Raw JSON is an optional details section. It is never the only expanded view.
- Compact previews redact common credential shapes. Expanded evidence and copy
  actions remain exact.
- No adapter wire change: the same descriptors work with v2, v3 and v4 input
  forwarding. Provenance matrix: [`docs/TOOL_PRESENTATION.md`](TOOL_PRESENTATION.md).

### Semantic motion

- One documented ownership contract: CSS owns presence/state transitions; the
  existing handwritten rAF spring remains the only owner of pointer-driven
  drawer/sheet/row movement. No Motion/Framer Motion or Lottie dependency was
  added. See [`docs/MOTION.md`](MOTION.md).
- Tool cards animate only while genuinely `started`/`running`. Settled history,
  snapshot reconciliation and replay render in place with no arrival cascade.
- Reasoning uses a real torus and `thinking` → `complete` state. Swarm status
  pulses only when the reported status string changes. Permission requests
  enter on the real event.
- The Torus pauses offscreen and while the document is hidden.
- Expanding a card anchors the tapped head; measured delta 0 px at 360×800.
  Restored mid-history positions do not re-enable auto-follow. `Jump to latest`
  is smooth only when motion allows.
- An authoritative idle snapshot removes live blocks already present in
  history (matched by text and `call_id`). Unmatched tools remain visible as
  `unknown`; with no history, all live work is kept. This fixes duplicate cards
  after completion and reconnect.

### Mobile polish and accessibility

- Session header uses a labelled PanelLeft trigger instead of an ellipsis.
  Drawer navigation has consistent family icons (checklist, folder, activity,
  edit, settings).
- Drawer focus enters Close, traps Tab, closes on Escape/Android back/scrim,
  and returns to the opener after the spring settles.
- Tool-head copy targets are 48×48; shared copy controls remain 44×44. Copy
  haptics distinguish success from failure. Drawer settle haptics fire only on
  pointer-driven settles.
- Motion settings are System / Full / Subtle / Off. System follows OS
  `prefers-reduced-motion`; explicit Full overrides it; Off clamps
  nonessential motion to 0.001 ms and stops the Torus. The 0.5.0 `reduced`
  value migrates to `off`.
- Turn and tool states use polite live regions; the elapsed-seconds timer is
  hidden from assistive technology. Expandable cards use native button
  semantics with `aria-expanded` and `aria-controls`.
- Details: [`docs/ACCESSIBILITY.md`](ACCESSIBILITY.md).

### Reliability

- Authoritative idle snapshots release stale turn IDs while preserving work
  that is not present in history (#80).
- Stop conflict requests a bounded snapshot and transitions to a visible
  reconciling state instead of leaving the composer locked.
- Unfinished tools become `unknown`/`reconciling`; they are never marked
  `DONE` merely because a turn ended.
- Late events from an older session or turn remain fenced by session,
  generation and turn identity.

## Verification

| Check | Result |
| --- | --- |
| Rust formatting | PASS, `cargo fmt --all -- --check` |
| Rust clippy | PASS, workspace + all targets, `-D warnings` |
| Rust workspace tests | PASS, 96 (42 core + 10 protocol + 25 server lib + 19 integration) |
| Legacy JavaScript tests | PASS, 14 suites / 139 tests |
| Stillness pure checks | PASS, 23/23 (intent, aliases, partial JSON, paths, redaction, exit/diff/ANSI/100 KB, motion resolver) |
| Controller reconciliation | PASS, 16/16 (stale turn, Stop conflict, daemon idle/running/unknown, tool settlement, live/history dedupe) |
| Stillness production build | PASS, 129.12 kB gzip initial JS / 13.09 kB gzip CSS |
| Stillness web e2e | PASS, 5 passed / 3 skipped against isolated daemon + Adapter v4 (`STILLNESS_E2E_MODEL=gpt-5.6-luna`) |
| Android release APK | PASS, versionCode 6000, versionName 0.6.0, v2 + v3 signatures, minSdk 24, targetSdk 37 |
| Android emulator install and launch | PASS, API 36 arm64 emulator, 360 dp, cold start 579 ms |
| Android real provider tool turn | PASS, gpt-5.6-luna: intent “Print final E2E proof and OS”, exact command, `final-e2e` / `Darwin` output, neutral `RESULT` |
| Android Stop recovery | PASS with delay: unresolved `sleep 60` becomes `RECONCILING`, composer unlocks; one attempt required repeated reconciliation |
| Android adapter-loss / reconnect | PASS: saved-on-phone banner with history; adapter restart reconnects, banner clears, no duplicate cards |
| Android drawer tap / system back / focus | PASS: tap opens, back closes without exiting, focus returns to Open sidebar |
| Android emulator frame timing | PASS (measurement only), 351 frames: p50 53 ms, p95 69 ms, p99 85 ms, 58.97% janky on software-rendered emulator; **not a physical-device or 60/120 Hz claim** |
| Android emulator memory | PSS ~81,931 kB after the final turn |
| Physical Android device | **NOT_RUN** |
| TalkBack / 200% font scale | **NOT_RUN** |
| 10k+ timeline and 1 MB output on Android | **NOT_RUN** (100 KB+ payload is covered by unit checks) |
| Verified JCode background handoff (auto_background_timeout) | **NOT_RUN** for 0.6.0 |
| 120 Hz frame budget | **NOT_RUN** |
| iOS | NOT_RUN; no IPA on this host |

### Android edge-gesture note

On the API 36 emulator, a pointer swipe from the extreme left edge is consumed
by Android system back before the WebView, as intended by the #89 rule that
system back owns its gesture. The drawer remains fully operable by the
PanelLeft button, and the existing edge-swipe surface is retained for hosts
where the system does not reserve that edge.

## Artifact

```text
jcode-mobile-0.6.0-android-release.apk
12,726,721 bytes (12.14 MiB)
SHA-256 2d76b6793960df4070c21cd3960d3dc374e38c9821102a32565d8a4e3c0f3941
package dev.jcode.stillness
versionCode 6000, versionName 0.6.0
minSdk 24, targetSdk 37, compileSdk 37
arm64-v8a + armeabi-v7a
APK Signature Scheme v2 and v3, Android Debug certificate
```

The package identifier and debug signing key are unchanged from 0.5.0, so the
APK updates in place and keeps its device token.

## Upgrade

1. Install the 0.6.0 APK over 0.5.0. The existing pairing token is preserved.
2. The stored motion preference `reduced` migrates to `off`; no reload is
   needed after changing System/Full/Subtle/Off.
3. Adapter v4 protocol is unchanged. 0.5.0 servers remain compatible; no VPS
   adapter restart is required for this client release.

## Rollback

Install the 0.5.0 APK from the previous release. The adapter journal and
session data are unchanged. Revert the client branch if a source rollback is
preferred.

## Known limits

- This is a debug-signed sideload preview, not a Play Store build.
- Physical-device, TalkBack, large-font and 120 Hz evidence is not available
  from this host. The emulator frame numbers above are software-rendered and
  must not be presented as a midrange-phone result.
- Foreground bash merges stdout and stderr in JCode's text result. The card
  labels the block `Output`; it does not fabricate separate streams.
- Automatic background handoff and `bg wait` were not re-verified on 0.6.0.
- One Stop attempt took longer than 25 s to reconcile while a foreground
  `sleep 60` was still unresolved; the composer did recover. This remains the
  top follow-up for the next device pass.
