# Adapter v5 Measurements (vs v4 Baseline)

Measured on macOS arm64 (`go1.26.4`, uninstrumented `go test -v -count=1 -run TestMeasureV5VsV4 .`) with **250 sessions**, a **1,000-message transcript (~621 KB)**, and **2,000 durable journaled events**.

| Metric | v4 Baseline (Full Snapshot) | Adapter v5 (Go) | Delta |
| --- | --- | --- | --- |
| Static binary (`CGO_ENABLED=0 -ldflags="-s -w"`) | Rust + SQLite binary | **8.1 MB** | 2 direct Go deps (`quic-go`, `coder/websocket`) |
| Heap memory (`HeapAlloc` / `HeapSys`) | Holds full transcripts in RAM on snapshot | **2.58 MiB** / 11.34 MiB | Bounded `O(1)` offset indices |
| History RPC latency (`history.page`, 1,000-msg thread) | Full-transcript read | **QUIC p50 0.59 ms / p99 0.94 ms** · **WS p50 0.49 ms / p99 0.87 ms** | Sub-millisecond `O(1)` seek |
| Wire bytes — 1,000-msg thread | 621,281 B | **16,042 B** (`history.page(25)`) · **115,947 B** (`history.viewport(12+4)`) | **−97.4%** / **−81.3%** |
| Wire bytes — 250 sessions | 40,417 B | **4,130 B** (`sessions.page(25)`) · **54 B** (`sessions.delta` idle) | **−89.8%** / **−99.9%** |
| Disconnect → QUIC reconnect + 500-event durable replay | Full snapshot reconcile | **4.65 ms** (91,573 B) | Zero lost events, crash-safe tail trim |

## Verification
- `cd adapter-v5 && go vet ./... && go test -v -race ./...` — **PASS** (all 6 test suites green with `-race`, including QUIC multi-stream, WebSocket fallback, crash-safe journal replay + gap detection, bounded queues, privacy-safe push, Pu backend driver, JCode Unix-socket driver with `continue_on_disconnect: true`, and v5 vs v4 measurements).
- Live LLM API turn execution against remote inference providers — **NOT_RUN** (no API key configured; Pu and JCode drivers verified against real filesystem/socket protocols and binary invocation).
