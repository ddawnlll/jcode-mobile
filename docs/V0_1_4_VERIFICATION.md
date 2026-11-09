# v0.1.4 reliability verification

Updated: 2026-11-09

Base: `a53cf10861eeadffb981dfa6deca581ee2099a6a` (`origin/main` after the
Playwright/web target work). Branch: `reliability/v0.1.4`.

Environment: Debian 13 (trixie), x86_64, Node 22.21.1 (the repo-supported
line), npm 11.20.0, JCode 0.99.1 (`7206efd0c`), Playwright 1.65.0, Chromium
headless with rootless libraries under `~/playwright-deps`.

Isolation: Playwright and the controller tests use the isolated
`.staging/jcode` daemon, adapter 7645, and web 8091. The production daemon
socket and the live adapter on 7644 were not restarted or used by tests.

## Command outcomes

| Command | Result |
| --- | --- |
| `npm run check` | pass: `tsc --noEmit`, ESLint 0 errors, Jest 59/59 |
| `npm run adapter:test` | 12/12 pass |
| `npm run e2e` | 10/10 pass (1.3 min) |
| `bash scripts/check-platform.sh` | Debian/Ubuntu host detected; rootless browser libraries present |
| Android release APK | NOT_RUN: no `adb`, Java, SDK, or attached device on this VPS |
| iOS simulator/device | NOT_RUN: no macOS/Xcode on this VPS |

Playwright evidence: `.staging/e2e/report/index.html`.
UI captures: `docs/evidence/v0.1.4/{sessions,conversation,work,plan,connect}.png`.
Failure artifacts are under `.staging/e2e/results/` when a test fails; the
final run has no failure traces.

## Issue-by-issue

| Issue | Change | Regression evidence |
| --- | --- | --- |
| #2 lost retry | Reconnect intent is recorded when a retry deadline joins an in-flight attempt; the attempt finally validates the client or schedules another eligible retry. A 45 s attempt deadline bounds handshake + save + inventory + attach. | `controller-reliability.test.ts`: "preserves retry intent…", "recovers when a retry deadline fires during inventory reconciliation", "bounds a stuck connection attempt…". Five-minute fake-time advancement included. |
| #3 half-open socket | Protocol readiness now requires `hello_ok`; a foreground ping every 15 s with a 5 s deadline retires silent sockets. Required inventory/server-info failures cannot leave Current. `/whoami` distinguishes adapter reachability from daemon readiness. `lastCheckedAt` is attempt time, `lastContactAt` is confirmed contact. | Transport and controller tests: "health probe retires a half-open socket…", "does not publish Current when required inventory reconciliation fails". |
| #4 stale lifecycle work | Added a lifecycle epoch and profile/client/generation ownership checks around activation, connect, inventory, attach, history, send, guidance, archive/restore/save, plan, rename, open, and profile switch. Invalidates before switch, disconnect, background, and forget. | "does not let a stale A failure change the replacement B authorization state", paired with the pairing/forget tests. |
| #5 inventory polling | Polling intent is owned by the focused Sessions screen. Background suspends the timer but keeps intent; foreground reinstates exactly one timer and reconciles immediately. | "restores inventory polling after background/resume while Sessions stays focused". |
| #6 forget navigation | Root navigation now resets from `profileId`: last profile → Connect, remaining profile → Sessions. Forget retires profile/token ownership before async deletion, blocks network-driven reconnect, and uses an in-app confirmation sheet. | "retires a forgotten profile before cleanup and ignores network restoration" plus Playwright `navigation.spec.ts`. |
| #7 rejected handshake | `MobileClient.isOpen` requires validated hello; failed/timed-out handshakes close and retire the socket, fence late callbacks, and reject pending requests. A later connect creates a fresh socket. Protocol error codes are preserved. | `client.test.ts`: rejected handshake, silent handshake deadline, readiness/health. |
| #8 title ownership/cache | Title events apply only to the exact server/session, update conversation metadata, inventory, and SQLite. A title revision fences inventory/attach replies, and a confirmed title is reapplied after an older `upsertSessions` write lands. Clear-title events use the derived display title. | "applies a rename only to its exact session and persists it", "keeps a confirmed title over an inventory reply that started before it", "reapplies a confirmed title after an older inventory write lands", plus Playwright `title.spec.ts`. |
| #9 rename confirmation | Adapter `rename` waits for the daemon `session_renamed` event or error; ACK alone is not success, and `done` without an event is ambiguous. Timed-out requests keep an orphan identity, block overlap, and correlate late events by expected custom title plus terminal id. | Five adapter tests: confirmation, rejection, ambiguous done, concurrent rename, and timeout/late-event ordering. Controller test "reports a rename only after the adapter confirms it". |
| #10 pairing outlives timeout | The 12 s deadline covers fetch, headers, and body parsing. Each attempt has an abort owner; timeout, blur/unmount, retry, switch, background, and forget invalidate it. Per-profile write leases prevent a cancelled attempt from deleting or overwriting a newer overlapping pair, and restore a newer token if a paused stale save lands late. | "aborts a response body that outlives the deadline…", "ignores a late successful pairing body after forget", "does not let a cancelled pair delete a newer overlapping pair". |
| #11 Retry now | Sessions Offline Retry calls `controller.reconnect()`; Pair again remains a Server details action. Server details also exposes Reconnect now. | RNTL `retry.test.tsx`: Retry calls reconnect, Pair again navigates. Playwright `recovery.spec.ts`: Offline clears after adapter recovery. |

