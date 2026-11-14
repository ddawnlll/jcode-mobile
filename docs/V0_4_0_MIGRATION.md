# JCode Mobile 0.2.x / 0.3.x → 0.4.0 migration and rollback

Scope: adapter v2 → v3, Stillness 0.3.1 → 0.4.0, and the Android artifact.
The daemon stays where it is. Nothing here requires deleting sessions or
re-pairing a phone.

## 1. Before upgrading

1. Stop the adapter only (not the JCode daemon).
2. Back up the adapter data directory. Default on Linux:
   `~/.local/share/jcode-mobile-adapter-v2/` (the directory name is retained).
   ```sh
   cp -a ~/.local/share/jcode-mobile-adapter-v2 \
         ~/.local/share/jcode-mobile-adapter-v2.pre-0.4.0
   ```
3. Record the current `/health` output and the paired device count
   (`device.list` through a paired client if available).

## 2. Adapter upgrade

The 0.4.0 release contains two binary names that run identical code:

- `jcode-adapter-v3` (preferred)
- `jcode-adapter-v2` (rollback alias; same binary behavior)

Existing service units that exec `jcode-adapter-v2` keep working without edits.
The database is extended in place:

- `event_journal`, `event_cursors`, `session_index`
- `operation_attachments`
- `device_push`, `push_log`
- `session_favorites`

All statements are `CREATE TABLE IF NOT EXISTS`. There is no destructive
migration. Device tokens and in-flight operation rows are untouched.

Verify:

```sh
curl -s http://127.0.0.1:7646/health
```

Expected additions:

```json
{
  "protocol_version": 3,
  "min_protocol_version": 2,
  "epoch": "epoch_...",
  "journal_events": 0,
  "connections": 0
}
```

A v2 phone still pairs and connects. Its handshake negotiates v2 and every
outbound frame stays at v2.

## 3. Phone upgrade

Install `jcode-mobile-0.4.0-android-release.apk` over 0.3.1. The package id and
signing key are unchanged for the debug-signed sideload artifact, so the app
updates in place and keeps its credentials. versionCode is 4000.

First launch after upgrade:

1. The cached session list and the last session paint immediately.
2. The banner says saved on this phone until the handshake and delta sync finish.
3. The adapter negotiates v3. `Adapter 0.4.0` is shown on the ready screen.
4. The client sends `events.subscribe` from its stored cursor. A successful
   replay continues the transcript; a gap or epoch mismatch loads a snapshot.

## 4. Rollback

Adapter:

1. Stop the 0.4.0 adapter.
2. Run the 0.3.1 adapter against the same data directory. The older binary
   ignores the v3 tables.
3. Phones negotiate v2 and use full listings plus snapshot recovery.
4. If the database itself is damaged, restore the pre-upgrade copy. Restoring
   loses devices created after the backup; do not delete the data directory
   otherwise.

Phone:

1. Uninstall 0.4.0 and install 0.3.1, or install 0.3.1 over 0.4.0 if its
   versionCode is higher. Android does not allow a lower versionCode install
   without uninstalling; uninstalling removes the phone-side credential, so the
   user must pair again with a fresh adapter pairing code.
2. A 0.4.0 phone with a 0.3.1 adapter is supported: it negotiates v2 and avoids
   v3-only requests. This is the safest mixed-version state.

## 5. What was exercised

On the isolated staging daemon (not the production daemon), 2026-11-14:

- Adapter restart on the same data directory: journal sequence continued,
  reconnect replay from an acknowledged cursor returned 0 duplicates, no
  resync, and the operation remained `accepted` (no second execution).
- v2 handshake against the v3 adapter: negotiated v2.
- Full then incremental delta: PASS.
- Browser e2e with the real daemon: 4 passed, 3 skipped by design.

Not exercised:

- Android emulator install/rollback of the APK (folded into the release checks;
  see `docs/BUILD_STATE.md`).
- Physical device rollback.
- Adapter downgrade against a database that already contains v3 data
  (the older binary ignores the tables, but this was not run).

Evidence: `docs/evidence/v0.4.0/adapter-v3-smoke.txt`,
`docs/evidence/v0.4.0/stillness-e2e.txt`.

## 6. FCM and background sync

- Push requires `JCODE_FCM_PROJECT_ID` and `JCODE_FCM_ACCESS_TOKEN`. Without both,
  `push.status` reports `configured: false` and notifications are skipped.
- Disabling background sync or notifications on the phone never stops a VPS
  turn. Android Doze may delay reconciliation; the daemon remains authoritative.
- Removing the app or clearing data removes the push registration on the next
  `push.unregister` attempt. If the app is uninstalled abruptly, the adapter
  keeps a stale token until FCM rejects it; delivery failure is recorded in
  `push.status.last_error`.
