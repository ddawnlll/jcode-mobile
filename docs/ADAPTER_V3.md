# Adapter v3

Status: implemented in `crates/adapter-*` for JCode Mobile 0.4.0. Verified with
unit, integration and real-daemon smoke tests; native Android device testing is
tracked separately in `docs/evidence/v0.4.0/`.

Adapter v3 keeps every v2 request and event shape. It adds version negotiation,
a durable per-session event journal, cursor replay, delta session sync,
diagnostics, and validated inline image attachments. The JCode daemon remains
the only execution host; the adapter and the phone are observers.

## Version negotiation

| Item | v2 | v3 |
| --- | --- | --- |
| Wire version | 2 | 3 |
| WebSocket subprotocol | `jcode.mobile.v2` | `jcode.mobile.v3` |
| Minimum client | 2 | 2 |
| Capability list | 22 entries | 29 entries |
| Event replay | in-memory ring only | SQLite journal with cursors |
| Session sync | full list | `sessions.delta` + revision |
| Diagnostics | `/health` only | `diagnostics.snapshot` |

A connection starts with `client.hello` carrying `min_version` and
`max_version`. The adapter selects the highest mutually supported version and
reports it as `negotiated_version` in `server.hello` (also
`max_protocol_version`). Every outbound frame on that connection is normalized
to the negotiated version, so a v2 client never receives a `v: 3` frame. A
client with no overlapping range is rejected with
`unsupported_version`, never silently downgraded.

The handshake is deliberately speakable at version 2 so a v2-only adapter can
answer a v3-capable client. The Stillness client therefore offers
`jcode.mobile.v3`, `jcode.mobile.v2` and the token subprotocol, and sends
`client.hello` at `v: 2`.

## Capabilities added in v3

```
protocol.v3
events.journal
events.subscribe
events.ack
sessions.delta
diagnostics.snapshot
attachments.images
```

`CAPABILITIES` in `crates/adapter-protocol/src/lib.rs` is the source of truth.
A string is added only with a dispatch arm and a conformance test. Unknown
request types return `bad_request`; unsupported features are never treated as
success.

## Durable event journal

Schema (SQLite, WAL, `synchronous=NORMAL`):

| Table | Purpose |
| --- | --- |
| `event_journal(session_id, seq, epoch, turn_id, operation_id, event_json, observed_at_ms)` | ordered adapter-observed events per session |
| `event_cursors(device_id, session_id, acked_seq, updated_at_ms)` | per-device acknowledged cursor |
| `session_index(session_id, server_id, summary_json, revision, removed, updated_at_ms)` | delta sync index |
| `meta(key, value)` | `server_id`, `session_revision` |

`seq` is allocated inside the insert transaction with
`COALESCE(MAX(seq),0)+1`, so a restart cannot reuse or skip a value. The journal
survives adapter restart and continues the same per-session sequence.

Retention:

- Per session: `JCODE_ADAPTER_JOURNAL_RETENTION` (default 4096, clamp 128 to
  65536). Rows below `latest - retention` are deleted in the same transaction.
- Time based: rows older than 14 days are compacted at startup and every six
  hours.
- Session index tombstones older than 30 days are removed. A client offline
  longer than that receives a full listing instead of trusting its cache.

Semantics:

- `seq` is adapter-observed ordering, not a persisted daemon message id.
- A replay from below the retained floor reports `gap: true` and the retained
  `floor_seq`. Missing events are never reconstructed or invented.
- `epoch` identifies one adapter process. A client with an old epoch (or a
  cursor ahead of `latest_seq`) is told `resync_required: true` and receives an
  authoritative snapshot.
- An operation is never re-dispatched because an event acknowledgement was
  lost. Event replay and operation idempotency are separate guarantees.
- Exactly-once *agent execution* is not promised by the journal. The operation
  journal (`operations` table) is the execution guard.
- WAL with `synchronous=NORMAL` survives process crash. An OS-level crash may
  lose the last commits; that is reported as a gap or an unknown operation, not
  as accepted content.

### `events.subscribe`

Request:

```json
{
  "session_id": "session_abc",
  "after_seq": 41,
  "epoch": "epoch_...",
  "limit": 512,
  "tail": 160,
  "include_snapshot": false
}
```

Reply:

```json
{
  "session_id": "session_abc",
  "epoch": "epoch_...",
  "events": [
    {
      "seq": 42,
      "turn_id": "turn_...",
      "operation_id": "op_...",
      "event": { "kind": "text_delta", "text": "OK", "message_id": null },
      "observed_at_ms": 1794673674000
    }
  ],
  "floor_seq": 1,
  "latest_seq": 42,
  "gap": false,
  "has_more": false,
  "resync_required": false,
  "snapshot": null
}
```

`has_more` means page again from the last returned `seq`. When
`resync_required` is true a snapshot is attached when the daemon is reachable;
if it is not, the reply still carries the retained events and the client shows
a recovery state rather than claiming current content.

### `events.ack`

```json
{ "session_id": "session_abc", "seq": 42 }
```

The cursor only moves forward. `acked_seq` is persisted per device. An ack is a
retention/resume aid, not delivery proof for a prompt.

## Delta session sync

`sessions.delta` reconciles the durable index against the daemon, then returns:

```json
{
  "revision": 8,
  "full": false,
  "sessions": [ ...changed summaries... ],
  "removed": ["session_gone"],
  "projects": [],
  "source": "jcode.list_sessions",
  "observed_at_ms": 1794673677000,
  "stale": false
}
```

