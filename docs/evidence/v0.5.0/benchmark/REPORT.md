# JCode Mobile 0.5.0 vs 0.4.0 benchmark

Date: 2026-11-15
Host: macOS 26 (aarch64), Bun 1.4.4, Rust pinned JCode `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8`
PR: https://github.com/ddawnlll/jcode-mobile/pull/79
Baseline: `main` at the 0.4.0 release (`v0.4.0`, 547c2e6)
Candidate: `release/0.5.0-feather-and-arrow` (172ead7)

## Verdict

The candidate is working. The headline startup-bundle claim reproduces
exactly, the 75 Rust tests and 139 JavaScript tests pass, and the two Adapter
v4 performance claims are measurable on a real JCode daemon:

- Stream coalescing removes 93.8% of WebSocket event frames and 88.2% of
  WebSocket text bytes for the same 384,000-byte assistant response, with no
  measurable latency cost.
- Large payloads are packaged as one `transport.bytes` descriptor plus 64 KiB
  binary frames. A 200,000-byte multibyte payload reassembled to valid JSON and
  valid UTF-8 on the client.
- The full stack, including the real pinned JCode daemon and web UI, works for
  both v3 and v4. The pairing and session/draft/plan UI specs pass against the
  v4 adapter after updating one stale version assertion.

One release-candidate defect was found: the Stillness pairing e2e still
asserts `Adapter 0.4.0`. It fails against 0.5.0 even though the UI is correct
and the rest of the test passes. CI does not run that spec today.

The startup win is not a total-byte win. After a message needs Markdown, the
deferred chunk makes the total JavaScript about 0.8% larger than 0.4.0. The
27% reduction applies to the opening bundle, which is what the PR claims.

## Method

Both revisions were built and tested from isolated Git worktrees:

```text
/Users/hootie/.jcode/scratch/bench/old    # v0.4.0
/Users/hootie/.jcode/scratch/bench/new    # PR head 172ead7
```

`apps/stillness/node_modules` was shared because the PR changes no Stillness
dependency. Rust used separate target directories; the same Bun, Node, Vite,
TypeScript, and Rust toolchains were used for both sides.

Builds alternated revisions for four rounds to spread thermal and load bias.
The streaming benchmark used the real pinned JCode binary on an isolated
`JCODE_HOME`/socket, plus a deterministic local OpenAI Responses-compatible
provider. The provider is not a real model and never contacts a provider.
It streams a fixed script so both adapters see identical bytes.

All scratch scripts are in `scripts/`. Raw logs and metric JSON are in `data/`.
The scripts contain the benchmark host's absolute paths and the isolated
worktree locations; adjust them before running on another machine.

## Bundle size

Stillness production build (`tsc --noEmit && vite build`), same dependencies
and Vite settings. Four alternating builds produced byte-identical output each
round.

| Metric | 0.4.0 | 0.5.0 | Delta |
| --- | ---: | ---: | ---: |
| Initial JS, raw | 512,019 B | 412,578 B | -19.42% |
| Initial JS, gzip -9 | 165,790 B | 120,967 B | **-27.03%** |
| Initial JS, Brotli | 139,667 B | 103,690 B | -25.76% |
| Initial JS, Vite reported gzip | 166.37 kB | 121.50 kB | -26.97% |
| Initial CSS, raw | 57,583 B | 58,627 B | +1.81% |
| Initial CSS, gzip -9 | 11,445 B | 11,724 B | +2.44% |
| Deferred Markdown, raw | in initial JS | 105,784 B | n/a |
| Deferred Markdown, gzip | in initial JS | 46,183 B | n/a |
| Deferred Markdown, Brotli | in initial JS | 38,207 B | n/a |
| Total JS after Markdown, gzip | 165,790 B | 167,150 B | +0.82% |
| Build wall time, median of 4 | 2.05 s | 2.08 s | +1.5% |
| Vite build time, median of 4 | 583 ms | 592.5 ms | +1.6% |

The PR's exact claim (166.37 kB to 121.50 kB gzip) is reproduced. The deferred
Markdown chunk is not referenced by `dist/index.html`; it loads only when a
completed message needs Markdown. The opening payload is smaller; the eventual
total is slightly larger.

## Tests and static checks

| Check | 0.4.0 | 0.5.0 |
| --- | --- | --- |
| Rust workspace tests | 72 passed, 0 failed | **75 passed, 0 failed** |
| Rust `clippy -D warnings` | pass | pass |
| Rust `fmt --check` | pass | pass |
| Jest | 139/139 | 139/139 |
| Stillness UX contract checks | 14/14 | **15/15** |
| TypeScript `tsc --noEmit` | pass | pass |
| ESLint | pass | pass |
| Stillness production build | pass | pass |

Rust test counts and pass state match the PR body. The new suite has three
additional tests and the same 17 operation-flow tests. Test execution time is
not directly comparable because the candidate has more tests and a heavier
operation-flow binary; compile-cache state also differed.

## Streaming A/B: 12,000 deltas, 384,000 bytes

