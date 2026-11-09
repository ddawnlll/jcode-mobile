# v0.1.4 reliability verification

Updated: 2026-11-09

Base: `a53cf10861eeadffb981dfa6deca581ee2099a6a` (`origin/main` after the
Playwright/web target work). Branch: `reliability/v0.1.4`.

Environment: Debian 13 (trixie), x86_64, Node 26.13.0, npm 11.20.0, JCode
0.99.1 (`7206efd0c`), Playwright 1.65.0, Chromium headless with rootless
libraries under `~/playwright-deps`.

Isolation: Playwright and the controller tests use the isolated
`.staging/jcode` daemon, adapter 7645, and web 8091. The production daemon
socket and the live adapter on 7644 were not restarted or used by tests.

## Command outcomes

| Command | Result |
| --- | --- |
| `npm run check` | pass: `tsc --noEmit`, ESLint 0 errors, Jest 52/52 |
| `npm run adapter:test` | 11/11 pass |
| `npm run e2e` | 10/10 pass (1.3 min) |
| `bash scripts/check-platform.sh` | Debian/Ubuntu host detected; rootless browser libraries present |
| Android release APK | NOT_RUN: no `adb`, Java, SDK, or attached device on this VPS |
| iOS simulator/device | NOT_RUN: no macOS/Xcode on this VPS |

Playwright evidence: `.staging/e2e/report/index.html`.
UI captures: `.staging/e2e/screens/{sessions,conversation,work,plan,connect}.png`.
Failure artifacts are under `.staging/e2e/results/` when a test fails; the
final run has no failure traces.

## Issue-by-issue

| Issue | Change | Regression evidence |
| --- | --- | --- |
| #2 lost retry | Reconnect intent is recorded when a retry deadline joins an in-flight attempt; the attempt finally validates the client or schedules another eligible retry. A 45 s attempt deadline bounds handshake + save + inventory + attach. | `controller-reliability.test.ts`: "preserves retry intent…", "recovers when a retry deadline fires during inventory reconciliation", "bounds a stuck connection attempt…". Five-minute fake-time advancement included. |
| #3 half-open socket | Protocol readiness now requires `hello_ok`; a foreground ping every 15 s with a 5 s deadline retires silent sockets. Required inventory/server-info failures cannot leave Current. `/whoami` distinguishes adapter reachability from daemon readiness. `lastCheckedAt` is attempt time, `lastContactAt` is confirmed contact. | Transport and controller tests: "health probe retires a half-open socket…", "does not publish Current when required inventory reconciliation fails". |
| #4 stale lifecycle work | Added a lifecycle epoch and profile/client/generation ownership checks around activation, connect, inventory, attach, history, send, guidance, archive/restore/save, plan, rename, open, and profile switch. Invalidates before switch, disconnect, background, and forget. | "does not let a stale A failure change the replacement B authorization state", paired with the pairing/forget tests. |
| #5 inventory polling | Polling intent is owned by the focused Sessions screen. Background suspends the timer but keeps intent; foreground reinstates exactly one timer and reconciles immediately. | "restores inventory polling after background/resume while Sessions stays focused". |
| #6 forget navigation | Root navigation now resets from `profileId`: last profile → Connect, remaining profile → Sessions. Forget uses an in-app confirmation sheet and no longer navigates to Sessions itself. | Playwright `navigation.spec.ts`: "forgetting the last server resets to Connect and Back cannot reopen Sessions". |
| #7 rejected handshake | `MobileClient.isOpen` requires validated hello; failed/timed-out handshakes close and retire the socket, fence late callbacks, and reject pending requests. A later connect creates a fresh socket. Protocol error codes are preserved. | `client.test.ts`: rejected handshake, silent handshake deadline, readiness/health. |
| #8 title ownership/cache | Title events apply only to the exact server/session, update conversation metadata, inventory, and SQLite. Confirmed titles win over inventory/attach replies that started earlier. Clear-title events use the derived display title. | "applies a rename only to its exact session and persists it", "keeps a confirmed title over an inventory reply that started before it", plus Playwright `title.spec.ts` offline reopen. |
| #9 rename confirmation | Adapter `rename` waits for the daemon `session_renamed` event or error; ACK alone is not success, and `done` without an event is ambiguous. The mobile call waits for that reply and keeps the submitted value on failure. | Four adapter tests: confirmation, rejection, ambiguous done, concurrent rename. Controller test "reports a rename only after the adapter confirms it". |
| #10 pairing outlives timeout | The 12 s deadline covers fetch, headers, and body parsing. Each attempt has an abort owner; timeout, blur/unmount, retry, switch, background, and forget invalidate it. Ownership is rechecked before token/profile writes and activation, with partial-write cleanup. | "aborts a response body that outlives the deadline…", "ignores a late successful pairing body after forget". |
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
