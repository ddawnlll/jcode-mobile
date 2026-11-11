# JCode Mobile 0.3.0 — Adapter v2 × Stillness 12 Motion

**Status:** Proposed, implementation-ready contract revision; not a claim that Adapter v2 is implemented or tested on devices.  
**Date:** 2026-11-11  
**Design source:** `jcode-stillness-v12-motion(1).html`, 1,994 lines; supersedes Stillness 06 / Precision.  
**App repository:** `ddawnlll/jcode-mobile`, `main` `37f8ead9917989e05d40009c9956bd49a4f72b0c`; PR #45 remains open and has unresolved E2E/native verification gates.  
**JCode baseline (runtime and SDK):** `ddawnlll/jcode` branch `command-code-native-provider`, pinned to `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8` (19 commits atop upstream `v1.0.0-preview.394` / `eb867111fffac2efeedd95a7ac9f7d6168260e6f`); harness API major 1/minor 11. Experimental fork, not an official upstream release.  
**Related previous plan:** `JCODE_STILLNESS_030_ADAPTER_V2_UPSTREAM_PLAN.md`. This RFC **replaces the v6 screen-to-contract matrix**, without erasing prior reliability/security requirements.

## 0 — Decision and scope

Build a **thin, server-side Rust Adapter v2** using JCode's `jcode-sdk` and `jcode-harness-api` as the only agent-control interface. Expose one authenticated mobile v2 API to the Stillness client (Tauri 2 + web front end is the candidate, not a proven winner yet). Keep one process and one SQLite journal. **Do not** port JCode's raw daemon protocol or invent a second agent/provider implementation. The dedicated JCode fork already contains the native Command Code integration; pin and reuse it, rather than rebuilding provider auth and transport inside Adapter v2.

This revision is **contract and implementation design**; no live adapter or Tauri binary is produced by these documents. A production implementation needs upstream extension(s), JCode compatibility tests, and physical-device validation. Support the old app with the current adapter until the new one passes.

## 1 — What changed in Stillness 12

The HTML includes **19 `.screen` surfaces** (welcome, setup, QR, manual pair, pair-progress, ready, session, home, sessions, projects, project, plan, activity, changes, settings, new-session, project-create, browser, draft), plus a desktop `v9` navigation shell and a right-hand inspector. The HTML explicitly says that server calls, pairing, file writes and streaming are simulated. Do not mistake local preview behavior for a supported JCode API.

### 1.1 UI-only responsibilities — never transmit as server events

- `--m12-enter` / `--m12-sheet` motion, compositing, touch-driven drawer, velocity projection, focus trap, reduced motion, glass effects, torus animation and ASCII artwork.
- Mobile `visualViewport` keyboard-safe composer, `interactive-widget=resizes-content`, scroll position, auto-follow, `Jump to latest`, and `Pause animation`.
- v12 local demo uses one `requestAnimationFrame` clock and **at most 20 DOM commits per second**; this is a **render scheduling budget**, not a wire frame rate or daemon throughput specification. Maintain full semantic event order even if the view coalesces text repaints.
- User-selected UI theme, glass, motion level and selected inspector tab. These are local preferences; they must not change remote execution or cancel turns.

### 1.2 Server-backed surfaces — implement or capability-gate

