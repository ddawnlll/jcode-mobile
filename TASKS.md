# JCode Mobile — task ledger

Status: DONE / DOING / TODO / BLOCKED / FAIL, with `NOT_RUN` and `PARTIAL` for verification items. A gate is only DONE with evidence in `docs/VERIFICATION.md`.

## Phase 1 — Bootstrap (G0)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 1.1 | Inspect handoff ZIP, hash, all docs, 12 captures, diagrams | DONE | Hash matches `ee01b6fa…13344e`; docs read; images inspected |
| 1.2 | Preflight toolchain record | DONE | `docs/TOOLCHAIN.md` |
| 1.3 | Install 4 project skills at pinned commits | DONE | `.jcode/skills/`, provenance recorded |
| 1.4 | Merge agent-device MCP config | DONE | `.jcode/mcp.json` |
| 1.5 | Scaffold Expo SDK 58 strict TS app | DONE | Native dev build launched |
| 1.6 | Private GitHub repository | DONE | `ddawnlll/jcode-mobile`, private, pushed |
| 1.7 | Android SDK/JDK + emulator | DONE | SDK 36, JDK 17, AVD booted |

## Phase 2 — Contract and continuity (G1)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 2.1 | Verify protocol at v0.99.1 source | DONE | `docs/ADAPTER_CONTRACT.md` |
| 2.2 | Authenticated WSS + pairing via JCode registry | DONE | Real `jcode pair` code pairs iOS and Android |
| 2.3 | Attach with `continue_on_disconnect: true` | DONE | Contract test + A01 |
| 2.4 | Bounded history + identity fencing | DONE | base index, total, tail fingerprint, attachment/turn ids |
| 2.5 | Delivery ledger for accepted ids | DONE | implemented; A05 native test NOT_RUN |
| 2.6 | Isolated staging daemon | DONE | private home/runtime dirs, no production contact |
| 2.7 | Continuity proof A01 | DONE | `docs/evidence/continuity-*.json` |

## Phase 3 — Vertical slice (G2)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 3.1 | Design tokens, fonts, theme | DONE | Light/Night, native captures |
| 3.2 | Sessions list (inventory, search, groups) | DONE | Native captures iOS + Android |
| 3.3 | Conversation (virtualized, seam, stream) | DONE | Native captures; real streamed reply |
| 3.4 | Send/accept/reconcile states | DONE | `APP-DONE` round trip; delivery states implemented |
| 3.5 | Exit/reopen exact session | DONE | Last-route restore on both platforms |

## Phase 4 — Complete base workflows (G3)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 4.1 | Work sheet, tool rows, detail, file read | DONE | Live and historical rows deduped by call id; file read capability-gated |
| 4.2 | Plan tab only when reported | DONE | Hidden with zero todos |
| 4.3 | New session sheet + validation | DONE | Native create with server folder + first instruction; returned id used for attach |
| 4.4 | Connect/pair, server details, appearance | DONE | Deep-link pairing, revoked re-pair, server details, Night |
| 4.5 | Archive/restore with undo | DONE | Undo notice, archived list toggle, restore action |
| 4.6 | Persistence: SecureStore, SQLite, drafts, cache | DONE | Serialized transactions; bounded cache; no transaction errors in final runs |
| 4.7 | Offline/recovery states | DONE | Android offline capture + reconciliation |

## Phase 5 — Craft, reliability, delivery (G4/G5)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 5.1 | Accessibility, 200% text, reduced motion | DONE (manual SR NOT_RUN) | Large-text capture; AX tree inspected |
| 5.2 | Visual critique and refinement | DONE | Seam, dock, scrim, composer, spine fixes |
| 5.3 | Performance measurements | PARTIAL | Android emulator baseline recorded; physical performance NOT_RUN |
| 5.4 | Tests: unit, RNTL, contract | DONE | 34 tests + 7 adapter tests |
| 5.5 | Android APK + iOS Simulator `.app` | DONE | Final v0.1.3 checksums `eb5c7029…1960` / `d5b5259a…8586`; both installed and launched |
| 5.6 | CI, README, notices, push | DONE | CI run `42497990160` success; private draft assets verified; repo private |

