# Ziran 0.7.3 — Wu wei

Ziran `0.7.3` (`versionCode 73`) delivers a fast, R8-optimized Android release APK (**3.3 MB**), a native Wu wei markdown renderer, 200+ thread scroll optimizations, live steering, Home/Settings/Model/Threads upgrades, and an independent, agent-agnostic **Adapter v5** in Go supporting **Pu** and **JCode** as equal backends.

## Fixes

- **Status bar and camera cutout insets (Galaxy A34):** Content, corner controls, bottom navigation, and the composer respect `WindowInsets.safeDrawing`, `WindowInsets.navigationBars`, and `WindowInsets.ime`. Paintings extend behind the status bar while status bar icon polarity adapts to top-band luminance.
- **Sending a message after the agent responds:** Cleared `accepted` and `observed_in_history` pending send state on `turn_done`, `turn_stopped`, and idle snapshots (`SendAfterTurnDoneTest`).

## New in Ziran Android (`apps/android/`)

- **Native Wu wei Markdown Renderer (`WuMarkdown.kt`):** Single-pass block & inline parser with a 256-entry LRU cache + background `Dispatchers.Default` pre-warming, Wu wei palette syntax highlighting, one-tap code copy, clickable links, tables, lists, blockquotes, streaming-safe unclosed fences, and `LazyColumn` block flattening for history and live streaming answers.
- **Fast Wu wei Performance & 200+ Thread Scrolling:**
  - Enabled **R8 minification, resource shrinking, and ART profile compilation** (`app-release.apk` shrunk from 16 MB debug to **3.3 MB** release).
  - Eliminated per-frame recompositions in `Painting` (Ken Burns in `graphicsLayer`), `ScreenTransition` (`progressProvider` in draw/layer phase), `HomeFlowHairline`, and 1s elapsed timers (`LiveElapsedText`, `ToolElapsedText`).
  - Replaced `composed {}` in `Modifier.wuClickable` with `WuPressIndication` (`IndicationNodeFactory` + `LayoutModifierNode`) — zero `Animatable`s, `LaunchedEffect`s, or GPU layers while flinging 200+ threads.
  - Flattened `Seal` (`Spacer` + `drawWithCache` + cached rough paths), flattened leaf thread rows, removed per-row dimmed `graphicsLayer`s, isolated `composerText` into its own `StateFlow` (zero root recompositions while typing), marked models `@Immutable`, and added `LazyColumn` `contentType` recycling.
- **Live steering (`Steer`):** `steer now`, `stop, then send`, `after this turn` mode chip & bottom sheet, `expected_turn_id`, and `pending_soft_interrupts`.
- **Home, Settings, Threads search/sort/sub-agents, and reworked Model screen.**

## New: Independent Agent-Agnostic Adapter v5 (`adapter-v5/`)

- Standalone Go binary (**8.1 MB** static `CGO_ENABLED=0`, 2 direct deps: `quic-go`, `coder/websocket`).
- **QUIC over UDP** (ALPN `ziran-v5`, independent reliable streams, 0-RTT resumption, transparent gzip framing >2 KiB) + **WebSocket fallback** (`ziran.v5` & `jcode.mobile.v4`).
- **Equal Pu & JCode backends** via zero-dependency `agentsdk` (`agent.v1`) + capability negotiation + stdio NDJSON bridge. Pu core stays free of gateway networking deps; JCode preserves `continue_on_disconnect: true`, steering, permissions, and models.
- Durable `O(1)` event journal & replay, `O(1)` `ReadAt` indexed `history.page` / `history.viewport`, `sessions.delta` / `sessions.page`, persistent reading positions, bounded queues, `(mtime, size)`-cached metadata updater, and privacy-safe push notifications.
- Measured vs v4: `2.31 MiB` HeapAlloc, QUIC `history.page` `p50=0.51 ms` / `p99=0.86 ms`, `−97.4%` history wire bytes, `−99.9%` idle session delta bytes, `3.16 ms` QUIC 0-RTT reconnect + 500-event replay ([benchmarks](ADAPTER_V5_BENCHMARKS.md)).

## Verification

- `./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lintDebug` — **PASS** (0 lint errors, R8 + ART profile + `lintVitalRelease` pass, `WuMarkdownTest` 250-message & 250-thread benchmarks pass).
- `cd adapter-v5 && go vet ./... && go test -race ./...` — **PASS** (all 6 suites green with `-race`).
- Red-accent grep (`A8322B|C5483C|A33B2A|Color.Red|F4EBD6`) across `apps/android/app/src/` — **0 matches**.

## APKs

Both APKs are debug-signed for direct sideloading (`dev.ziran.android`, `versionCode 73`, `versionName 0.7.3`):

```text
ziran-0.7.3-android-release.apk (R8-optimized, recommended)
3.3 MB
SHA-256 546bd746d1b243255f07b2b2aebf3ccfac6aaa7c19347bebad5c22a65441ef3f

ziran-0.7.3-android-debug.apk (debug build)
16 MB
SHA-256 3eb8fe313bbb70b74703f33c56cf708550acd169a9535ece6351f5425af9e842
```