| Screen / feature | Client-facing v2 read or command | JCode source and gap |
|---|---|---|
| Welcome / setup | `server.capabilities`, pairing instructions | Local UI until the connection is genuine. |
| QR/manual pair | `pair.redeem` / `server.hello` / `device.revoke` | Reuse first-party device authority; TLS/verified tunnel; token stored in OS secure storage. |
| Home, sessions, sidebar, global search | `sessions.list`, `sessions.peek` / `sessions.subscribe` | SDK `list_sessions`, `peek_session`; cheap summaries, current timestamp, cached/unknown provenance. |
| Projects | `projects.list`, `projects.upsert`, `projects.pin` | Project is an adapter-owned mapping to canonical allowed *server* folder; no native JCode project entity. |
| New session / project selection | `sessions.create(project_id or permitted working_dir)` | SDK `create_session`; selected working directory is validated server-side. |
| Remote file browser (mobile and desktop inspector) | `files.list_dir`, `files.read_preview`, `files.search`, `folders.create` | JCode SDK `read_file`/`find_files` are insufficient as a true directory tree: build secure, root-scoped adapter listing. |
| Folder rename | `folders.rename` only if negotiated | HTML simulates it; must not silently enable before root/symlink/active-project safety and tests. |
| Conversation + new/draft composer | `operations.stage`, `operations.dispatch`, `operations.lookup`, `sessions.subscribe` | JCode `SendMessage` has no durable operation ID; implement honest `unknown` fallback and upstream proposal. |
| Live reasoning, text, tools | `session.event` + `sessions.snapshot` | SDK `TextDelta`, `TextDone`, `TextReplace`, `ReasoningDelta/Done`, `Tool*`, `TurnDone`; do not infer acceptance from unrelated events. |
| Running indicator / thinking time | `session.execution` with observation time | JCode `SessionStatus`, `ConnectionPhase`; elapsed UI timer must be labeled based on observed start, not invented work. |
| Plan | `plan.snapshot` / `plan.subscribe` | SDK `todo_state`; display counts and steps only when actually reported. |
| Activity | `activity.page` | Tool-call and status events, bounded, ordered, with source/freshness. |
| Changes | `changes.snapshot` / `files.read_preview` | JCode `SessionInfo.edit_stats` is aggregate, not a seven-file verified diff. File-level evidence must come from supported reports or a separately validated adapter provider. |
| Model picker / reasoning | `runtime.info`, `models.list`, `models.set`, `reasoning.set` | SDK `get_runtime_info`, `list_models`, `set_model`, `set_reasoning_effort`; route granularity must match JCode capabilities. |
| Context / usage | `context.snapshot` | SDK `TokenUsage`, model/window/effective budget when available. Never show invented numbers. |
| Desktop inspectors | `session.subscription` for active session plus read-only peek for others | Loading inspector files/plan/activity cannot attach or disturb another executing session. |

## 2 — Architecture, deliberately small

```
        Stillness 12 Tauri WebView (Android / iOS / desktop)
        ├── local motion / keyboard / scroll / preferences
        ├── durable local drafts and cache
        └── generated typed mobile v2 client
                         │ authenticated WSS + HTTPS
                         ▼
        jcode-mobile-adapter-v2 (one Rust binary)
        ├── Gateway: pair credentials, auth, limits, hello
        ├── Operations: SQLite WAL journal, dispatch & receipts
        ├── Sessions: session-scoped fanout + snapshots + sequence epochs
        ├── Workspace: projects, allowlisted directory listing, file reads
        └── JCode Link: official jcode-sdk + harness-api pinned to SHA
                         │ local harness API socket
                         ▼
                   JCode 1.0 Preview
```

Implementation guidance: Tokio + Axum/Tower + Serde for gateway; SQLite via `rusqlite` or `sqlx` (choose one), tracing with content-redaction. Do not create Redis/queue service or additional separate daemon. The upstream synchronous SDK must not block Tokio reactor threads: use dedicated session workers or `spawn_blocking` with bounded concurrency. A single session can have many read-only observers but state-changing commands require explicit ownership/permissions.

### Project / browser safety

- Server config provides `allowed_roots` (canonical absolute directories); client may never nominate its own arbitrary root. `project_id` maps to `(server_id, canonical_path, label, pinned)` stored in adapter SQLite. Uniqueness: `(server_id, canonical_path)`.
- Path resolution uses server-side file descriptors/OS-safe path traversal controls where possible; reject `..`, NUL, external symlinks, symlink races, device files, files above configured limits, and any path outside approved roots. Read-only listing/preview by default. Never expose `.jcode` secrets merely because `show hidden` is selected.
- `files.list_dir` supplies stable items `{name, kind, size?, modified_at?, hidden?}` with pagination, ownership and scoped path; it does **not** expose raw server filesystem authority to the UI.
- `folders.create` is a distinct, explicitly authorized write capability. Input is one validated path segment; operate relative to a validated directory descriptor, fail on collision, record outcome. Rename is disabled pending separate conformance work, despite the local HTML demo.
- `No project / Personal chats` must use a configured and allowed server directory, never assume `/home/quant/src` exists on every machine. Project creation should not silently mutate files other than requested creation.

## 3 — Mobile v2 wire contract (proposed, not upstream API)

Envelope: `{ "v": 2, "kind": "request|response|event", "id": "uuid", "server_id": "...", "session_id": "...", "operation_id": "...", "epoch": "...", "seq": 123, "type": "...", "payload": {...} }`. Optional fields depend on request type. Every event uses a stable session scope; `epoch + seq` is monotonic *within the adapter's retained epoch*. `seq` is an adapter ordering identifier, not a persisted JCode message ID. The companion `JCODE_STILLNESS_V12_PROTOCOL_EXAMPLES.json` contains candidate exchanges.

