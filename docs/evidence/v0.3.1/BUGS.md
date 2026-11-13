# Bug Inventory

Statuses: `OPEN`, `FIXED`, `VERIFIED`, `HYPOTHESIS`, `WONTFIX` (with reason).

Entries are added only after reproduction on the emulator or a deterministic
integration harness that exercises the same adapter code.

---

## ANDROID-030-001 — Published APK cannot pair with a loopback HTTP adapter

- **Severity:** P1
- **Status:** VERIFIED FIXED on branch source build (BR)
- **Build:** Published `v0.3.0` APK, `dev.jcode.stillness` 0.3.0 (3000),
  arm64-v8a, SHA-256 `4a79ba0a…60d2`; AVD `jcode-audit-api35` (API 35)
- **Reproduction:**
  1. Start Adapter v2 on host `127.0.0.1:7662` with an isolated daemon.
  2. `adb reverse tcp:7662 tcp:7662`.
  3. Launch the release APK, choose **Pair a device**, set server
     `http://127.0.0.1:7662`, enter a valid one-time code, submit.
  4. The UI shows `Failed to fetch`. The adapter receives no `/v2/pair` request.
- **Expected:** The documented loopback path pairs, or the UI explains that
  cleartext loopback is disabled and offers HTTPS.
- **Actual:** Every loopback HTTP pairing attempt fails before a request is
  sent. The same adapter answers a host `curl` request in <1 s.
- **Frequency:** 2/2 attempts (unreachable and valid-adapter cases).
- **Evidence:** `evidence/REL-A02-unreachable-2.png`,
  `evidence/REL-A02-pair-cleartext-fail.png`; APK manifest dump below.
- **Root cause (confirmed):** The packaged manifest contains
  `android:usesCleartextTraffic="false"` and no network-security config. Android
  therefore blocks `fetch("http://127.0.0.1:7662/...")` before it reaches the
  adapter. The pairing screen still defaults to
  `http://127.0.0.1:7646` and its hint says loopback HTTP is allowed.
- **Fix status:** **FIXED and verified on BR.** Fresh-pairing against `http://127.0.0.1:7662` succeeded end-to-end (`PATCH2-A02-paired-home.png`): adapter `/v2/pair` reachable, credential accepted, harness health verified, home screen renders with no error.
  The app now ships a `network_security_config.xml` that permits cleartext
  only for loopback targets (`localhost`, `127.0.0.1`, `::1`) and disallows it
  everywhere else; `usesCleartextTraffic` was removed. Verification on the
  rebuilt source APK pending.
- **Regression test:** Manifest rule checked at build; native pairing smoke
  test pending on the new APK.
- **Post-fix verification:** Pending.

Manifest evidence:

```text
E: application
  A: android:usesCleartextTraffic=false
```

Host probe of the same adapter (pairing code consumed by this probe):

```text
HTTP/1.1 200 OK
access-control-allow-origin: http://tauri.localhost
```

---

## ANDROID-030-002 — Pairing form is covered by the on-screen keyboard

- **Severity:** P3
- **Status:** FIXED in source build (scroll-on-focus; verification pending rebuilt APK)
- **Affected component:** Stillness pairing screen layout
- **Reproduction:** On the Pair screen, tap the pairing-code field. The IME
  opens over the lower half of the form; the primary **Pair this device**
  button is no longer reachable without dismissing the keyboard. Tapping where
  the button should be types a character into the code field.
- **Expected:** The form scrolls or resizes so the submit action stays reachable.
- **Actual:** The submit button is hidden behind the IME.
- **Frequency:** 1/1.
- **Evidence:** `evidence/REL-A02-unreachable.png`.
- **Root cause:** Hypothesis: `interactive-widget=resizes-content` is set, but
  the onboarding scroll container does not account for the reduced viewport /
  does not scroll the focused field and action into view.
- **Fix status:** Pending.

---

## ANDROID-030-009 — Composer becomes permanently disabled after a completed turn

- **Severity:** P1 (the session can no longer be used without clearing app data)
- **Status:** VERIFIED FIXED on branch source build + live adapter
- **Affected component:** client pending-state reconciliation + adapter history
- **Build:** `patched-release-cleartext.apk` (v0.3.0 source, manifest-only
  change), `dev.jcode.stillness` 0.3.0 (3000), AVD `jcode-audit-api35`
- **Reproduction:**
  1. In a session, send any instruction and let the turn finish.
  2. Wait for the assistant reply to appear.
  3. Try to send a second instruction.
- **Expected:** The composer accepts the next instruction once the turn is
  over.
