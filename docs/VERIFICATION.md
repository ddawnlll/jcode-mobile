# Verification record

Updated: 2026-11-08. Evidence is only recorded from commands that actually ran and outputs that exist.

Environment: macOS 26.1 (M3 Pro, 18 GiB), Xcode 26.1.1, iPhone 17 Pro simulator (iOS 26.1), Android emulator `jcode-mobile` (API 36, arm64), Node 22.21.1, JCode 0.99.1 (`7206efd0c`). The live VPS was unreachable.

## Build and static checks

| Check | Status | Command | Observed |
| --- | --- | --- | --- |
| TypeScript strict | PASS | `npx tsc --noEmit` | exit 0, no diagnostics |
| ESLint | PASS | `npx eslint .` | exit 0, 2 style warnings (unused pattern; no errors) |
| Unit + RNTL tests | PASS | `npm test` | 5 suites, 33 tests passed |
| Adapter contract tests | PASS | `node --test integration/jcode-adapter/test/attach-contract.test.ts` | 2/2 pass; records `continue_on_disconnect: true`, exact target, no cancel/clear/prepare_disconnect on dispose |
| iOS dev build | PASS | `npx expo run:ios --device "iPhone 17 Pro"` | BUILD SUCCEEDED, launched |
| iOS Simulator release `.app` | PASS | `bash scripts/build-ios-simulator.sh` | BUILD SUCCEEDED; `main.jsbundle` present; zip 24 MiB |
| Android release APK | PASS | `bash scripts/build-android-release.sh` | BUILD SUCCESSFUL; installed, paired, archived/undone, revoked/re-paired on the API 36 emulator; SHA-256 in BUILD_STATE |
| CI workflow | NOT_RUN | `.github/workflows/check.yml` | Added; run result not yet inspected |

## Real JCode integration

| Check | Status | Evidence |
| --- | --- | --- |
| Authenticated pairing via JCode registry | PASS | `jcode pair` code consumed by adapter `POST /pair`; token only in Keychain/Keystore; contract/continuity tests pair successfully |
| Revoked/unknown token rejected | PASS | Adapter returns 401 for unknown tokens; `/whoami` distinguishes revocation from a network error (unit path inspected; see limitations for native revoked-device flow) |
| Inventory, create, attach, history, send, streaming | PASS | Real staging sessions listed in the app; created session, sent turn, received streamed reply `APP-DONE`; Work shows the recorded `bash` tool call |
| A01 force-quit continuation | PASS | `docs/evidence/continuity-2026-11-08T12-30-29-022Z.json`: transport terminated mid-tool; six progress lines and `FINAL-…` written while the phone was absent; same session reattached with exactly one matching user message and assistant `COMPLETE`; continuation flag true |
| A04 daemon death | PASS | `daemon-death.ts` output: `interruptedAtAttach: true`, recovery directive present, statuses `idle`, `claimedWorking: false` |
| A02 leave Conversation during a turn | PASS | Native: back to Sessions while `sleep 30` ran; list showed the session in Working; reopening after completion showed the reply, no duplicate history |
| A14 Back navigation does not cancel | PASS | Same run: the turn continued after leaving Conversation; no cancel request observed |
| A18 explicit Stop | PASS | Native: Stop target sent a cancel (adapter log `explicit stop requested`), dock shows red square + `Stopped`, no Stop target remains; adapter suppresses the terminal `done` from flipping to Ready |
| A03 network loss/cache reconciliation | PASS | Android: adapter stopped, `Offline. Last checked at 17:32. Saved history only.` with editable draft; adapter restarted, Retry reconciled authoritative history and showed a 10-update seam. Full airplane-mode stack not tested |
| A05 ambiguous delivery | NOT_RUN | State machine and ledger implemented; no native post-write disconnect test |
| A06 stale terminal fencing | PARTIAL | Adapter-normalized attachment/turn ids and client guards implemented; no deterministic stale-frame replay test |
| A07 guidance incorporated exactly once | NOT_RUN | Queued/injected identity path implemented; not exercised natively |
| A08 reading anchor during a burst | NOT_RUN | Implemented; not measured |
| A09 retry rollback replacement | NOT_RUN | Implemented; provider retry not forced |
| A10 server switch while typing | NOT_RUN | Scoped drafts implemented; native test not run |
| A11 keyboard at 200% text | PASS | Accessibility text size `accessibility-extra-extra-large`; composer, Send, labels reflow and remain reachable; composer placeholder shortened |
| A12 no fabricated plan/approval/push/file controls | PASS | Plan tab hidden with zero todos; server details says notifications unavailable; no approval UI; file read only appears with the negotiated capability |
| A13 VoiceOver/TalkBack | PARTIAL | Accessibility tree inspected via agent-device (roles/labels/order); manual screen-reader pass NOT_RUN |
| A15 revoked pairing token | PASS | Removed the Android device from the staging registry, relaunched: selector and banner read `Pair again`, cached sessions stayed readable with `Saved` state; warm pairing deep link re-paired. Capture: `docs/evidence/native/android-revoked.png` |
| A16 archive/restore | PASS | Android release: long-press → Archive removed the row and showed `Session archived.` + Undo; Undo restored the row and live state. Archived-list toggle and restore action implemented |
| A17 decision link | N/A | No permissions capability in the verified server surface |
| A18 Stop targets only this turn | PASS | See A18 above |