**Handshake:** `client.hello` → `server.hello` advertises mobile protocol version 2 separately from JCode harness API v1.11 and verified capabilities (never advertise what is only mocked). Include host identity, build SHA, JCode preview version and snapshot freshness. Incompatible clients fail with typed errors.

**Operations:** `send`/`soft_interrupt`/`cancel` have a client-generated UUID persisted locally and a server `(device, session, operation_id)` journal entry. Lifecycle:

`LOCAL_DRAFT → STAGED → RESERVED → DISPATCHING → ACCEPTED / REJECTED / UNKNOWN → OBSERVED_IN_HISTORY` (observed may follow accepted; rejected/unknown are not equivalent). `OperationAccepted` means authoritative JCode evidence, not socket write. Missing `MessageAccepted` correlation is `UNKNOWN` unless a definitive per-request observation exists. Do not automatically resend an uncertain operation. Reservation must be durable and deduplicated *before* dispatch.

**Upstream stop:** existing SDK `cancel(session_id)` is not atomic relative to a specific turn. Require `expected_turn_id` server-side CAS for trustworthy “Stop this turn”; until then, gate/label session-wide cancellation with a clear confirmation (and never attach it to the wrong session).

**Snapshots and streaming:** `session.snapshot` has `epoch`, `revision`, `last_seq`, `authoritative_at`, `view` and `stale` fields. Events carry `epoch`, `seq`, `session_id`, `kind`, and source provenance. Client applies only consecutive seq for its current epoch. Gap, reconnect, queue overflow or partial output triggers `needs_reconcile` and a fresh snapshot before marking stream current. `TextReplace` must replace prior text (even after a `TextDone`) and survive historical merge without duplication. UI can batch painting at ≤20 commits/s but may not drop semantic `TextReplace`, `TurnDone` or tool states.

**Session identity:** distinguish JCode `session_id`, client `operation_id`, optional upstream `message_id` (connection-local stream correlator), adapter `epoch:seq`, and history message index or revision. They are not interchangeable.

**History:** implement bounded `sessions.history_page`, `sessions.full_message_chunk`; define exact byte offsets, text encoding, revision and `done`. Until JCode supports bounded history natively, enforce memory caps and report partial snapshots. No success from incomplete chunks.

**Context and plan:** `model/context/plan` snapshots carry `source`, `observed_at`, `freshness`, and optional value. Missing plan is not `0 / 0`; missing context is not `0 tokens`. No percentage fabricated from tool events.

**Auth:** TLS for network exposure or verified private tunnel with explicit trust policy. Never place bearer credentials in routine logs, deep link history, exportable URLs or source-controlled files. Store device credentials in Android Keystore / iOS Keychain / desktop OS secret store. Pairing code expires, revocation works immediately for existing streams, and a cancelled pairing attempt cannot rebind when a late request completes.

## 4 — Mapping to the v12 physical-motion behavior

**Streaming preview** in v12 is a local demo that creates assistant DOM nodes, schedules synthetic text on `requestAnimationFrame`, and keeps scroll position under user control. Production should:

1. Persist draft on device before issuing any network request.
2. Emit a verified `operation_state` when the adapter journals it, and an `accepted` state only when daemon evidence exists.
3. Expose `session_status` / `connection_phase`, user-facing display text and observation timestamps. The client may animate between observed phases; it cannot invent work progress.
4. Buffer semantic stream events in the client reducer; render at ≤20 commits/s when the screen is visible, pause rendering when backgrounded, but keep server execution independent.
5. When reopened or switching between v9 desktop panes, obtain a snapshot and restart subscriptions. Never `cancel`/`detach` due to navigation unless the user explicitly disconnects that *view*; such detach must not stop the agent.

**Desktop three-pane shell:** sidebar, central session, inspector are three projections of one shared authoritative store; do not create three independent JCode attachments that race to select different sessions. Coalesce watcher interests, use `peek_session` for non-focused threads, and isolate inspector operations by `{server_id, session_id, attachment_epoch}`. The current project and active session IDs are distinct.

**Mobile gestures and keyboard:** swipe velocity projection, viewport resizing, reduced motion, visual `Jump to latest`, and glass animation are exclusively client code. No dedicated gesture/WebSocket/animation endpoints.

## 5 — Upstream compatibility and required changes