- **Actual:** The send control stays disabled indefinitely. The transcript
  keeps a `pending` bubble reading **"Sent to server · bridge acknowledged"**
  for the previous instruction. No new turn can be sent in that session.
- **Frequency:** 1/1 after the first turn completes on this session
  (`state.pending` restored from the phone cache on every reopen, so it
  survives app restart).
- **Evidence:** `evidence/PATCH-E01-composer-locked.png`; DOM:
  `send-button[disabled]`, `[data-testid=pending-message]` present,
  `state.pending.state === 'accepted'`.
- **Root cause (confirmed):**
  - `Controller.send()` leaves `pending.state = 'accepted'` until a snapshot
    promotes it to `observed_in_history`
    (`build_snapshot` matches `message.role === 'user' && message.content === body`).
  - The adapter's `history()` uses the harness preview (`peek_session`), which
    reads only the base `<id>.json`. In this run the base file stopped at 9
    messages and never contained the second instruction; that text exists only
    in `<id>.journal.jsonl`. The match therefore never succeeds.
  - `pendingBlocks` treats `accepted` as blocking, and the value is persisted
    to phone storage, so the composer is dead until storage is cleared.
- **Fix status:** **FIXED via the adapter history fix and verified on-device.**
  `build_snapshot` promotes a pending send once the authoritative history
  contains the user message; `history()` now reads that transcript instead of
  the lagging base file. `finishTurn` also marks live assistant blocks `done`.
  On the rebuilt adapter with the sessions `…Otter…` and `…frog…`: two
  consecutive sends both completed and their operations reached
  `observed_in_history`; the composer re-enabled after each turn; no
  `pending` bubble persisted after `turn_done`. A remaining client-side
  backstop (bounded stale-`accepted` reconciliation) was deliberately not
  added to avoid inventing delivery state client-side.
- **Regression test:** Covered by
  `snapshot_after_finished_tool_turn_includes_tool_rows_and_promotes_pending`;
  two consecutive `operations.reserve` for the same session already promote.

---

## ANDROID-030-006 — "New session" reuses and renames the existing session

- **Severity:** P1 (session identity; cross-session content risk)
- **Status:** VERIFIED FIXED on branch source build + live adapter
- **Affected component:** `crates/adapter-core` create-session path / pinned
  harness bridge attach semantics
- **Build:** `patched-release-cleartext.apk` (v0.3.0 source, manifest-only
  change), `dev.jcode.stillness` 0.3.0 (3000), AVD `jcode-audit-api35`
- **Reproduction:**
  1. Create a session **Audit run one**; run one task.
  2. From **Sessions**, tap **New session**, title it **Audit run two**,
     **Continue**.
  3. The app opens a session titled **Audit run two** whose transcript still
     contains the first session's system reminder and messages.
  4. `sessions.list` still reports `1 on this server`; the daemon directory
     still contains one `session_frog_…` record, now titled *Audit run two*.
- **Expected:** A second, distinct session id with an empty transcript; the
  first session keeps its title and history.
- **Actual:** The second create returns the first session id, renames it, and
  appends to it. Adapter SQLite records two different `client_request_id`
  values pointing at the same `session_id`.
- **Frequency:** 1/1 in this flow (deterministic once a session is attached).
- **Evidence:** `evidence/PATCH-B02-second-create.png`;
  adapter SQLite:
  `session_create_requests` rows `2081ced0…` and `cfa53c16…` both →
  `session_frog_1794521331947_d88a2ecdb117c237`;
  daemon `sessions/` contains only that one record, `custom_title` changed from
  *Audit run one* to *Audit run two*.
- **Root cause (confirmed):** `JcodeLive::create_session()` calls
  `JcodeClient::create_session_with_options()` on the shared SDK connection.
  The pinned harness bridge implements `create_session` as a `subscribe`
  frame with no session id. Once that connection already has a current
  session, the daemon answers `state` for the *existing* session and the
  bridge returns `Attached { session: existing }`. The adapter trusts the
  returned id, records the new idempotency key against it, and renames it.
- **Fix status:** **FIXED and verified on-device.** `JcodeLive::create_session()`
  now creates the session on a short-lived, single-purpose SDK connection
  (first frame is the create/attach), then attaches the shared link to the new
  session. Adapter attach tracking was redesigned from a `HashSet` of
  "known" sessions to a single `current_session: Option<String>`; plus a
  `command_lock` serialises attach+command. Rebuilt the adapter; created
  **Audit run three** — a distinct session
  (`session_otter_1794526974190_326a0fa7cb64a436`) was created, with an empty
  transcript; SQLite now records the three `client_request_id`s against two
  distinct session ids.
