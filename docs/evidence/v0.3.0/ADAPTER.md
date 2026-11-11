# Adapter v2 implementation

## Process layout

`jcode-adapter-v2` is one Rust binary with three crates:

- `adapter-protocol`: versioned v2 envelopes, request/response payloads, tagged
  session events, capability strings, and the monotonic operation state table.
- `adapter-core`: configuration, SQLite WAL store, pairing/auth, root-scoped
  filesystem, turn registry, and the synchronous JCode SDK link.
- `adapter-server`: Axum routes, authenticated WebSocket lifecycle, bounded
  per-session sequence hub, request dispatch, and the backend event pump.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /health` | Adapter version, server id, protocol version, JCode link health |
| `POST /v2/pair` | Single-use pairing code redemption, returns device token and server info |
| `GET /v2/ws` | Authenticated mobile v2 WebSocket |
| fallback | Optional static Stillness build when `JCODE_ADAPTER_WEB_DIR` is set |

The WebSocket token is read from `Authorization: Bearer` for native clients or
from the `token.<bearer>` offered subprotocol for browsers, which cannot set
headers on a WebSocket. The token never appears in the URL.

## JCode link

- The SDK is pinned to fork commit
  `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8` in the workspace manifest and
  `Cargo.lock`.
- The synchronous SDK client is created and used on blocking workers only. The
  event supervisor owns a dedicated OS thread.
- The bridge attaches one session per native connection. The supervisor uses
  the SDK's bounded `global_events` fan-in so a send in session B does not stop
  events for a still-running session A. A single-client fallback is used only
  if global discovery cannot start.
- Event batches are bounded (`JCODE_ADAPTER_EVENT_QUEUE`, default 512) and each
  session keeps a ring of 512 replayable events. A lagging receiver gets a
  `NeedsReconcile` event with the skipped count instead of invented events.

## Operation state

```
staged -> reserved -> dispatching -> accepted
                            \-> rejected
                            \-> unknown -> observed_in_history
                            \-> unknown -> accepted   (late authoritative ack)
reserved/staged -> cancelled
```

`operations.dispatch` marks `dispatching` before calling `send`, and returns an
acknowledgement that the frame was written, not that a model replied. The
adapter waits for `ApiEvent::MessageAccepted` to mark `accepted`. A five-second
timeout marks the operation `unknown` and broadcasts reconciliation. Nothing
auto-resends.

## Snapshots and fences

`sessions.subscribe` attaches the connection to a session scope, builds an
authoritative snapshot from `list_sessions`, `peek_session`, runtime, plan and
usage, and replays adapter events after `after_seq`. Events carry
`session_id`, `turn_id`, `operation_id`, `epoch`, and per-session `seq`.
The client ignores:

- events for another active session,
- events from another epoch,
- duplicate or older sequence numbers,
- text/tool events for a different turn than the live turn.

A gap triggers a snapshot instead of a guessed patch.

## Files and projects

Projects are adapter-owned rows over canonical directories under configured
allowed roots. Paths are canonicalized and rejected on traversal, absolute
input, NUL, protected names, or symlink escape. Directory listings cap at 500
entries per page; previews cap at `JCODE_ADAPTER_MAX_FILE_BYTES` (default
256 KiB) and mark truncation/binary content.

## Known limits

- The curated SDK exposes aggregate edit statistics, not a per-file diff. The
  Changes screen says so.
- The JCode bridge attaches one session per connection. This adapter starts a
  bounded child connection per persisted session for events; the cost grows
  with the number of sessions.
- Cancellation is session-scoped upstream. The adapter verifies the expected
  turn before sending it but reports `atomic_turn_scope: false`.
- Attachments are not implemented and the composer does not pretend they are.
- Provider entitlement is not inferred from a model catalog.