Current pinned JCode (fork `command-code-native-provider` / `0abff12c7`, based on preview.394 / `eb867111`):
- `jcode-sdk` Rust client and `jcode-harness-api` v1.11 provide sessions, models, plans, file status/read/search, live event streams, and SSH transport.
- `SendMessage` has no `client_operation_id`; `MessageAccepted` carries just `session_id`. `JcodeClient::send_message` can return `Ok` without observing an acceptance if its wait times out. No durable exactly-once guarantee.
- `Cancel` is session-scoped, not `expected_turn_id` guarded.
- `GetHistory` fetches entire history; `PeekSession` fetches a small tail. No general safe `ListDirectory`/`CreateDirectory` API confirmed in curated SDK. Adapter filesystem service is needed for the Stillness browser.
- Existing JCode gateway transports internal daemon protocol. The adapter must use the curated SDK/harness API, not treat its WebSocket frames as SDK frames. Official device pairing exists but authorized registry reuse must be verified, not assumed.

Contribute *small upstream PRs* for per-operation message receipt/ingestion dedup, turn-targeted cancel precondition, history pagination, and signed or versioned event identity where appropriate. Build fallbacks that accurately express degraded guarantees until those are merged. Do not patch unrelated JCode provider code.

## 6 — Implementation PR slices and release gates

| Slice | Deliverable | Required proof |
|---|---|---|
| PR-0: Contract | v12 design coverage map, versioned API schema, fixtures, capability matrix | All 19 screens classified; mock-only operations explicit; schema validates examples. |
| PR-1: JCode link | Rust SDK pinned to exact SHA; isolated local harness connection | Compile/test handshake; create/attach, read-only list and context; no raw-daemon translator. |
| PR-2: Auth + operations | Secure pairing integration and operation WAL | Unknown ack never promoted to Accepted; crash/restart replay suppression tests. |
| PR-3: Streaming | Session fanout, snapshot reconciliation, versioned projections | 1M semantic stream events, gaps, retries, TextReplace rollback, no duplicate final messages; memory bounded. |
| PR-4: Projects + browser | Server roots, canonical projects, list/preview/search, authorized folder create | Traversal/symlink/race/secret-in-hidden-folder tests; no writes outside roots. |
| PR-5: UI binding | Replace v12 demo functions with Tauri typed calls; retain motion | iOS/Android keyboard, background/foreground, scrolling, gesture, VoiceOver/TalkBack gates. |
| PR-6: Rollout | v1 coexistence, explicit migration, staged opt-in, rollback | Android/iOS E2E, no unconfirmed resends, safe cancellation, cold reconnect, 30-minute live task monitoring. |

**Acceptance thresholds (engineering targets, not measurements):** zero lost or duplicated accepted user messages in controlled fault-injection suite; zero silent stream gaps; zero unauthorized filesystem traversal; zero claims of task completion from UI timers; bounded heap under a slow subscriber; recover from process restart without replaying unknown dispatch; stop an intended turn only with required upstream identity or explicit fallback confirmation.

## 7 — Concrete next work

1. Land PR-0 independently with this v12 contract. Do **not** merge open PR #45 just to unblock the new architecture; review its overlapping fixes separately.
2. Implement the smallest Rust link using the **pinned fork SDK** before selecting Tauri for production; run tests on a real fork-built JCode daemon from the exact same SHA in an isolated test home.
3. Implement secure directory traversal and durable operation journal; do not wire simulated HTML handlers to real filesystem mutation without that layer.
4. Create Stillness v12 typed client bindings and retain v1 React Native release as rollback until Android and iOS native E2E pass.

**Scope statement:** This document updates the Adapter v2 design to Stillness 12. It intentionally does not imply that the runtime has been rewritten, that JCode has adopted the upstream API extensions, or that Android/iOS/Tauri builds have passed.
## 13 — Mandatory native Command Code provider integration (2026-11-11)

**Requirement / baseline correction.** Stillness 0.3.0 must support Command Code as a **built-in, first-class JCode provider**, not as a manually configured OpenAI-compatible endpoint. The selected JCode source is the user's fork [`ddawnlll/jcode@command-code-native-provider`](https://github.com/ddawnlll/jcode/tree/command-code-native-provider), pinned to commit `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8`. This is exactly **19 commits ahead, 0 behind** upstream preview.394 at `eb867111fffac2efeedd95a7ac9f7d6168260e6f`. It is **not merged** upstream: [draft PR #2132](https://github.com/1jehuang/jcode/pull/2132), related to [PR #1271](https://github.com/1jehuang/jcode/pull/1271).

### 13.1 Boundary

```text
Stillness 12 (mobile/desktop)
   -> Rust Adapter v2 mobile protocol (auth, session state, operation journal)
   -> JCode fork's jcode-sdk / jcode-harness-api (same pinned commit)
   -> JCode fork daemon with native provider id command-code
   -> Command Code documented Provider API
```