Setup: 12,000 text deltas of 32 bytes, delivered in 200-delta bursts every
20 ms (60 bursts, about 1.2 s of provider time), 3 rounds per adapter. The
client measures raw WebSocket frames and payload bytes after pairing,
creating a session, subscribing, and dispatching one message. Prewarm is 3 s so
the v3 adapter's global-event child connection is attached before the send.

| Metric, median of 3 | 0.4.0 | 0.5.0 | Delta |
| --- | ---: | ---: | ---: |
| `session.event` frames | 12,009 | 745 | **-93.8% (16.1x fewer)** |
| `text_delta` events | 12,000 | 737 | **-93.9% (16.3x fewer)** |
| WebSocket text bytes | 6,595,348 | 780,810 | **-88.2% (8.4x less)** |
| Dispatch to first delta | 36 ms | 28 ms | -22% |
| First to last delta | 1,245 ms | 1,242 ms | -0.2% |
| Total wall time | 4,342 ms | 4,358 ms | +0.4% |

Per-round frames were 12,009/12,009/12,009 for 0.4.0 and 745/725/781 for 0.5.0.
Text bytes were 6,595,348/6,595,348/6,607,348 and
780,810/773,454/799,315. The coalescing is real and does not add latency: the
first-to-last delta window is unchanged within noise.

## Large payload and UTF-8 boundary

Setup: 1,000 small deltas plus one 200,000-byte delta of the two-byte character
`İ`. Because 64 KiB is not a multiple of 2, the binary framing splits code
points at the boundary. The client concatenates the declared number of bytes
before decoding.

| Metric | 0.4.0 | 0.5.0 |
| --- | ---: | ---: |
| Text frames | 1,019 | 104 |
| Text WebSocket bytes | 765,868 | 92,415 |
| Binary frames | 0 | 4 |
| Binary bytes | 0 | 200,514 |
| Total wire bytes | 765,868 | 292,929 (-61.8%) |
| Largest text frame | 200,518 B | 7,746 B |
| `transport.bytes` descriptors | 0 | 1 |
| Reassembled JSON / UTF-8 | n/a | 1/1, 1/1 |
| Dispatch to first delta | 51 ms | 26 ms |
| First to last delta | 210 ms | 197 ms |

The v4 path sends one small descriptor and four binary frames. The client
reassembled 200,514 bytes to valid JSON with no Unicode replacement
characters. The 0.4.0 path sends the same payload as one 200 KB JSON text
frame.

## End-to-end UI and adapter version

The 0.5.0 web build was served through the v4 adapter on an isolated daemon.

- Pairing e2e with the unchanged spec: **fails** at
  `apps/stillness/e2e/pairing.spec.ts:23`, which asserts
  `/Adapter 0\.4\.0/`.
- The ready screen shows **Adapter 0.5.0**, `Harness
  jcode-harness-api-bridge/0.1.0`, and "JCode harness connected". Pairing and
  the authenticated hello completed; the failure is only the hard-coded
  version string.
- With that one assertion updated to `/Adapter 0\.5\.0/`, the pairing spec
  passes (424 ms), and the session/draft/plan/activity/files/preferences spec
  passes (10.0 s).

CI (`.github/workflows/check.yml`) builds Stillness but does not run
`bun run e2e:stillness`, so the stale assertion is not caught.

## Findings

1. **Fix the stale pairing assertion.** Update
   `apps/stillness/e2e/pairing.spec.ts:23` to the version under test, or read
   `adapter_version` from `/health` and assert that the UI displays it. Add the
   Stillness e2e to CI if it is meant to gate releases.
2. **Keep the startup wording precise.** The 27% win is the opening bundle.
   Once Markdown loads, total JavaScript is about 0.8% larger. The PR body and
   `docs/ADAPTER_V4.md` say "initial JS", which is accurate; do not restate it
   as a total byte reduction.
3. **Version alignment.** Stillness (`0.5.0`), Cargo (`0.5.0`), and the Tauri
   config (`0.5.0`) agree. The root Expo client still says `0.4.0` in
   `package.json` and `0.2.2` in `app.config.ts`; clarify whether that legacy
   client is part of the 0.5.0 release.
4. **Remaining unmeasured items.** This benchmark used a deterministic fake
   provider on macOS. A real model/provider turn and Android on-device frame
   pacing are still outside it. The Unix-socket blocker from the PR body is not
   present on this host: the pinned daemon, harness bridge, native link, and
   both adapters ran end to end.

## Reproduction

```sh
# Build A/B (4 alternating rounds)
bash scripts/run-build-bench.sh

# Streaming A/B (starts isolated daemon, fake provider, v3 and v4 adapters)
bash scripts/stage-start.sh burst 12000 200 20 0
ROUNDS=3 bash scripts/run-ab.sh
bash scripts/stage-stop.sh

# Large payload / UTF-8 boundary
bash scripts/stage-start.sh big 1000 100 20 0 200000
ROUNDS=1 bash scripts/run-ab.sh
bash scripts/stage-stop.sh
```

The stack uses ports 7655 (v3), 7656 (v4), and 7899 (fake provider). It never
touches the production daemon or the live adapter on 7644. The fake provider
reads no request body and is benchmark-only.
