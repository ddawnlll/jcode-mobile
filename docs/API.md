# Adapter v2 API

The JCode Mobile adapter is one authenticated HTTP and WebSocket service. It
uses the JCode SDK and harness API, and exposes a versioned mobile protocol to
the Stillness 12 client. This document describes the implementation in
`crates/adapter-*` at version 0.3.1.

The protocol crate is the source of truth for payload types:
[`crates/adapter-protocol/src/lib.rs`](../crates/adapter-protocol/src/lib.rs).
The JSON Schema in [`contracts/`](contracts/) validates the common envelope;
payload-level detail lives here and in that Rust module.

## Base URL and endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Adapter identity, protocol version, JCode link health |
| `POST` | `/v2/pair` | Redeem a single-use pairing code for a device token |
| `GET` | `/v2/ws` | Authenticated mobile v2 WebSocket |
| `GET` | `/*` | Optional static Stillness build when `JCODE_ADAPTER_WEB_DIR` is set |

`/health` is unauthenticated and returns:

```json
{
  "ok": true,
  "server_id": "srv_...",
  "adapter_version": "0.3.1",
  "protocol_version": 2,
  "jcode_connected": true,
  "jcode_server": "jcode-harness-api-bridge/0.1.0"
}
```

`jcode_connected` is the only health claim. A `true` value means the adapter
has a live SDK connection; it is not a promise that every provider route is
entitled.

## Pairing

```http
POST /v2/pair
Content-Type: application/json

{"code": "ABCD-EFGH-JKLM", "device_name": "Pixel 9"}
```

```json
{
  "token": "base64url-device-token",
  "device": {
    "device_id": "dev_...",
    "name": "Pixel 9",
    "created_at_ms": 1794474761468,
    "last_seen_at_ms": 1794474761468
  },
  "server": {
    "server_id": "srv_...",
    "name": "JCode Mobile",
    "adapter_version": "0.3.1",
    "protocol_version": 2,
    "min_protocol_version": 2,
    "jcode_version": "jcode-harness-api-bridge/0.1.0",
    "jcode_protocol_version": 1,
    "jcode_capabilities": ["..."],
    "healthy": true,
    "capabilities": ["sessions.list", "..."],
    "started_at_ms": 1794474700000,
    "command_code_available": true
  }
}
```

The pairing code is single-use, expires after ten minutes, and is compared by
hash. Invalid or expired codes return `401` with an error payload. Repeated
attempts from one peer IP return `429`.

The token is shown once. Store it in the OS credential store. It is sent on the
WebSocket as `Authorization: Bearer <token>` or, for browsers that cannot set a
header, as the `token.<token>` WebSocket subprotocol.

## WebSocket handshake

```http
GET /v2/ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Protocol: jcode.mobile.v2
Authorization: Bearer <token>
```

Browser form:

```text
Sec-WebSocket-Protocol: jcode.mobile.v2, token.<token>
```

The adapter rejects an unauthenticated or revoked token with `401`, and a
disallowed browser `Origin` with `403`. Native Tauri origins
(`tauri://localhost`, `http(s)://tauri.localhost`) and loopback origins are
accepted. Other origins must be listed in `JCODE_ADAPTER_ALLOWED_ORIGINS`.

## Envelope

Every frame is one JSON object:

