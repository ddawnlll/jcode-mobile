# Ziran 0.7.3

## Fixes

- **Status bar and camera cutout insets (Galaxy A34):** Content, corner controls, bottom navigation, and the composer now respect `WindowInsets.safeDrawing`, `WindowInsets.navigationBars`, and `WindowInsets.ime`. Paintings extend behind the status bar while status bar icon polarity adapts to the painting's top-band luminance.
- **Sending a message after the agent responds:** Cleared `accepted` and `observed_in_history` pending send state on `turn_done`, `turn_stopped`, and idle snapshots so the composer stays usable across consecutive turns without blocking on stale turn state. Added a 3-cycle regression test (`SendAfterTurnDoneTest`).

## New

- **Live steering while an agent works (`Steer`):**
  - Mode chip above the composer (`steer now`, `stop, then send`, `after this turn`) with a bottom sheet to switch modes and a one-tap `stop` pill.
  - `Steer now` reserves with `expected_turn_id` and displays `pending_soft_interrupts`.
  - `Stop, then send` cancels the active turn, waits for `turn_stopped`, and then sends.
  - `After this turn` queues the message per session in DataStore and sends after `turn_done`.
  - Timeline rows show whether a message was sent as `steering`, `sent after stop`, or `waits for the turn`.
- **Home tab and bottom navigation (`home · threads · settings`):**
  - Server name and live status, inline `waiting for you` permission cards (`Allow once` / `Deny`), `at work` threads with live elapsed time and nested sub-agents, `recent` threads, and a floating `+` new-thread seal.
- **Settings tab:**
  - Manage paired servers (pair another, forget), appearance (`Day` / `Night` / `Follow phone`, `Scene`), default model for new threads, `while an agent works` default (`Steer` / `Wait` / `Ask`), local notification toggles (`Waiting for you`, `Work finished`, `Only when Ziran is closed`) wired to `LocalNotifications`, and app/adapter version info. All settings persist in DataStore.
- **Threads search, sort, and sub-agents:**
  - Instant search across titles, agent names, and sub-agents; persisted sort (`recent` / `name` / `status`); sub-agents grouped under their parent thread with a foldable toggle that auto-expands on search match.
- **Reworked Model screen:**
  - Switch between `this thread` and `new threads`, view the current model card with effort dots, search models, sort by `provider` / `name` / `available`, and see unavailable routes dimmed.

## Verification

- `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug` — **PASS** (101 JVM tests, 0 lint errors).
- Visual & motion evidence in `docs/evidence/v0.7.3/` (Day/Night comparisons, Galaxy A34 tall/punch-hole/3-button/landscape matrix, `send_loop.mp4`).
- Red-accent grep (`A8322B|C5483C|A33B2A|Color.Red|F4EBD6`) across `apps/android/app/src/` — **0 matches**.
- Debug APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk` (16 MB, SHA-256 `6c9b619d9ea9f95b16c954873fd750f2d74035076e1a9a6321445adff53cdcd0`).
- Signed release APK: **NOT_RUN** (no `signingConfigs` / release keystore configured in `apps/android/app/build.gradle.kts`).
- Live staging daemon mid-turn soft-interrupt test: **NOT_RUN** (verified protocol framing and state transitions via unit tests and local mock adapter).
