# 0.5.0 Feather and Arrow

Adapter v4 uses one async native JCode connection for each open or dispatched
session. The connection owns that session's commands and event stream. The
adapter reuses the translator from the pinned JCode source revision
`0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8`. It sends
`continue_on_disconnect: true` on every native subscription.

## Runtime and swarm

- The harness API connection serves inventory, archive and restore. Native
  subscriptions deliver text, tools, usage, model identity, and swarm state.
  The session pool holds up to 32 connections and reuses idle capacity.
- The adapter watches JCode's persisted session directory for inventory changes.
  A write for an attached session wakes a catalog refresh on that session's
  existing connection. The refresh also picks up effort changes made from
  another JCode client.
- The model picker sends the advertised model, provider and API method. Adapter
  v4 passes the resulting exact route to JCode's `set_route` and waits for its
  correlated reply. The effort slider uses JCode's provider/model ladder and
  displays the runtime's returned value.
- Native swarm events show child labels, lifecycle status, model and effort.
  Opening a child enters its own JCode session. Swarm membership and model
  identity are reconciled from a live snapshot after reconnect.

## Transport and rendering

The server negotiates mobile wire versions 2 through 4 on the existing
`/v2/ws` endpoint. Version 4 introduces `session.runtime`, `session.swarm`,
`sessions.unsubscribe`, and `transport.bytes`. Runtime and swarm updates are
live notifications. Conversation events retain the durable per-session
sequence, epoch, and replay cursor.

A large v4 response starts with a JSON `transport.bytes` descriptor that
declares the total UTF-8 byte length. It is followed by binary frames of up to
64 KiB, up to a 64 MiB package. The client assembles the declared number of
bytes before decoding JSON. Versions 2 and 3 use JSON text frames.

The event pump drains ready work in bounded groups. Adjacent deltas for one
message or tool call can share a journal event. A slow socket reconnects and
replays from its cursor. Replay pages are limited by serialized event bytes
and row count, with a single large event allowed on its own page.

Stillness applies stream updates once per animation frame. It loads Markdown on
demand for completed messages and starts with the newest 32 timeline entries.
The user can page through earlier entries. Large messages, reasoning and tool
payloads use bounded text pages. Message and tool copy controls use the full
source content.

## Build and migration

```sh
cargo build --release --locked -p adapter-server --bin jcode-adapter-v4
JCODE_ADAPTER_ALLOWED_ROOTS="$HOME/src" ./target/release/jcode-adapter-v4
```

Set `JCODE_HOME` to the daemon's home if it is customized. Adapter v4 opens
both `JCODE_API_SOCKET` and `JCODE_SOCKET` for the same JCode runtime. The
native socket defaults to `jcode.sock` beside the API socket. A custom native
socket path needs an explicit `JCODE_SOCKET`.

Run the new binary with the existing adapter data directory, bind address,
allowed roots and device credentials. Keep the v0.4.0 binary available for
rollback. The v2 and v3 binary names in this source tree are service aliases for
the current implementation.

## Verification

The same Bun dependencies and Vite settings produced these startup bundle
sizes.

| Revision | Initial JS | Initial JS, gzip | Deferred Markdown, gzip |
| --- | ---: | ---: | ---: |
| v0.4.0 | 512.02 kB | 166.37 kB | Included in initial JS |
| v0.5.0 candidate | 412.58 kB | 121.50 kB | 47.26 kB |

The Rust native-stream fixture checks the JCode attach, exact route selection,
message acceptance, external effort refresh and scoped swarm events. The
WebSocket and client checks cover a multibyte character on a package boundary.
The TypeScript timeline check covers reasoning, tool, and assistant ordering
within one rendered frame.

The workspace blocks Unix sockets, so the pinned JCode executable could be
compiled and the stream fixture exercised, while the real daemon smoke and
browser e2e require a host with Unix socket access. The APK build/install,
release signing and on-device frame pacing remain to be confirmed.

```sh
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
bun scripts/check-stillness-ux.mjs
JCODE_BIN=/path/to/pinned/jcode bash scripts/stillness-e2e.sh
bash scripts/build-stillness-android.sh
```

## References

- [JCode server and runtime lifecycle](https://github.com/1jehuang/jcode/blob/master/docs/SERVER_ARCHITECTURE.md)
- [Tokio bounded channels and backpressure](https://tokio.rs/tokio/tutorial/channels)
- [Axum WebSocket payload types](https://docs.rs/axum/latest/axum/extract/ws/enum.Message.html)
- [Rendering offscreen content with content-visibility](https://web.dev/articles/content-visibility)