```json
{
  "v": 2,
  "kind": "request",
  "id": "client-request-id",
  "reply_to": "client-request-id",
  "server_id": "srv_...",
  "session_id": "session_...",
  "operation_id": "operation_...",
  "epoch": "epoch_...",
  "seq": 41,
  "type": "sessions.snapshot",
  "payload": {}
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `v` | yes | Must be `2` |
| `kind` | yes | `request`, `response`, or `event` |
| `id` | yes | Non-empty frame id |
| `reply_to` | responses | The request `id` being answered |
| `server_id` | scoped frames | Adapter identity |
| `session_id` | session frames | Session scope |
| `operation_id` | operation frames | Client-generated operation id |
| `epoch` | stream frames | Adapter process epoch |
| `seq` | stream frames | Monotonic per-session sequence within the epoch |
| `type` | yes | Message type |
| `payload` | yes | Type-specific object |

A request must use `kind: "request"`. A response carries the same `type` as the
request unless it is an `error`. The adapter echoes `server_id`, `session_id`,
and `operation_id` where applicable.

## Handshake

### `client.hello`

```json
{
  "client_name": "Stillness 12",
  "client_version": "0.3.1",
  "min_version": 2,
  "max_version": 2,
  "supports": ["sessions.list", "operations.dispatch"]
}
```

### `server.hello`

```json
{
  "server": { "...": "ServerInfo" },
  "device": { "...": "DeviceInfo" },
  "resumed": false
}
```

The client must reject a server whose `protocol_version` is outside its range.
`server.capabilities` lists requests the adapter actually implements. Do not
infer a capability from a route, a UI screen, or a provider catalog.

### `server.status`

Returns `jcode_connected`, a connection message, and an observation timestamp.

### `server.ping`

Returns `server.pong` with `at_ms`.

## Capabilities

The adapter currently advertises:

```text
pairing, device_revocation,
sessions.list, sessions.create, sessions.subscribe, sessions.snapshot,
sessions.history, sessions.rename,
operations.dispatch, operations.lookup, operations.cancel,
projects.list, projects.create,
files.list_dir, files.read_preview, folders.create,
models.list, models.set, reasoning.set,
context.snapshot, plan.snapshot, activity.snapshot,
tool.permission_response
```

`operations.reserve` is implemented on the wire but is not advertised as a
separate capability. The client normally calls `operations.reserve` then
`operations.dispatch`.

## Requests

### Sessions

| Type | Payload | Response |
| --- | --- | --- |
| `sessions.list` | `{}` | `SessionsListPayload`: `sessions`, `projects`, `source`, `observed_at_ms`, `stale` |
| `sessions.create` | `CreateSessionRequest`: `client_request_id`, optional `project_id`, `working_dir`, `title` | `CreateSessionResponse`: `session`, `created` |
| `sessions.subscribe` | `session_id`, optional `tail` (default 80), `after_seq` | `sessions.snapshot`, then future `session.event` frames |
| `sessions.snapshot` | Same shape as subscribe | `SessionSnapshotPayload` |
| `sessions.peek` | `session_id`, optional `tail` | `session`, `messages`, `source`, `observed_at_ms` |
| `sessions.history` | `session_id`, optional `tail` | `messages`, `source`, `observed_at_ms` |
| `sessions.rename` | `session_id`, `title` | `session` or acknowledgement |

`client_request_id` is an idempotency key. Repeating a create with the same id
returns the same session with `created: false`.

A `sessions.snapshot` carries the current summary, bounded messages, runtime,
plan, context, optional active turn, `epoch`, `last_seq`, `revision`,
`authoritative_at_ms`, `stale`, and `source`. A client that sees a gap or
`needs_reconcile` must request a fresh snapshot rather than guess.

### Operations

| Type | Payload | Response |
| --- | --- | --- |
| `operations.reserve` | `operation_id`, `session_id`, `kind`, `body`, optional `expected_turn_id` | `operations.state` |
| `operations.dispatch` | `operation_id` | `operations.state` |
| `operations.lookup` | `operation_id` | `operations.state` |
| `operations.cancel` | `session_id`, optional `operation_id`, optional `expected_turn_id` | `cancelled`, `turn_id`, `atomic_turn_scope`, `note` |

`kind` is `send` or `soft_interrupt`. The body limit is 256 KiB. The operation
state machine is:

```text
staged -> reserved -> dispatching -> accepted
                           |-> rejected
                           |-> unknown -> observed_in_history
                           |-> unknown -> accepted   (late authoritative ack)
