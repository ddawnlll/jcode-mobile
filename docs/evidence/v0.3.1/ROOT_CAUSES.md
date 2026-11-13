# Root Causes

## R-1 — Preview history was served as authoritative (BUG-005, BUG-009)

`JcodeLive::history()` answered `sessions.subscribe`/`sessions.snapshot` from
`JcodeClient::peek_session()`. The harness bridge serves `peek_session` from
`BridgeState::stored_tail()`, which:

1. reads only the base `sessions/<id>.json` — which lags the journal
   `sessions/<id>.journal.jsonl` (tool rows and later turns are appended only
   to the journal);
2. filters messages to roles `user`/`assistant`;
3. drops `tool` rows and any non-text blocks (`flatten_content` collects only
   `text` blocks), so tool results vanish even when present in the base file.

`build_snapshot` then matched the pending operation's user body against this
broken history — never finding it — so `pending_operation_for_session` stayed
`accepted` forever. Both the P1 data loss and the P1 composer deadlock
follow from serving a lossy preview as a full transcript.

**Fix:** serve `get_history` after attach; apply the tail limit client-side.

## R-2 — Repeat `create_session` re-attached the current session (BUG-006)

The bridge implements `create_session` as a `subscribe` frame with no session
id (the daemon has no `create_session` request type on this pinned build;
creation is subscribe-without-target). When the shared SDK connection already
had a current session, the daemon answered with that session's `state`, and
the bridge's attach reply resolved to the existing session. The adapter
trusted the returned id for the new `client_request_id` and renamed the
session to the requested title.

**Fix:** create on a short-lived, first-frame-create connection; the shared
link then attaches to the genuinely new session.

## R-3 — Attach tracking violated the one-current-session contract (BUG-006, cross-session risk)

`attached: HashSet<String>` assumed the bridge could keep several sessions
attached on one native connection. It cannot. After attaching B, sends to A
on that connection were not checked against the bridge's actual current
session. Tracking a single `current_session: Option<String>` and attaching
before every command — serialised by `command_lock` — matches the bridge
contract and removes cross-session write risk.

## R-4 — Client live state not reconciled after `turn_done` (BUG-007)

`finishTurn` nulled `turnId` but kept `startedAtMs`, `finishedTurnId` unset,
and non-empty `assistants`; the render path shows `<Elapsed>` and `…` dots
unconditionally; `applySnapshot`'s `clearLive` required `includesLive`, which
on v0.3.0 was impossible (R-1). The result is an immortal timer on a finished
turn.

**Fix:** clear `startedAtMs`/mark blocks `done` at turn end; clear live on a
non-stale snapshot that follows a finished turn; render dots/timer only while
a turn is active.

## R-5 — Duplicate shell-level connection banner (BUG-008)

`App.tsx` rendered `<ConnectionBanner>` at `app-main` level in addition to the
per-screen banners; the shell copy had no safe-area handling and overlapped
the Android status bar.

**Fix:** remove the shell copy.

## R-6 — Release manifest blocks loopback cleartext with no carve-out (BUG-001)

`src-tauri/gen/android/app/build.gradle.kts` sets
`manifestPlaceholders["usesCleartextTraffic"] = "false"` for release and the
manifest referenced `android:usesCleartextTraffic="${usesCleartextTraffic}"`.
Android therefore blocks `http://127.0.0.1:…` pairing before any request is
sent. The pairing UI defaults to a loopback http address.

**Fix:** network-security config permitting cleartext for loopback targets
only; the placeholder is gone.
