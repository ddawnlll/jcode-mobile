# Verification

> v0.1.1 is a corrective release for the independent review of `a632a6a`. The finding-by-finding response is in [`REVIEW_FIXES.md`](REVIEW_FIXES.md). Native evidence below was collected on v0.1.0/0.1.1 staging and remains representative; new regression tests run in CI.

Release records: [`V0_2_0_VERIFICATION.md`](V0_2_0_VERIFICATION.md) and
[`V0_2_1_VERIFICATION.md`](V0_2_1_VERIFICATION.md). The tables below are the
original v0.1.1 native evidence archive.

Updated: 2026-11-08. Evidence is only recorded from commands that actually ran and outputs that exist.

Environment: macOS 26.1 (M3 Pro, 18 GiB), Xcode 26.1.1, iPhone 17 Pro simulator (iOS 26.1), Android emulator `jcode-mobile` (API 36, arm64), Node 22.21.1, JCode 0.99.1 (`7206efd0c`). The live VPS was unreachable.

## Build and static checks

| Check | Status | Command | Observed |
| --- | --- | --- | --- |
| TypeScript strict | PASS | `npx tsc --noEmit` | exit 0, no diagnostics |
| ESLint | PASS | `npx eslint .` | exit 0, 2 style warnings (unused pattern; no errors) |
| Unit + RNTL tests | PASS | `npm test` | 5 suites, 34 tests passed |
| Adapter contract tests | PASS | `node --test integration/jcode-adapter/test/*.test.ts` | 7/7 pass; ACK/ingestion, continuation, indexes/bytes, split UTF-8, retry rollback |
| iOS dev build | PASS | `npx expo run:ios --device "iPhone 17 Pro"` | BUILD SUCCEEDED, launched |
| iOS Simulator release `.app` | PASS | `bash scripts/build-ios-simulator.sh` | BUILD SUCCEEDED; `main.jsbundle` present; zip 24 MiB |
| Android release APK | PASS | `bash scripts/build-android-release.sh`; installed, launched, paired, created sessions, archived/undone, revoked/re-paired on the API 36 emulator; SHA-256 in BUILD_STATE |
| CI workflow | NOT_RUN | `.github/workflows/check.yml` | Added; run result not yet inspected |

## Real JCode integration