staged/reserved -> cancelled
```

`dispatching` means the adapter wrote the request. `accepted` requires an
authoritative JCode acceptance event. A five-second timeout becomes `unknown`.
Nothing auto-resends. A late acceptance can resolve `unknown` to `accepted`, and
history can resolve it to `observed_in_history`, but an ambiguous send stays
visible as ambiguous until evidence arrives.

Cancellation is session-scoped upstream. The adapter verifies the expected turn
before sending it and reports `atomic_turn_scope: false` so the client can label
the residual race.

### Models, reasoning, context, plan, activity

| Type | Payload | Notes |
| --- | --- | --- |
| `models.list` | `session_id` | Returns runtime and provider routes, including `is_command_code` and `available` |
| `models.set` | `session_id`, `model`, optional `expected_provider` | Applies only an advertised route; the provider check is optional but recommended |
| `reasoning.set` | `session_id`, `effort` | Applies a provider-backed effort label |
| `context.snapshot` | `session_id` | Token usage and effective budget; missing values stay `null` |
| `plan.snapshot` | `session_id` | Reported plan or `null` |
| `activity.snapshot` | `session_id` | Observed activity, bounded and newest first |
| `tool.permission_response` | `session_id`, `request_id`, `decision` | `allow`, `allow_always`, or `deny` |

Model and context values are source-backed. The adapter does not estimate a
percentage from text length or tool events.

### Projects and files

| Type | Payload | Response |
| --- | --- | --- |
| `projects.list` | `{}` | `projects`, `source`, `observed_at_ms` |
| `projects.create` | `label`, `path`, optional `pinned` | `project` |
| `files.list_dir` | `project_id`, optional `path`, `limit` (default 200, max 500), `cursor` | `DirListing` |
| `files.read_preview` | `project_id`, `path` | `FilePreview` |
| `folders.create` | `project_id`, `parent`, `name` | `project_id`, `path`, `created` |

Every path is canonicalized under an allowed root. The adapter rejects
traversal, NUL bytes, escaping symlinks, protected names, and files larger than
`JCODE_ADAPTER_MAX_FILE_BYTES` (default 256 KiB). Previews mark `binary` and
`truncated` instead of guessing text.

### Devices

| Type | Payload | Response |
| --- | --- | --- |
| `device.list` | `{}` | `devices` |
| `device.revoke` | `device_id` | `revoked`, `device_id` |

Revocation closes existing WebSocket connections for that device.

## Events

Server events use `kind: "event"`.

### `session.event`

```json
{
  "v": 2,
  "kind": "event",
  "id": "evt_session_41",
  "server_id": "srv_...",
  "session_id": "session_...",
  "operation_id": "operation_...",
  "epoch": "epoch_...",
  "seq": 41,
  "type": "session.event",
  "payload": {
    "event": {"kind": "text_delta", "text": "..."},
    "turn_id": "turn_...",
    "operation_id": "operation_...",
    "observed_at_ms": 1794474768520
  }
}
```

Event kinds:

| Kind | Meaning |
| --- | --- |
| `turn_started` | A turn is active, with `turn_id` and `operation_id` |
| `text_delta`, `text_done`, `text_replace` | Assistant text and authoritative replacement |
| `reasoning_delta`, `reasoning_done` | Reasoning text, only when JCode sends it |
| `tool_start`, `tool_input_delta`, `tool_exec`, `tool_done` | Tool lifecycle and bounded output |
| `permission_request` | The harness requested a permission decision |
| `token_usage` | Usage and effective budget when available |
| `session_status` | Status string and optional pending soft-interrupt count |
| `connection_phase` | Transport phase reported by JCode |
| `session_recovery` | Interruption and recovery directive |
| `title_changed` | Persisted title changed |
| `plan_updated` | A new plan was reported |
| `context_cap_changed` | Context cap changed |
| `adapter_error` | Typed adapter error with retryable flag |
| `turn_stopped` | Explicit stop or provider stop reason |
| `turn_done` | Turn completion |
| `needs_reconcile` | Stream gap; request a snapshot |

`text_replace` must replace prior text, including after a `text_done`. The
client must not duplicate the replacement or drop terminal events while
coalescing paints.

### `operations.state`

An operation event is emitted whenever the journal transitions. It carries an
`OperationStatePayload` with the `operation` view and a `duplicate` flag.

### `server.connection`

Reports `jcode_connected`, a message, and `observed_at_ms`. This is a
transport-level health signal, not model output.

### `sessions.changed`

A lightweight invalidation. The client should refresh `sessions.list` or its
current snapshot, not assume the payload contains a session.

## Errors

Responses with `type: "error"` carry:

```json
{"code": "provider_unavailable", "message": "provider route is unavailable", "retryable": false}
```

| Code | Meaning |
| --- | --- |
| `unauthorized` | Missing, invalid, or revoked token, or invalid pairing code |
| `forbidden` | Origin or policy rejection |
| `bad_request` | Invalid envelope or payload |
| `unsupported_version` | Protocol version outside the supported range |
| `not_found` | Unknown session, project, operation, or path |
| `conflict` | Duplicate or state conflict |
| `not_supported` | Capability is absent |
| `provider_unavailable` | Provider or route cannot serve the request |
| `account_missing` | No provider account is configured |
| `model_unavailable` | Model route is unavailable |
| `delivery_unconfirmed` | Write happened but no authoritative acceptance |
| `turn_mismatch` | Expected turn does not match the active turn |
| `backpressure` | Bounded queue is full; retry after reconciling |
| `internal` | Unexpected adapter failure |

`retryable` is advisory. A `delivery_unconfirmed` operation must not be
auto-resent. Only an explicit user action may start a new attempt.

## Versioning

- The mobile protocol is `v2`. The client hello declares `min_version` and
  `max_version`; the server advertises `protocol_version` and
  `min_protocol_version`. The client rejects an incompatible server.
- `epoch` changes when the adapter process restarts. `seq` is monotonic within
  an epoch. Frames from another epoch are ignored.
- The adapter may add optional fields and new event kinds. Clients must ignore
  unknown fields and unknown event kinds in a session stream.
- Removing a capability or changing a payload shape requires a protocol
  version change.

## Security boundaries

- Bearer tokens are stored hashed in adapter SQLite.
- Pairing codes are hashed, single-use, and expire after ten minutes.
- Command Code credentials never enter the adapter process.
- File access is root-scoped and rejects traversal and protected files.
- The adapter does not implement TLS. Use a reverse proxy or a reviewed private
  tunnel for remote access.
- The web build is a verification surface and stores its token in
  `localStorage`, not a keystore.

For source evidence and explicit non-goals, see
[`ADAPTER_CONTRACT.md`](ADAPTER_CONTRACT.md). For setup and troubleshooting,
see [`GETTING_STARTED.md`](GETTING_STARTED.md).