- `since_revision: 0` (or a revision ahead of the adapter) returns `full: true`
  and replaces the client list.
- Otherwise only changed summaries are sent. A summary is resent when any field
  changes, including `status` and `updated_at_ms`.
- Removals are tombstones, never inferred from absence in an incremental reply.
- If the daemon is unreachable, the adapter returns its last index with
  `stale: true` and `source: adapter.sqlite.session_index`. The client must
  label that as saved-on-this-phone, not current.
- `sessions.list` remains the full authoritative listing and now includes the
  same `revision`.

## Diagnostics and failure injection

`diagnostics.snapshot` (authenticated WebSocket request) returns real counters:

- JCode link health, last contact, reconnect count, last error, active turns.
- Journal event count, JSON bytes, sessions, oldest/newest timestamps,
  retention, append failures.
- Connections, devices, subscriptions, frames in/out, gaps announced.
- Operation counts (pending, unknown, accepted).
- Latency p50/p95 for dispatch and replay (bounded 256-sample ring).
- Fault injection state.

`/health` remains unauthenticated and minimal; it now also reports protocol
range, epoch, journal event count and active connections.

Fault injection is opt-in through `JCODE_ADAPTER_FAULTS`:

| Rule | Effect |
| --- | --- |
| `delay_dispatch_ms=250` | sleeps before writing the prompt |
| `delay_replay_ms=250` | sleeps before answering a replay |
| `journal_fail` | the hub refuses the append and emits `journal_unavailable` |
| `backend_unavailable` | dispatch fails with `provider_unavailable` |

A remote client cannot enable fault injection.

## Image attachments

`operations.reserve` accepts up to four inline images:

```json
{
  "operation_id": "op_...",
  "session_id": "session_abc",
  "kind": "send",
  "body": "what is in this screenshot?",
  "expected_turn_id": null,
  "images": [
    { "media_type": "image/png", "data_base64": "iVBOR...", "name": "shot.png" }
  ]
}
```

The adapter validates, in order: count, media type (`image/png`, `image/jpeg`,
`image/webp`, `image/gif`), base64, decoded size (4 MiB each), and file magic
bytes. Invalid images reject the whole reservation. Validated tuples are stored
against the operation id and passed to the harness `SendMessage.images`. A
retry of the same operation id with different attachments is a conflict. A
retry that drops attachments is also a conflict, so an image message can never
silently become text-only.

## Security boundaries

- Device bearer tokens are hashed at rest; the adapter stores no plaintext
  token. The phone stores its token in the platform keystore (Tauri stronghold
  or the native Android Keystore path).
- Pairing codes are single use, expire in ten minutes, and are rate limited per
  source address (10 attempts per minute).
- Browser origins must be loopback, `tauri://localhost`, or explicitly listed
  in `JCODE_ADAPTER_ALLOWED_ORIGINS`.
- File previews are confined to configured roots; denied names (`.ssh`, keys,
  dotenv files, credential exports) are rejected.
- `seq`, `epoch`, `turn_id`, `operation_id` and `session_id` scope every event.
  A slow response cannot overwrite newer state.
- The journal stores event payloads, which may include transcript text. It lives
  in the adapter data directory with restrictive permissions and bounded
  retention. There is no remote filesystem capability.

## Migration from v2

1. Back up the adapter data directory (`adapter-v2.sqlite3`).
2. Deploy the 0.4.0 adapter binary (`jcode-adapter-v3`). The `-v2` binary name
   is retained and runs the same code, so existing service units keep working.
3. Existing tables are extended in place with `CREATE TABLE IF NOT EXISTS`. No
   destructive migration runs and no device token is invalidated.
4. Existing paired phones keep working on protocol v2. Upgrading the app
   negotiates v3 on the next connection and starts using replay and delta sync.
5. `/health` reports `protocol_version: 3` and `min_protocol_version: 2`.

Rollback:

1. Stop the adapter.
2. Run the 0.3.1 adapter against the same data directory. Unknown tables are
   ignored by the older binary; device tokens and operations remain valid.
3. Phones negotiate v2 and fall back to full listings and snapshot recovery.
4. If the database must be restored, use the pre-upgrade backup. Do not delete
   the data directory unless the user explicitly accepts losing device tokens.

Migration and rollback were exercised on the isolated staging daemon on
2026-11-14; see `docs/evidence/v0.4.0/`.

## Measured results

From `docs/evidence/v0.4.0/adapter-v3-smoke.txt`, real JCode daemon, macOS,
2026-11-14:

| Measurement | Result |
| --- | --- |
| Negotiated version | 3 |
| Handshake from v2 client | PASS |
| Full then incremental delta | PASS; only genuinely changed summaries resent |
| Real agent turn (`Reply with exactly: OK`) | PASS, assistant text `OK` |
| Journal sequence at end of turn | 7 events, no gap |
| Reconnect replay from ack | PASS, 0 duplicate events, no resync |
| Operation after reconnect | `accepted`, no second execution |
| Dispatch latency p50/p95 (sub-millisecond) | 0 ms / 0 ms |
| Replay latency p50 | 0 ms |
| Journal append failures | 0 |

Sub-millisecond values are reported as 0 because the diagnostic stores whole
milliseconds. They are not presented as a precise latency claim.

Stillness Playwright e2e against the v3 adapter: 4 passed, 3 skipped by design
(`docs/evidence/v0.4.0/stillness-e2e.txt`). Browser coverage is not native
Android verification.
