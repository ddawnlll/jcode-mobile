# JCode Mobile 0.5.0 — Feather and Arrow

Release date: 2026-11-15
Protocol: Adapter v4 (negotiates v2, v3, v4)
Android package: `dev.jcode.stillness`, versionCode 5000

## What changed

### Adapter v4

- Bounded per-session native JCode links. Each open or dispatched session owns
  its commands and event stream, with a pool of up to 32 connections.
- Exact model route selection: model, provider, and API method are sent
  together and applied through JCode's correlated `set_route` reply.
- Runtime and swarm updates are live notifications. Opening a child enters its
  own JCode session; reconnect reconciles membership and model identity from a
  live snapshot.
- Ready text and tool deltas are coalesced before durable sequence assignment.
  Contiguous deltas for one message or tool call share a journal event, capped
  at 16 KiB.
- Large v4 payloads use a JSON `transport.bytes` descriptor followed by binary
  WebSocket frames of up to 64 KiB, up to 64 MiB. The client assembles the
  declared byte count before decoding JSON. Versions 2 and 3 keep text frames.
- The adapter watches JCode's persisted session directory, so an effort change
  made from another JCode client refreshes the attached session.
- The v4 binary name is preferred. `jcode-adapter-v3` and `jcode-adapter-v2`
  remain service aliases for the current implementation and run the same
  versioned server.

### Stillness 12

- Stream updates are applied once per animation frame.
- Reasoning, tool starts, tool input, tool execution, tool results, and
  assistant text render in observed order.
- Markdown is deferred until a completed message needs it. The opening
  JavaScript bundle is **121.50 kB gzip** instead of **166.37 kB gzip**, a
  **27%** reduction.
- Long messages, reasoning, and tool output are paged with `PagedText`. Copy
  controls retain the full source content.
- The model picker sends the advertised model, provider, and API method. The
  effort slider displays the runtime's returned value.
- The newest 32 timeline entries render first. Earlier entries page in on
  demand.

## Verification

| Check | Result |
| --- | --- |
| Rust workspace tests | PASS, 75 tests (29 core, 10 protocol, 19 server lib, 17 integration) |
| Rust formatting and clippy | PASS, `cargo fmt --check` and `cargo clippy -D warnings` |
| Legacy JavaScript tests | PASS, 14 suites / 139 tests |
| Stillness UX checks | PASS, 15/15 |
| TypeScript and ESLint | PASS |
| Stillness production build | PASS |
| Initial JavaScript | 512,019 B raw / 165,790 B gzip to 412,578 B raw / 120,967 B gzip |
| WebSocket stream coalescing | 12,009 frames / 6,595,348 B to 745 frames / 780,810 B on the same 384,000-byte response (median of 3) |
| Large payload transport | 200,514 B in one descriptor plus four binary frames; client reassembled valid JSON and UTF-8 across a 64 KiB code-point boundary |
| Full stack with pinned JCode | PASS, isolated daemon + harness bridge + native link + Adapter v3/v4, deterministic Responses provider |
| Pairing and session browser e2e | PASS against Adapter v4 after the version assertion update |
| Android release APK | PASS, versionCode 5000, versionName 0.5.0, v2 + v3 signatures |
| Real provider/model turn | NOT_RUN for 0.5.0 |
| Android on-device install, real turn, frame pacing | NOT_RUN for 0.5.0 |

The full benchmark report and raw data are in
`docs/evidence/v0.5.0/benchmark/REPORT.md` in this repository. The fixture
provider is deterministic and makes no network calls; it is not a model.

## Install

- APK: `artifacts/jcode-mobile-0.5.0-android-release.apk`, 12,718,529 bytes
  (12.1 MiB), SHA-256
  `d1f5662fca569e3a0bba725b862ae7cc27c121af1861562bb821cd0c3a98f227`,
  with the adjacent `.sha256`. The APK is debug-signed with the same
  `android/app/debug.keystore` as 0.4.0, so it updates in place and keeps the
  device token.
- Adapter: run `jcode-adapter-v4` with the same data directory. The v3 and v2
  binary names still work. Existing devices stay paired.
- Migration, rollback, and the v4 contract: `docs/ADAPTER_V4.md`.

## Known limitations

- A real model/provider turn was not re-run for 0.5.0. The adapter, daemon,
  native link, transport, and UI were exercised with a deterministic fixture.
- Android on-device installation, a real turn, frame pacing, battery, and
  native cold start are `NOT_RUN` for 0.5.0. The APK's identity and signatures
  are verified.
- `sessions.delete` is not available: the daemon has no delete operation.
  Archive is the supported alternative.
- FCM delivery still requires `JCODE_FCM_PROJECT_ID` and a refreshed
  `JCODE_FCM_ACCESS_TOKEN`. Without them push is `not_configured`.
- The adapter journal uses bounded retention. Authoritative history still comes
  from the daemon.
- Browser e2e is not native Android verification.