| Check | Status | Evidence |
| --- | --- | --- |
| Authenticated pairing via JCode registry | PASS | `jcode pair` code consumed by adapter `POST /pair`; token only in Keychain/Keystore; contract/continuity tests pair successfully |
| Revoked/unknown token rejected | PASS | Adapter returns 401 and logs `rejected unknown or revoked device token`; native flow below (A15) shows the app drops to `Pair again` rather than claiming offline |
| Inventory, create, attach, history, send, streaming | PASS | Real staging sessions listed; created sessions from the app (returned id, instruction sent, replies `NEW-SESSION-OK`/`SECOND-OK`); streamed turn `APP-DONE`; Work shows recorded `bash`/`todo` rows without duplicates |
| A01 transport-loss continuation (force-quit path) | PASS | `docs/evidence/continuity-2026-11-08T12-30-29-022Z.json`: transport terminated mid-tool; six progress lines and `FINAL-…` written while the phone was absent; same session reattached with exactly one matching user message and assistant `COMPLETE`; continuation flag true |
| A04 daemon death | PASS | `daemon-death.ts` output: `interruptedAtAttach: true`, recovery directive present, statuses `idle`, `claimedWorking: false` |
| A02 leave Conversation during a turn | PASS | Native: back to Sessions while `sleep 30` ran; list showed the session in Working; reopening after completion showed the reply, no duplicate history |
| A14 Back navigation does not cancel | PASS | Same run: the turn continued after leaving Conversation; no cancel request observed |
| A18 explicit Stop | PASS | Native: Stop target sent a cancel (adapter log `explicit stop requested`), dock shows red square + `Stopped`, no Stop target remains; adapter suppresses the terminal `done` from flipping to Ready |
| A03 network loss/cache reconciliation | PASS | Android: adapter stopped, `Offline. Last checked at 17:32. Saved history only.` with editable draft; adapter restarted, Retry reconciled authoritative history and showed a 10-update seam. Full airplane-mode stack not tested |
| A05 ambiguous delivery | PASS | `JCODE_ADAPTER_FAULT=drop_after_send` closed the daemon attachment after write. The message stayed visible, then became `Delivery unconfirmed` with explicit `Send again` / `Dismiss record`; it was never auto-resent and remained unconfirmed after restart/reconnect. Captures: `android-unconfirmed.png`, `android-unconfirmed-review.png` |
| A06 stale terminal fencing | PARTIAL | Adapter-normalized attachment/turn ids and client guards implemented; no deterministic stale-frame replay test |
| A07 guidance incorporated exactly once | PASS | During a 90 s bash turn, guidance showed `Queued for the next safe point`, then one instruction block and one assistant occurrence (`GUIDANCE-THREE`) after completion. Capture: `android-guidance.png` |
| A08 reading anchor during a burst | PASS | Second authenticated client sent `BURST-ONE` while the phone was parked at the seam: the viewport did not jump, the seam count moved 10 → 12, and a `New activity` control appeared; the reply did not pull the reader down. Captures: `android-reading-anchor.png` |
| A09 retry rollback replacement | PARTIAL | Adapter contract test injects `retry_rollback`: emits `text_replace` with empty text and `retrying (1/3)`, no cancel. A real provider retry was not forced natively |
| A10 server switch while typing | PASS | Draft `DRAFT-ALPHA` existed on the 7643 profile; after switching to a second adapter on 7644 the same session's composer was empty, and switching back restored `DRAFT-ALPHA`. Captures: `android-draft-scoped.png`, `android-draft-restored.png` |
| A11 keyboard at 200% text | PASS | Accessibility text size `accessibility-extra-extra-large`; composer, Send, labels reflow and remain reachable; composer placeholder shortened |
| A12 no fabricated plan/approval/push/file controls | PASS | With a reported plan, Work > Plan shows `0 of 3 reported steps complete` and three pending steps; hidden when zero todos; no approval UI; notifications reported unavailable |
| A13 VoiceOver/TalkBack | PARTIAL | Accessibility tree inspected (roles/labels/order); TalkBack enabled and bound on the API 36 emulator, with app controls exposed as named buttons, messages as `You said…`/`jcode said…`, and the composer labelled `Message`. Scripted focus traversal and a human listening pass remain NOT_RUN. 200% text verified in Night mode |
| A15 revoked pairing token | PASS | Removed the Android device from the staging registry, relaunched: selector and banner read `Pair again`, cached sessions stayed readable with `Saved` state; warm pairing deep link re-paired. Capture: `docs/evidence/native/android-revoked.png` |
| A16 archive/restore | PASS | Android release: long-press → Archive removed the row and showed `Session archived.` + Undo; Undo restored the row and live state. Archived-list toggle and restore action implemented |
| A17 decision link | N/A | No permissions capability in the verified server surface |
| A18 Stop targets only this turn | PASS | See A18 above |
| New session creation | PASS | Android release: absolute server folder + instruction; server-returned id used for attach; reply received; header title updated from the server after the turn (no previous-session bleed) |

## Visual evidence

