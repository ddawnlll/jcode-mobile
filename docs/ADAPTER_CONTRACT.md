# Adapter v2 contract and source evidence

This document records the implementation boundary for JCode Mobile 0.3.0. The
wire reference is [`API.md`](API.md). The payload types are in
`crates/adapter-protocol/src/lib.rs`; the adapter is one process with one SQLite
journal.

The older TypeScript adapter in `integration/jcode-adapter` is retained for the
Expo 0.2.x line. It is not the 0.3.0 transport and is not used by the Stillness
12 client.

## Pinned JCode source

| Item | Value |
| --- | --- |
| JCode fork | `ddawnlll/jcode`, branch `command-code-native-provider` |
| Pinned commit | `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8` |
| Harness API | `jcode-harness-api` v1.11, major 1 |
| SDK | `jcode-sdk` from the same commit |
| Wire protocol | Mobile protocol v2, `jcode.mobile.v2` |

The adapter uses the curated SDK and harness API. It does not parse the JCode
daemon protocol, translate raw daemon frames, or duplicate provider auth.

## Process boundary

```text
Stillness 12 (Tauri / web)
        | HTTPS + WSS
        v
jcode-adapter-v2
  ├─ Gateway: pair, bearer auth, origin policy, limits
  ├─ Operations: SQLite WAL journal, reserve, dispatch, receipts
  ├─ Sessions: summaries, snapshots, event fanout, epoch/seq
  ├─ Workspace: canonical projects, root-scoped files
  └─ JCode link: jcode-sdk + harness API socket
        |
        v
JCode daemon and providers
```

Important split:

- **Adapter** owns the device token, operation journal, session fanout, and
  project rows.
- **JCode** owns the agent runtime, transcript, provider credentials, model
  routes, plans, tool execution, and token usage.
- **Client** owns motion, drafts, reading anchors, and presentation. It does not
  own execution state.

## Authentication and pairing

| Claim | Source |
| --- | --- |
| Pairing code is readable, single-use, and expires after 10 minutes | `adapter-core/src/auth.rs`, `CODE_TTL_MS` |
| Codes and device tokens are stored as SHA-256 hashes | `adapter-core/src/store.rs` |
| Token is returned once by `/v2/pair` | `adapter-server/src/ws.rs` |
| Token is accepted as `Authorization: Bearer` or `token.<bearer>` subprotocol | `ws.rs`, `extract_token` |
| Query-string tokens are not accepted | `extract_token` reads headers only |
| Revocation closes existing sockets for the device | `state.revocation`, `handle_revoke` |
| Failed pairing attempts are rate-limited per peer IP | `pair_attempt_allowed` |

The adapter does not use JCode's `devices.json` for mobile pairing. Adapter v2
has its own device registry in `adapter-v2.sqlite3`. This is a deliberate break
from the 0.2.x adapter.

## Operations and delivery

```text
staged -> reserved -> dispatching -> accepted -> observed_in_history
                           |-> rejected
                           |-> unknown -> observed_in_history
                           |-> unknown -> accepted   (late authoritative ack)
staged/reserved -> cancelled
```

- `dispatching` is a write to JCode, not an agent acceptance.
- `accepted` requires an authoritative `MessageAccepted` event.
- Five seconds without acceptance becomes `unknown`.
- `unknown` is visible. The client never auto-resends.
- A late acceptance can promote `unknown` to `accepted`.
- A real transcript match can promote `accepted` or `unknown` to
  `observed_in_history`.
- Duplicate reserve and dispatch calls are idempotent by `operation_id`.
- A restart moves in-flight operations to `unknown`.

`operations.cancel` verifies `expected_turn_id` or `operation_id` before calling
JCode. The upstream cancel is session-scoped, so the response reports
`atomic_turn_scope: false`. The client must not claim an atomic turn cancel.

## Session snapshots and fencing

A snapshot is built from `list_sessions`, bounded `peek_session`, runtime, plan,
and usage. It carries:

- `session_id`, summary, messages, runtime, plan, context
- optional `active_turn`
- `epoch`, `last_seq`, `revision`, `authoritative_at_ms`, `stale`
- `source`

Event frames carry `server_id`, `session_id`, `epoch`, `seq`, optional
`turn_id`, and optional `operation_id`. The client ignores:

- frames from another session,
- frames from another epoch,
- duplicate or older `seq`,
- text and tool frames for a turn other than the live turn.

A gap or `needs_reconcile` forces a snapshot. A snapshot never invents the
missing events.

## Event mapping

| JCode event | Adapter event |
| --- | --- |
| `MessageAccepted` | operation `accepted` |
| `TextDelta` / `TextDone` / `TextReplace` | `text_delta`, `text_done`, `text_replace` |
| `ReasoningDelta` / `ReasoningDone` | `reasoning_delta`, `reasoning_done` |
| `ToolStart` / `ToolInput` / `ToolExec` / `ToolDone` | tool lifecycle events |
| `TokenUsage` | `token_usage` |
| `SessionStatus` / `ConnectionPhase` | status events |
| `History` / `PeekSession` | `sessions.snapshot` / `sessions.peek` |
| `TodoState` | `plan.snapshot` and `plan_updated` |
| cancel or provider stop | `turn_stopped` |
| turn completion | `turn_done` |

The adapter does not turn a timer into progress, a model catalog into an
entitlement, or aggregate edit stats into a per-file diff.

## Files and projects

- A project is an adapter SQLite row over a canonical directory under
  `JCODE_ADAPTER_ALLOWED_ROOTS`.
- The canonical path is the uniqueness key.
- Directory listings default to 200 entries and cap at 500.
- Previews cap at `JCODE_ADAPTER_MAX_FILE_BYTES` (default 256 KiB) and mark
  `truncated` or `binary`.
- Path resolution rejects traversal, absolute input, NUL, protected names, and
  symlinks that escape the root.
- Folder creation accepts one safe segment and verifies the created path stays
  under the root.
- There is no file write, rename, delete, or execution endpoint.

## Command Code and provider state

The pinned JCode fork exposes Command Code as a native provider. The adapter
reads route and entitlement evidence from `ListModels` and `GetRuntimeInfo`.
It never reads, proxies, logs, or stores a provider key.

`command_code_available` starts as `null` and becomes `true` or `false` only
after a real runtime response proves the route state. It is not inferred from
the presence of a model name.

## Non-goals

- No phone-side agent or model call.
- No second canonical transcript.
- No exactly-once delivery claim. The operation journal is evidence, not a
  distributed transaction.
- No background mobile socket requirement.
- No push notification, approval, or progress percentage without a server
  capability.
- No TLS terminator, VPN client, or SSH client in the adapter.
- No raw daemon protocol bridge in Adapter v2.

## Known limits

- Upstream cancellation is session-scoped.
- Attachments are not implemented in the mobile composer.
- JCode's curated API exposes aggregate change statistics, not a verified
  per-file diff.
- The persisted snapshot may contain only the user side of a just-completed
  turn; the live event stream carries the assistant text. The client keeps the
  live view until it can reconcile, rather than fabricating the missing side.
- The adapter event supervisor starts a bounded child connection per persisted
  session, so cost grows with session count.

For setup, read [`GETTING_STARTED.md`](GETTING_STARTED.md). For the wire
reference, read [`API.md`](API.md).