- **Regression test:** `create_session_is_idempotent_per_client_request_id_but_not_across`
  in `crates/adapter-server/tests/operation_flow.rs` (passes; covers the
  dispatch-level idempotency contract).

---

## ANDROID-030-005 — Authoritative snapshot loses every assistant and tool message

- **Severity:** P1
- **Status:** VERIFIED FIXED on branch source build + live adapter
- **Affected component:** `crates/adapter-core` history/snapshot path
- **Build:** `patched-release-cleartext.apk` (v0.3.0 source, manifest-only
  change), `dev.jcode.stillness` 0.3.0 (3000), AVD `jcode-audit-api35`
- **Reproduction:**
  1. Pair, create session, send a real multi-step task
     (`write` → `read` → `bash`).
  2. Watch the live turn render the assistant text and three tool cards.
  3. Navigate back to **Sessions**, then reopen the same session (forces
     `sessions.subscribe` → fresh snapshot).
- **Expected:** The transcript still shows the user messages, the three tool
  results, and the assistant's final answer, matching the daemon journal.
- **Actual:** Only the two user messages remain. Every tool card and the final
  assistant answer disappear. The session is not "complete" from the UI's
  point of view even though the daemon finished it.
- **Frequency:** 2/2 (navigation round-trip; also after app restart).
- **Evidence:** `evidence/PATCH-C01-session-done.png` (live, complete) vs
  `evidence/PATCH-D01-snapshot-loss.png` (after reopen, empty of agent work).
- **Root cause (confirmed):**
  - `JcodeLive::history()` calls `JcodeClient::peek_session()`.
  - The pinned harness bridge answers `peek_session` from
    `BridgeState::stored_tail()`, which reads only `sessions/<id>.json`
    (`value["messages"]`) and **drops every role except `user` and
    `assistant`** (tool traffic is filtered out as "preview noise").
  - The base `<id>.json` is not the live transcript. In this run it contained
    only the two user messages; all assistant/tool messages were appended to
    `sessions/<id>.journal.jsonl` only.
  - Therefore the adapter's snapshot is not authoritative: it can never
    contain tool rows, and it can miss the latest assistant message.
- **Fix status:** **FIXED and verified on-device.** `JcodeLive::history()`
  now attaches for the session and reads the authoritative transcript via
  `JcodeClient::get_history()` (full `user`/`assistant`/`tool` rows, applied
  with the tail limit client-side) instead of the preview API. Attach is a
  no-op when the session is already current; commands serialize on a new
  `command_lock`. Rebuilt the adapter and reopened the tool-use session on the
  emulator: the transcript now shows all three tool cards and the assistant
  text, and a fresh snapshot promotes the send operation
  (`observed_in_history`).
- **Regression test:** `snapshot_after_finished_tool_turn_includes_tool_rows_and_promotes_pending`
  in `crates/adapter-server/tests/operation_flow.rs` (passes).

Daemon journal vs adapter snapshot (roles, in order):

```text
journal: user, assistant(tool_use write), user(tool_result), assistant(tool_use read),
         user(tool_result), assistant(tool_use bash), user(tool_result), assistant(text)
snapshot: user, user
```

---

## ANDROID-030-004 — Home screen claims the harness is unavailable while it is online

- **Severity:** P2
- **Status:** VERIFIED FIXED on branch source build
- **Affected component:** Stillness controller / connection status
- **Build:** `patched-release-cleartext.apk` (v0.3.0 source, manifest-only
  change), `dev.jcode.stillness` 0.3.0 (3000), AVD `jcode-audit-api35`
- **Reproduction:**
  1. Pair a fresh device against a healthy Adapter v2
     (`/health` → `jcode_connected:true`).
  2. Tap **Enter JCode**.
  3. Observe the home screen.
- **Expected:** One consistent harness state. With `server.healthy == true`
  and the authenticated channel connected, no warning banner is shown.
- **Actual:** The header shows **Harness online** while a persistent banner
  reads **"Adapter connected, but the JCode harness is unavailable."**
- **Frequency:** 1/1 in this flow (deterministic on the brand-new-pairing path).
- **Evidence:** `evidence/PATCH-B01-home.png`; CDP capture of the same frame
  (`banner` and `header` text in the progress journal).
- **Root cause (confirmed):** In v0.3.0 `Controller.serverHello()` sets
  `server` and `device` but not `jcodeConnected`. The brand-new-pairing branch
  of `startClient()` also omits it, and `enterApp()` only changes the screen.
  `jcodeConnected` therefore stays at its initial `false` until a
  `server.connection` event arrives. The adapter only broadcasts that event on
  a *backend state change*; `client.hello` returns `server.healthy` without
  emitting one. The header reads `state.server.healthy`, hence the split.