## Genuine blockers

- Live VPS (`v7-remote`) unreachable: SSH resets. Live-VPS acceptance remains BLOCKED; isolated local staging used.
- Physical iOS device and Samsung A34 not attached: physical performance/battery/manual screen-reader checks NOT_RUN.
- The manual screen-reader pass remains NOT_RUN; A06, A09, and performance are PARTIAL. A05/A07/A08/A10/A15/A16 are now PASS.

## Phase 6 — v0.1.4 reliability (#2–#11)

Status is DONE only with evidence in `docs/V0_1_4_VERIFICATION.md`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 6.1 | Connection ownership, retry intent, attempt deadline (#2, #4) | DONE | Fake-time controller regressions; late A failure cannot mutate B |
| 6.2 | Foreground health, adapter/daemon distinction, contact timestamps (#3) | DONE | Silent socket retired; inventory failure is not Current |
| 6.3 | Inventory polling intent across background/resume (#5) | DONE | Timer restored with one owner |
| 6.4 | Forget resets navigation; Disconnect stays distinct (#6) | DONE | Playwright forget/back flow |
| 6.5 | Handshake readiness and socket fencing (#7) | DONE | Transport tests for reject, timeout, late callbacks |
| 6.6 | Exact-session title ownership and cache persist (#8) | DONE | Controller fencing tests; offline reopen Playwright |
| 6.7 | Authoritative rename confirmation and errors (#9) | DONE | Adapter confirmation/rejection/ambiguous/busy tests |
| 6.8 | Pairing deadline covers body and is cancellable (#10) | DONE | Timeout and late-success-after-forget tests |
| 6.9 | Sessions Retry reconnects; Server details recovery (#11) | DONE | RNTL wiring test; Playwright recovery |
| 6.10 | Batch verification and handoff | DONE | check 52/52, adapter 11/11, e2e 10/10; Android/iOS NOT_RUN |

## Phase 7 — v0.2.0 Tidal Glass and Bun (#1)

Status is DONE only with evidence in `docs/V0_2_0_VERIFICATION.md`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 7.1 | 11 families / 22 palettes and independent prefs | DONE (web) | Theme registry, Appearance screen, persistence, Playwright family loop |
| 7.2 | Welcome, live preview, pending loader | DONE (web) | 1.6 s ASCII character-grid reveal, demo preview, 1,400 ms pending mark, reduced-motion still frame |
| 7.3 | Rich content pipeline | DONE (web) | Typed CommonMark/GFM/math parser, highlight.js, native math, code full view, parser tests |
| 7.4 | Message copy and images | DONE (web) | Copy text/Markdown, composer picker, bounded adapter tuples, Markdown images |
| 7.5 | Projects, folder browser, new-session transaction | DONE (web) | Real adapter directory tests; create/configure/send flow; staging app spec |
| 7.6 | Composer, context, thinking, work rail, menus, find, changes | DONE (web) | Playwright v020 spec passes at 390/412; 320 narrow spec passes |
| 7.7 | Bun sole runtime and package manager | DONE (prebuild + Android debug CI) / NOT_RUN (Node-free release) | Lock/scripts/CI/Jest/adapter/export; Bun-only PATH proof; generated Gradle uses Bun; CI `assembleDebug` pass; no JDK/SDK on VPS |
| 7.8 | Bun vs Node performance | DONE | Cold readiness and RSS improve; p95 recorded |
| 7.9 | Playwright full suite | DONE | 20/20 passed in 3.2 min; iPhone 14, Pixel 7, 320-wide |
| 7.10 | PR for issue #1 | DONE | PR #13, candidate head, CI, coverage matrix and screenshots |
| 7.11 | v0.2.0 Android APK release | DONE | CI release build, 63 MiB debug-signed APK, SHA-256, GitHub release v0.2.0 |

## Phase 8 — v0.2.1 animated ASCII welcome (#14)

Status is DONE only with evidence in `docs/V0_2_1_VERIFICATION.md`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 8.1 | Full-screen ASCII reveal with torus, field, noise and title silhouette | DONE (web) | 67 x 105 grid at 390 x 844; 1.6 s assembly; bitmap title handoff; `asciiTorus.test.ts` |
| 8.2 | Idle spin with bounded redraw and reusable raster | DONE | Outside field reused verbatim; torus band only (32 of 105 rows); 80 ms idle interval |
| 8.3 | Skip, Pause/Play, AppState and focus pause, Reduce Motion still | DONE (web) | `welcome.spec.ts` skip, pause/resume and reduced-motion tests; timer guards inspected |
| 8.4 | Keep pairing, theme preview, Preview without connecting and saved-server routing | DONE | `welcome.spec.ts`; `welcome-screen.test.tsx`; existing connect/narrow specs |
| 8.5 | Playwright and RNTL coverage | DONE | 81 Jest/RNTL tests; 26/26 app e2e including the short-narrow welcome case |
| 8.6 | Android release APK | DONE (CI) / NOT_RUN (device install) | CI release build, checksum in `docs/BUILD_STATE.md` |
| 8.7 | README, website, marketing tests and docs | DONE | Real 0.2.1 welcome captures; 76 marketing tests pass |
| 8.8 | Native pacing, large text and screen reader | NOT_RUN | No physical Android/iOS device or macOS host in this session |

## Phase 9 — v0.3.0 Adapter v2 and Stillness 12

Status is DONE only with evidence in `docs/evidence/v0.3.0/README.md`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 9.1 | Rust Adapter v2 (protocol, SQLite WAL, auth, roots, operations) | DONE | 30 Rust tests; workspace compiles; `cargo fmt` clean |
| 9.2 | Stillness 12 web surface and three-pane desktop | DONE (Chromium) | Production Vite build; Playwright mobile and desktop projects pass |
| 9.3 | Isolated pinned-daemon integration | DONE | `scripts/stillness-e2e.sh` against `0abff12c7`; adapter health connected |
| 9.4 | Real Command Code generation and delivery truth | DONE | Unique token generated via `deepseek/deepseek-v4-flash`; accepted state; no pending card |
| 9.5 | Stop-only cancellation and navigation persistence | DONE | Playwright stops one active turn after leaving and reopening the session |
| 9.6 | Tauri desktop shell with OS credential storage | DONE | Release build and Xvfb launch PASS; Secret Service round trip and UI pairing PASS; relaunch restored the keyring credential |
| 9.7 | Native Linux release artifact | DONE | 5,071,384-byte release binary built with user-space GTK/WebKit |
| 9.8 | Android build | DONE | JCode Mobile 0.3.0 APK (Stillness client) built with JDK 21/SDK 37/NDK 27, 11,020,965 bytes, SHA-256 `4a79ba0a...`; API 36 emulator launch, real adapter pairing, and credential restore PASS. Physical-device validation NOT_RUN |
| 9.9 | iOS build | NOT_APPLICABLE | requires macOS and Xcode |
| 9.10 | Repository-wide lint | DONE | Repository and Stillness lint pass with 0 errors and 0 warnings; generated/vendored paths ignored explicitly |
| 9.11 | Performance measurements | PARTIAL | Adapter RSS/CPU and native RSS measured; cold-start and frame timing NOT_RUN |

## Phase 10 — v0.3.1 audit fixes and release

Status is DONE only with evidence in `docs/evidence/v0.3.1/README.md`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 10.1 | Android ARM audit of published 0.3.0 | DONE | 9 bugs documented in `docs/evidence/v0.3.1/BUGS.md` |
| 10.2 | Authoritative history via attach + get_history | DONE | Snapshot shows tool rows and the latest assistant message; regression test `snapshot_after_finished_tool_turn_includes_tool_rows_and_promotes_pending` passes |
| 10.3 | Session identity for create | DONE | New session yields a distinct id; create idempotency regression test passes; verified on-device with `Audit run three` |
| 10.4 | Pending-operation promotion and composer re-enable | DONE | Consecutive sends both reach `observed_in_history`; composer re-enabled; `SessionScreen` no longer marks finished turns `streaming` |
| 10.5 | Android packaging: loopback cleartext carve-out | DONE | Fresh pair over loopback HTTP verified on-device against an isolated adapter |
| 10.6 | Status truth: no false harness-unavailable banner; single banner; reconciled finish state | DONE | Zero `.connection-banner` nodes when healthy; observed block timer stops at turn_done |
| 10.7 | Isolated-daemon marketing capture pipeline | DONE | `marketing-media/capture-stillness-screens.mjs` reports `errors: []`; `marketing:test` passes 76/76 |
| 10.8 | Release artifact | DONE | `artifacts/jcode-mobile-0.3.1-android-release.apk`, `versionCode 3001`, `versionName 0.3.1`, sha256 `03a6d808…`; release notes in `docs/V0_3_1_RELEASE_NOTES.md` |

Known open items carried into 0.3.1: physical Android device validation NOT_RUN,
a human screen-reader pass NOT_RUN, LAN plain-http pairing intentionally not
supported, interactive tool input/approval NOT_IMPLEMENTED.

## Phase 11 — v0.4.0 Elegance (Adapter v3, native Android, gestures)

Status is DONE only with evidence in `docs/evidence/v0.4.0/`.
Release tracker: #53. Branch: `feat/adapter-v3`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 11.1 | Adapter v3 protocol and negotiation (#54) | DONE | v3 + v2 accepted, negotiated version per connection, outbound frames normalized, handshake at v2, 10 conformance tests, real v2/v3 handshake smoke PASS |
| 11.2 | Durable journal, replay, idempotency (#55) | DONE | transactional seq, retention floor + gap flag, ack cursor, restart replay test, 10k bounded test, reconnect smoke with 0 duplicates and no re-execution |
| 11.3 | Bridge supervision and health (#56) | DONE | supervisor retained; last contact/error, reconnect count, active turns, connection/frame counters |
| 11.4 | Cache-first startup and delta sync (#57) | DONE (web) | cached paint with socket blocked 60 ms, shell-to-paint 56 ms, delta merge + tombstones, stale fallback; Android measurement in 11.13 |
| 11.5 | Diagnostics and fault injection (#58) | DONE | `diagnostics.snapshot` real counters + p50/p95; `JCODE_ADAPTER_FAULTS` with tests |
| 11.6 | Android background companion (#59) | DONE | WorkManager periodic job scheduled with `batteryNotLow`, `GET /health` probe returned 200, on/off setting persisted |
| 11.7 | FCM registration and push (#60) | PARTIAL | registration/preferences/dedupe/FCM v1 sender + tests; real delivery NOT_RUN (no Firebase credentials) |
| 11.8 | Notifications, channels, deep links (#61) | DONE | Three channels, system permission prompt, grouped post, preview redaction, permission-denied path, deep link consumed on API 36 |
| 11.9 | Sharesheet, pickers, downloads, clipboard (#62,#64,#65,#68) | PARTIAL | Inbound/outbound share, photo picker, image decode, downloads, open-with, clipboard redaction and haptics PASS on API 36; camera capture and camera QR blocked on the AVD |
| 11.10 | Biometric lock, lifecycle, insets, back (#63,#66) | DONE | Device-credential fallback unlock, Keystore vault round trip, insets, IME, predictive back and rotation preserved the WebView on API 36 |
| 11.11 | Shortcuts, widget, Quick Settings (#67) | PARTIAL | Dynamic shortcuts and the Quick Settings tile PASS; widget provider registered, launcher placement NOT_RUN |
| 11.12 | Gestures and motion (#69,#70) | DONE (Chromium) | 14 browser checks PASS (`evidence/v0.4.0/ui/verify.json`), screenshots `evidence/v0.4.0/ui/`; native frame pacing NOT_RUN |
| 11.13 | Conversation, navigation and model UX (#71,#72,#48,#77,#50,#51,#52,#44,#36) | DONE (Chromium) | timeline ordering, copy, switcher, model disambiguation, slider, permission panel, title stability; 7 node checks + e2e PASS |
| 11.14 | Correctness (#28,#29,#37) | DONE | stop rejects contradictory ids; create retry idempotent; exact route/effort tests |
| 11.15 | Session actions (archive/restore/favorite/delete) | DONE (adapter) / UI wiring in progress | authoritative archive/restore/favorite with tests; delete refused honestly |
| 11.16 | Image attachments (#49) | DONE | validation, persistence, SDK image send, conflict tests; photo picker opens and `native_read_image_base64` returns `ok`/`too_large`/`unsupported_type` on API 36 |
| 11.17 | Android E2E matrix (#73) | PARTIAL | Emulator matrix run for notifications, share, pickers, biometric, downloads, clipboard, layout, back, settings, restart restore and one real turn; process death, airplane mode and chaos runs pending |
| 11.18 | Migration, release APK, rollback (#74) | DONE | `docs/V0_4_0_MIGRATION.md`; APK 12,693,953 bytes, versionCode 4000, SHA-256 `db6fadf9…d86ca531`; installed, paired, restart-restored and ran one real turn on API 36 |
| 11.19 | Battery, accessibility, privacy audit (#75) | PARTIAL | contrast and target sizes measured; screen reader, battery, frame pacing NOT_RUN |
| 11.20 | CI builds the current Tauri app (#73/#74) | DONE (workflow) | Rust job + Stillness Android APK job added; CI run itself NOT_RUN until pushed |

### 0.4.0 release checklist (2026-11-14)

Documentation and artifact items are done. Anything without an observation is
left `NOT_RUN`; no item is promoted because another item passed.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 11.21 | README rewritten for 0.4.0 | DONE | Adapter v3, Stillness gestures and motion, native Android, artifact identity, verified/not-verified split |
| 11.22 | Build state rewritten for 0.4.0 | DONE | `docs/BUILD_STATE.md`: branch, 18 commits, components, checks, APK bytes/SHA/versionCode, gaps |
| 11.23 | Evidence index | DONE | `docs/evidence/v0.4.0/README.md`: every artifact and screenshot mapped to a claim, plus PASS/PARTIAL/NOT_RUN matrix |
| 11.24 | Adapter v3 test evidence | DONE | 72 Rust tests (28 core, 10 protocol, 17 server lib, 17 integration); `cargo fmt` and `clippy -D warnings` clean |
| 11.25 | Real-daemon adapter smoke | DONE | `docs/evidence/v0.4.0/adapter-v3-smoke.txt`: real turn `OK`, journal seq 7, replay 0 duplicates, one accepted operation |
| 11.26 | Browser e2e evidence | DONE | `stillness-e2e.txt` 4 passed / 3 skipped; `stillness-e2e-perf.txt` 5 passed / 3 skipped with timings |
| 11.27 | UI interaction evidence | DONE | `ui/verify.json` 14/14 PASS, 14 captures in `ui/` |
| 11.28 | Release APK built and verified | DONE | 12,693,953 bytes, versionCode 4000, minSdk 24, target/compile 37, v2+v3 signed, zipalign ok, SHA-256 matches `.sha256` |
| 11.29 | Release APK on API 36 emulator | DONE | Install, launch, pair (`DEVICE TOKEN ACCEPTED`, Adapter 0.4.0, harness connected), restart restored the exact session with history, one real turn accepted and answered on device (prompt truncated to `Repl`, agent asked about a REPL) |
| 11.30 | Website and marketing source versions | DONE | Current-release text moved to 0.4.0 in `website/index.html`, `docs/MARKETING.md`, `e2e/marketing/urls.ts`, `layout.spec.ts`, `a11y.spec.ts`; not rebuilt or redeployed |
| 11.31 | Physical Samsung A34 | NOT_RUN | No device attached |
| 11.32 | Real FCM delivery | NOT_RUN | No Firebase credentials; registration is `not_configured` |
| 11.33 | TalkBack / VoiceOver walkthrough | NOT_RUN | No human screen-reader session |
| 11.34 | Battery measurement (mAh, wake locks) | NOT_RUN | Not measured |
| 11.35 | Frame pacing / 120 Hz | NOT_RUN | Not measured |
| 11.36 | CI workflow execution | NOT_RUN | Workflow committed; not pushed or run |
| 11.37 | Release tag and GitHub release | NOT_RUN | `v0.4.0` tag/release not created; the website CTA depends on the released APK asset |