## Visual evidence

| Capture | Path | Notes |
| --- | --- | --- |
| Sessions (Light) | `docs/evidence/native/sessions-light.png` | Real staging sessions; server selector; search; dock |
| Conversation (Light) | `docs/evidence/native/conversation-return.png` | Return seam, user bubble, composer |
| Conversation Working (Light) | `docs/evidence/native/conversation-working.png` | Running bash dock + separate Stop |
| Work Activity | `docs/evidence/native/work-activity.png` | Real tool rows, seam |
| Tool detail | `docs/evidence/native/tool-detail.png` | Parameters, honest result note |
| Night conversation | `docs/evidence/native/conversation-night.png` | Night palette, seam, composer |
| Server details (Night) | `docs/evidence/native/server-night.png` | Appearance, transport, capabilities |
| Large text | `docs/evidence/native/conversation-large-text.png` | 200% text, reflow |
| Android sessions | `docs/evidence/native/android-sessions.png` | Release APK, real staging inventory |
| Android conversation | `docs/evidence/native/android-conversation.png` | Release APK, native header/composer |
| Android Work | `docs/evidence/native/android-work.png` | Release APK, recorded tools |
| Android offline | `docs/evidence/native/android-offline.png` | Adapter stopped; cached history, Retry, editable draft |

The dev-client floating gear button appears in development captures. It is not part of the app and is absent in the release build.

## Performance

| Metric | Target | Measured | Notes |
| --- | --- | --- | --- |
| Input/press response | p95 ≤50 ms | NOT_RUN | Simulator only |
| Warm cached route | p95 ≤150 ms | NOT_RUN | |
| Cold cached first content | p95 ≤600 ms | NOT_RUN | |
| Foreground text | ≤150 ms | NOT_RUN | Coalescing is 100 ms by design |
| Navigation frames | p95 ≤16.7 ms | NOT_RUN | |
| Android PSS | ≤120/180/220 MiB | NOT_RUN | |
| iOS footprint | ≤160/220 MiB | NOT_RUN | |
| Adapter overhead | ≤32/64 MiB | NOT_RUN | |
| Stress fixtures | bounded | NOT_RUN | 10k-message fixture not built |

No performance claim is made from the HTML exhibit or from Simulator memory.

## Limitations and blocked gates

- Live VPS: BLOCKED. `v7-remote` resets SSH on its configured port; no alternate authorized endpoint was assumed.
- Physical iOS device and Samsung A34: NOT_RUN (not attached).
- Manual VoiceOver/TalkBack passes: NOT_RUN.
- A05/A07/A08/A09/A10 adversarial native scenarios: NOT_RUN as listed.
- The release APK was installed from `artifacts/` and paired through the Connect screen against the loopback adapter (`adb reverse`), with a loopback-scoped Android network security config. Remote hosts still require TLS.