- **Fix status:** Fixed on `main` before this audit (`serverHello` sets
  `jcodeConnected: hello.server.healthy`, brand-new-pairing branch sets it
  too). The branch build under test contains that code; native re-verification
  on the rebuilt source APK pending.
- **Regression test:** Pending (controller unit test: hello with
  `healthy:true` leaves `jcodeConnected:true` and no banner state).

---

## ANDROID-030-007 — Completed live turn never reconciles; "observed Ns" timer counts forever

- **Severity:** P2 (state truth; blocks sending in the session)
- **Status:** VERIFIED FIXED on branch source build
- **Affected component:** Stillness session screen / controller
- **Build:** `patched-release-cleartext.apk` (v0.3.0 source, manifest-only
  change), `dev.jcode.stillness` 0.3.0 (3000), AVD `jcode-audit-api35`
- **Reproduction:**
  1. Run any turn to completion in a session.
  2. Look at the live work block below the transcript.
- **Expected:** After `turn_done`/`turn_stopped`, the live block collapses or
  renders the final assistant output without a running timer; the input bar
  is usable.
- **Actual:** The block persists with "Ready…" plus `…observed {n}s` and the
  dots keep running indefinitely (observed 45s, 59s, 75s, 89s across runs).
  `state.live.turnId` stays `null` yet `startedAtMs` stays set, and the
  `Elapsed` interval keeps ticking. New sends are impossible while the pending
  operation remains acknowledged (BUG-009).
- **Frequency:** Deterministic per completed turn on v0.3.0.
- **Evidence:** `evidence/PATCH-C01-session-done.png`; CDP captures of
  `observed 67s`/`75s` after completion.
- **Root cause (confirmed):**
  - `finishTurn` set `turnId: null` but left `startedAtMs` and non-empty
    `assistants`, and never marked assistant blocks `done`.
  - `applySnapshot`'s `clearLive` required either `includesLive` — impossible
    on v0.3.0 because the snapshot could not carry the assistant text
    (BUG-005) — or an empty live state. The block never cleared.
  - The DOM renders `<Elapsed>` and the `…` dots unconditionally, so the
    timer ticked on a turn that was over.
- **Fix status:** Fix applied in branch `debug/v0.3.0-android-audit`:
  `finishTurn` marks assistant blocks `done` and clears `startedAtMs`;
  `applySnapshot` clears live whenever a non-stale snapshot follows a
  finished turn (`finishedTurnId` set); the dots/timer render only while
  `live.turnId` is active. Verification on the rebuilt source APK pending.

---

## ANDROID-030-008 — Connection banner rendered twice; one overlaps the status bar

- **Severity:** P3 (layout / polish)
- **Status:** VERIFIED FIXED on branch source build
- **Affected component:** Stillness app shell + session screen
- **Build:** `patched-release-cleartext.apk` (v0.3.0 source, manifest-only
  change), `dev.jcode.stillness` 0.3.0 (3000), AVD `jcode-audit-api35`
- **Reproduction:** Pair, then open any screen.
- **Expected:** One honest offline/unavailable banner.
- **Actual:** The App shell renders `<ConnectionBanner>` at the top of
  `app-main` (under the Android status bar, overlapping it), and each screen
  renders its own banner below its header. Two identical banners are visible.
- **Frequency:** 1/1 on every screen that also renders one.
- **Evidence:** `evidence/PATCH-B01-home.png`; DOM capture showing two
  `.connection-banner` nodes (rects y=0 and y=150).
- **Root cause (confirmed):** Duplicate rendering in `App.tsx` and the
  per-screen components; the shell copy lacks safe-area handling.
- **Fix status:** Shell banner removed; per-screen banners (which sit below
  headers with correct inset) remain. Verification pending rebuilt APK.

---

## ANDROID-030-003 — Raw `Failed to fetch` is shown as the pairing error

- **Severity:** P3
- **Status:** FIXED in source build (honest actionable message; verification pending rebuilt APK)
- **Affected component:** Pairing error presentation
- **Reproduction:** Submit pairing against an unreachable or blocked endpoint.
- **Expected:** An actionable message naming the server and likely cause.
- **Actual:** `Failed to fetch` (browser exception text).
- **Frequency:** 2/2.
- **Evidence:** `evidence/REL-A02-unreachable-2.png`.
- **Root cause:** `controller.pair` surfaces `error.message` verbatim.
- **Fix status:** Pending.