The adapter **never** holds, proxies, forwards or logs Command Code API keys. JCode owns provider credentials, authentication, account routing, model catalogs, generation and tools. Pairing tokens are a separate adapter/device security domain. Model and provider selection **must** use the authoritative `ListModels` and `GetRuntimeInfo` SDK responses. Do not treat a Command Code static catalog or default model as an entitlement guarantee.

### 13.2 Implementation facts, scope and caveats

- Native user-facing provider id: `command-code`. The fork implements it using JCode's existing OpenAI-compatible provider framework **internally** (not a new `ActiveProvider` variant), plus native login/catalog, endpoint selection and session affinity. This is compatible with the requirement for a built-in provider: the end user must not configure custom URLs or generic profiles.
- Supported documented generation endpoints in the fork: `/provider/v1/chat/completions`, `/responses`, and `/messages`; Muse routes to Responses, Claude-family models to Messages, and others generally to Chat pending per-family verification. Never use the undocumented CLI `/alpha/generate` protocol.
- Server setup: JCode CLI `jcode login --provider command-code --account work` (with an API key supplied via a secure path) and a server-side provider-doctor check. Browser-assisted login is **not implemented**; do not promise it in the mobile UI.
- Labeled API-key accounts and stored session identity `openai-compatible:command-code@<label>` are preserved across session resume, fork and daemon restart; removed accounts fail closed. There is no proven automatic cross-account failover or mobile-side account switcher. **Never silently rebind the session to an active account.**
- Quota/remaining credits are **unknown** without a documented quota API. Token/cache observations may be shown when present with timestamps. Catalog inclusion does not prove plan access; `MODEL_NOT_IN_PLAN` must be a clear error.
- The branch's evidence reports passing provider mock and live integration checks, including tool-result continuation and account affinity, but also documents unresolved external entitlements and unrelated suite failures. Those are **repository-reported tests, not independently rerun by this RFC**.

### 13.3 Stillness 12 UI requirements

1. **Model sheet:** show a provider section `Command Code` only when advertised by the authenticated JCode daemon; list real `ModelRouteInfo` choices and effective session identity; never invent model availability or account quota.
2. **Session header:** display verified provider, exact route/model and account label when exposed. If absent, display `Unknown` rather than guessing based on the last selected UI option.
3. **Account missing / plan denied:** surface a typed error with instructions to configure the server-side account; do not show `sent` or silently retry on another provider.
4. **Session restore/fork:** preserve the existing JCode provider-route/account affinity and refresh it from `GetRuntimeInfo` after reconnect.
5. **Pairing / Settings:** device pairing is **not** Command Code login; do not ask for the provider API key on the phone. The secure key remains on the JCode server.
6. **Streaming:** handle reasoning, text deltas, replacements, tools, tool results, terminal errors and cancellation unchanged through official harness event shapes. An adapter receipt is **not** proof of successful model generation.

### 13.4 Pinning and compatibility gates

- For the adapter's `Cargo.toml`, use `jcode-sdk = { git = "https://github.com/ddawnlll/jcode", rev = "0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8" }` and matching `jcode-harness-api` if directly imported; commit the reproducible `Cargo.lock`. Never follow a moving branch in production.
- Build and start the JCode daemon from the **same fork commit**; don't mix the fork SDK with unmodified upstream preview.394 without an explicit compatibility test.
- Contract tests: handshake API 1.11; provider list and model catalog; `GetRuntimeInfo` route/account identity; regular Chat turn plus tool-result continuation; Muse Responses turn; state after reconnect/fork/restart; explicit 401/403/429 failures; cancelled tool call; stale/missing account fail-closed; no API keys in mobile data, SQLite, traces, or crash reports.
- Require physical-device smoke for Stillness model picker, stream rendering, interrupted connection, operation receipts and post-resume model identity before calling v0.3.0 production ready.
- On eventual upstream merge, re-pin to a **verified upstream commit/tag** only after the same contract suite passes; do not auto-upgrade to a new preview.

**References:** [fork provider documentation](https://github.com/ddawnlll/jcode/blob/command-code-native-provider/docs/COMMAND_CODE_PROVIDER.md) · [implementation/status evidence](https://github.com/ddawnlll/jcode/blob/command-code-native-provider/COMMAND_CODE_IMPLEMENTATION_STATUS.md) · [upstream PR #2132](https://github.com/1jehuang/jcode/pull/2132).
