# Mobile adapter contract

Verified against the JCode source that matches the installed binary, not just the handoff snapshot.

| Item | Value |
| --- | --- |
| Installed JCode | `jcode 0.99.1 (7206efd0c)` |
| Source tag | `v0.99.1` |
| Source commit | `7206efd0c1dbf49ef38d06b63f3a96a3a7cee611` (2026-10-22) |
| Handoff research commit | `629cca346f71f6c051cf8570dbea35cd0b20d5a2` (not the installed build) |
| Assignment source check | `b771fd11d2e156718c5b4d60739d296cc43ebce2` (exists) |
| Adapter protocol | v1, `{v, id, req}` / `{v, reply_to?, ev}` |

The installed binary's commit is resolved from the `v0.99.1` tag; the tag and the local version string agree. The VPS was not reachable, so the live server's build remains unverified.

## Verified transport and feature table

| Capability | Verified source | What the adapter does |
| --- | --- | --- |
| Raw daemon protocol is `type`-tagged JSON lines over a Unix socket | `crates/jcode-protocol/src/wire.rs`, `crates/jcode-harness-api-server/src/lib.rs` | Connects to `$JCODE_SOCKET` (`$JCODE_RUNTIME_DIR/jcode.sock`), not to `/ws` |
| Remote gateway is raw WebSocket on `/ws`, default port 7643, disabled by default | `crates/jcode-base/src/gateway.rs` (`GatewayConfig`) | Does **not** reuse it; the adapter is the authenticated mobile transport |
| Subscribe accepts `continue_on_disconnect`, default `false` | `crates/jcode-protocol/src/wire.rs` (`Subscribe`) | Sets `continue_on_disconnect: true` on **every** attach, including abrupt EOF |
| Subscribe accepts exact `target_session_id` and `working_dir` | same | Uses `target_session_id` to attach, `working_dir` only to create |
| Curated bridge attach omits continuation | `crates/jcode-harness-api-server/src/translate.rs` lines 603-655 | Rejected as the session transport; bridge is used for control-plane reads only |
| Harness bridge serves inventory, archive/restore, peek, todo state, file reads from disk | `crates/jcode-harness-api-server/src/translate.rs` (`list_sessions`, `get_todo_state`, `read_file`) | Spawns/uses `jcode api-bridge` on a private socket for those verbs |
| Device registry is `$JCODE_HOME/devices.json`; tokens are SHA-256 hashed; codes are 6 digits and expire in five minutes | `crates/jcode-base/src/gateway/registry.rs` | Validates the same bearer tokens; consumes the same codes (`jcode pair`) |
| Header bearer auth is preferred; query tokens are also accepted by the gateway | `crates/jcode-base/src/gateway/auth.rs` | Header only; query tokens are rejected |
| Daemon `ack` for a `message` is agent acceptance, not merely frame parsing | `crates/jcode-app-core/src/server/client_lifecycle.rs`; bridge comment at `translate.rs` `"ack"` | Emits `message_accepted` with the client message id and records it in a bounded delivery ledger |
| Soft interrupt takes an opaque `client_id`, echoed in `soft_interrupt_injected` | `wire.rs`, `wire/events.rs` | Emits queued/injected identities; never claims incorporation without the matching id |
| History carries `messages_base_count`, `images_unchanged`, `was_interrupted`, `reload_recovery` | `wire/events.rs` `History` | Full attach history (no prefix claim), bounded to a recent window with `base_index` and a tail fingerprint |
| Tool streaming is `tool_start` → `tool_input` deltas → `tool_exec` → `tool_done` | `wire/events.rs` | Accumulates bounded JSON, emits a parsed `tool_exec.input`, truncates output at 64 KiB |
| `retry_rollback`, `text_replace`, `text_suffix_replace` | `wire/events.rs` | Emits retraction/replacement frames so the client never duplicates a response |
| `turn_stopped` precedes terminal `done`; `done` is turn completion | `wire/events.rs` | Suppresses a duplicate `done` after `turn_stopped`; increments a per-attachment turn id |
| No wire-level turn identity field at this tag | `wire.rs`, `wire/events.rs` | Adapter-normalized `attachment_id` + monotonic `turn_id` |
| Todo state is a disk snapshot, not an attachment | `jcode-harness-api-server/src/translate.rs` `get_todo_state` | Fetched through the bridge; no plan inference |
| Permissions types exist but the bridge does not advertise permissions | `translate.rs`, `lib.rs` hello capabilities | Adapter advertises no `permissions`; the app has no approval UI |
| Push is not demonstrated end to end | source review | Adapter advertises no `push`; the app shows “Not available on this server” |

## Adapter-normalized additions

These fields are additive to the curated vocabulary and are required for mobile correctness:

| Addition | Purpose |
| --- | --- |
| `attachment_id` on every stream/history frame | Fences frames from a previous attachment after reconnection |
| `turn_id` (monotonic per attachment) | Stops a late terminal frame from completing newer work |
| `history.base_index`, `total_messages`, `tail_fingerprint` | Bounded windows and a reconciliation base without a fake cursor |
| `history.accepted_client_ids` | Resolves an ambiguous send only when the server actually accepted it |
| `history.interrupted_at_attach`, `history.recovery` | Source-backed daemon-death recovery state |
| `send_rejected` | Distinguishes a known rejection from ambiguous delivery |
| `session_status.pending_soft_interrupts` | Reports queued guidance count without inventing state |

## Explicit non-goals

- No replay of every missed token after reconnection; authoritative history plus future events is the contract.
- No phone-side idempotency key for arbitrary messages; the delivery ledger is evidence, not a durable exactly-once guarantee.
- No background mobile socket requirement; continuation is server-owned.
- No multi-process-per-phone agent runtime, second transcript store, or provider proxy.
- No claim that the installed server equals the reviewed source beyond the binary's version/commit evidence.