## Additional safety checks

- Reconnect preserves the exact selected session and never replays an
  uncertain send: controller test "reconnect keeps the exact session and never
  replays an uncertain send".
- `continue_on_disconnect: true` remains in the adapter attach contract.
- Only the explicit Stop path sends `cancel`; reconnect/background never do.
- Delivery records in `sending`/`sent_to_server` become `unconfirmed` on
  transport loss and are not auto-resent.

## Remaining blockers

Native release validation is NOT_RUN on this host: no Android SDK/JDK/device
and no macOS/Xcode. The Expo web target and the adapter contract are the
executed surfaces for this patch. Physical-device recovery, forget, and rename
checks remain for a macOS/Android environment.

## Review round 2

The second review reproduced six races at `5659c018`. Regression tests were
written first, then the fixes:

| Defect | Fix | Test |
| --- | --- | --- |
| Profile/token publication split and token read race | Load the token into a local, publish profile and token together, block connect while loading, and fence late reads by epoch | "does not publish a losing activation token over the winner" |
| Network restoration during credential load | `connectNow`/`reconnect` return while the new credential is pending; no stale bearer is sent | "blocks reconnect while the winning credential is still loading" |
| Cancelled pair deleting a newer pair | Per-profile write leases, token comparison, stale-save restoration, and safe server-row cleanup | "does not let a cancelled pair delete a newer overlapping pair" |
| Forget while reconnect/cleanup runs | Retire profile and token before async deletion; block network reconnect and stale server recreation | "retires a forgotten profile before cleanup and ignores network restoration" |
| Same-profile delayed `401` | `/whoami` results are fenced by connection generation, not only profile | "fences a delayed 401 from an old attempt after the same profile reconnects" |
| Older inventory write reverting a title | Title revisions plus post-`upsertSessions` ownership/title recheck and reapply | "reapplies a confirmed title after an older inventory write lands" |
| Timed-out rename completing a later rename | Orphaned rename identity, expected-title correlation, blocked overlap, and terminal-id cleanup | adapter "a timed-out rename cannot complete or hide a later rename" |

Jest now uses `maxWorkers: 2` so the supported Node 22 line does not starve the
RNTL suite on this six-core host. The final commands below ran under Node
22.21.1.
