# Ziran 0.7.4 — Wu wei

Ziran `0.7.4` (`versionCode 74`) focuses on end-to-end reliability, agent-agnostic polish, structured tool presentation, full output pagination, Android inset/modal fixes, and **in-app GitHub auto-updating** so future releases install directly from inside Ziran without returning to GitHub.

## New: In-App Auto-Updater & Version Control

- **GitHub Releases JSON API (`UpdateManager.kt`):** Checks `https://api.github.com/repos/ddawnlll/ziran/releases/latest` automatically (throttled) and on demand in **Settings → Updates**.
- **Semantic version comparison** against `BuildConfig.VERSION_NAME`, preferring the signed R8 release APK (`ziran-*-android-release.apk`).
- **Integrity-verified direct install:** Downloads with live progress into `cacheDir/updates/`, verifies the published `.sha256` checksum when present, and hands off to Android's package installer via `FileProvider` (with graceful `ACTION_MANAGE_UNKNOWN_APP_SOURCES` guidance on first install).
- **Home banner & Settings row:** Dismissible Home update banner when a newer release is available, plus manual **Check for updates** and **Download & install** in Settings.

## Fixes (Closing `#115`–`#124`)

- **`#115` Structured tool summaries:** Collapsed tool rows render human-readable summaries for `todo`, `write`, `edit`, `read`, `bash`/shell, search, and generic key/value fallbacks for unknown tools — zero raw JSON in collapsed rows (`ToolPresentation.kt`).
- **`#124` Complete tool output pagination & copying:** Replaced the 16-line hard truncation in `ToolDetailPanel` with bounded initial previews, explicit line/byte counts, **Load more** / **Show all** pagination, optional raw JSON toggle, **Copy full** clipboard action, and explicit server-truncation labeling.
- **`#116` & `#117` Android `WindowInsets` & Turn notices modal:** Replaced the unpadded bottom bar with a dimmed modal sheet respecting `navigationBarsPadding()`, ≥48 dp `Not now` / `Allow` touch targets, and hiding the `+` FAB while visible.
- **`#118` Honest Home connection states:** Distinguishes connecting, reconnecting, loading, confirmed empty, and offline states; preserves last saved threads with an explicit stale notice and a **Reconnect** action instead of reporting false zeros while offline.
- **`#119` Durable queued message handoff & bounded retries:** Peeks before staging, assigns stable operation IDs, serializes per-session dispatch, stops auto-retry loops on permanent rejection, applies bounded exponential backoff on transient failures, and preserves unrelated composer drafts.
- **`#120` Adapter lifecycle & concurrent session isolation:** Gives each adapter connection a cancellable child `SupervisorJob` and monotonic generation guard; fences async session/rename/model/send callbacks by `(serverId, sessionId, generation)` and syncs `_composerText` cleanly on session switch.
- **`#121` Explicit API outcomes & input preservation:** New-thread creation retains title and sheet on failure with stable `clientRequestId` retry deduplication; model/provider/effort selection shows pending state and actionable errors instead of silent no-ops.
- **`#122` Multi-thread background notifications:** Evaluates approval, completion, and failure notifications ahead of the active-session UI filter, deduplicates replayed events by `(serverId, sessionId, eventKey)`, uses privacy-safe lock-screen copy, and deep-links to the exact server + session (`ziran://session/<id>?server=<serverId>`).
- **`#123` Agent-agnostic UI:** Removes hardcoded `jcode connected` / `jcode not running` strings across Home and Start screens in favor of backend metadata (`Pu ready`, `JCode ready`, or neutral `agent ready`) while preserving legacy adapter compatibility.

## Verification

- `cd apps/android && ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleRelease` — **PASS** (0 lint errors, R8 + ART profile + `lintVitalRelease` pass, including `V074ReliabilityAndUpdateTest`).
- `cd adapter-v5 && go vet ./... && go test -race ./...` — **PASS**.
- **Android API 35 Emulator E2E (`emulator-5554`):** Verified pairing, `Turn notices` modal & insets, agent-agnostic `Pu ready` Home & sub-agent tree (`crane`, `fox`), opening sub-agent threads, creating new threads, switching provider/model/effort (`OpenAI / gpt-5.2-codex` → `Google / gemini-2.5-pro`, `medium` → `high`), sending messages, live GitHub update check (`up to date`), and final R8 release APK launch with zero crashes.

## APKs

Both APKs are debug-signed for direct sideloading (`dev.ziran.android`, `versionCode 74`, `versionName 0.7.4`, v2 + v3 signatures, zipaligned):

```text
ziran-0.7.4-android-release.apk (R8-optimized, recommended)
3.3 MB
SHA-256 faf0008f887bdb06b852a3e4233815987ac2567e6f6c9dcbc428e5e846f43853

ziran-0.7.4-android-debug.apk (debug build)
16 MB
SHA-256 e39745589e1de315594ff3ceaa56d110d6fcec291555e6c8675ae44fc2a3df66
```