| Capture | Path | Notes |
| --- | --- | --- |
| Sessions (Light) | `docs/evidence/native/sessions-light.png` | Real staging sessions; server selector; search; dock |
| Conversation (Light) | `docs/evidence/native/conversation-return.png` | Return seam, user bubble, composer |
| Conversation Working (Light) | `docs/evidence/native/conversation-working.png` | Running bash dock + separate Stop |
| Work Activity (iOS) | `docs/evidence/native/conversation-working.png` | Real tool rows, seam |
| Tool detail | `docs/evidence/native/tool-detail.png` | Parameters, honest result note |
| Night conversation | `docs/evidence/native/conversation-night.png` | Night palette, seam, composer |
| Server details (Night) | `docs/evidence/native/server-night.png` | Appearance, transport, capabilities |
| Large text | `docs/evidence/native/conversation-large-text.png` | 200% text, reflow |
| iOS Connect | `docs/evidence/native/ios-connect.png` | Production example address, no loopback default |
| Android sessions | `docs/evidence/native/android-sessions.png` | Release APK, real staging inventory |
| Android conversation | `docs/evidence/native/android-conversation.png` | Release APK, native header/composer |
| Android Work | `docs/evidence/native/android-work.png` | Release APK, deduped tool rows, seam |
| Android Plan | `docs/evidence/native/android-plan.png` | Real reported plan, honest completion count |
| Android new session | `docs/evidence/native/android-new-session.png` | Created from the app, reply rendered |
| Android revoked | `docs/evidence/native/android-revoked.png` | `Pair again`, cached sessions readable |
| Android 200% text | `docs/evidence/native/android-large-text.png` | Night mode, shortest placeholder, composer holds |
| Android unconfirmed delivery | `docs/evidence/native/android-unconfirmed.png` | No auto-resend; explicit review |
| Android unconfirmed review | `docs/evidence/native/android-unconfirmed-review.png` | `Send again` or `Dismiss record` |
| Android guidance | `docs/evidence/native/android-guidance.png` | One queued/injected instruction |
| Android reading anchor | `docs/evidence/native/android-reading-anchor.png` | Second-client burst; no viewport jump |
| Android draft scoped | `docs/evidence/native/android-draft-scoped.png` | Same session on second server, no draft |
| Android draft restored | `docs/evidence/native/android-draft-restored.png` | Draft restored on original profile |
| Android offline | `docs/evidence/native/android-offline.png` | Adapter stopped; cached history, Retry, editable draft |

The dev-client floating gear button appears in development captures. It is not part of the app and is absent in the release build.

## Performance

| Metric | Target | Measured | Notes |
| --- | --- | --- | --- |
| Input/press response | p95 ≤50 ms | NOT_RUN | Simulator only |
| Warm cached route | p95 ≤150 ms | NOT_RUN | |
| Cold cached first content | p95 ≤600 ms | NOT_RUN | Emulator cold start measured separately |
| Foreground text | ≤150 ms | NOT_RUN | Coalescing is 100 ms by design |
| Navigation frames | p95 ≤16.7 ms | NOT_RUN | |
| Android PSS | ≤120/180/220 MiB | 122,076 KB (~119 MiB) PSS | Release APK on API 36 emulator, swiftshader; not a physical-device claim |
| Android cold start | target not set | 1,114 ms TotalTime (COLD) | `am start -W`, release APK on emulator |
| Android frame timing | p95 ≤16.7 ms | p50 73 ms, p95 93 ms, 87.5% janky (72 frames) | Software-rendered emulator; excluded from acceptance |
| iOS footprint | ≤160/220 MiB | NOT_RUN | |
| Adapter overhead | ≤32/64 MiB | NOT_RUN | |
| Stress fixtures | bounded | NOT_RUN | 10k-message fixture not built |

No performance claim is made from the HTML exhibit or from Simulator memory. Android numbers are emulator baselines only; the software renderer makes frame timing non-representative.

## Limitations and blocked gates

- Live VPS: BLOCKED. `v7-remote` resets SSH on its configured port; no alternate authorized endpoint was assumed.
- Physical iOS device and Samsung A34: NOT_RUN (not attached).
- Manual VoiceOver/TalkBack passes: NOT_RUN.
- A09 has adapter-contract evidence only; A05/A07/A08/A10 have native evidence. Two-adapter A10 test shared one staging device registry, so the inactive profile showed `Pair again` after the test; draft scoping itself was unaffected.
- The release APK was installed from `artifacts/` and paired through the Connect screen against the loopback adapter (`adb reverse`), with a loopback-scoped Android network security config. Remote hosts still require TLS.
- The iOS Release Simulator build keeps `NSAllowsLocalNetworking` disabled, so it cannot pair over plain `ws://127.0.0.1`. iOS end-to-end pairing/sending was verified with the dev build; the release zip was verified to install and launch to Connect. A remote TLS endpoint is required for iOS release acceptance.
