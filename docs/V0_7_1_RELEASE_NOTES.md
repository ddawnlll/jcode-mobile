# Ziran 0.7.1 — Wu wei visual and motion pass

Visual, layout, gesture, and frame-pacing fixes for the native Android client (`apps/android/`, version `0.7.1`, `versionCode 71`), matched side-by-side against `design/wu-wei/` at 1x and 0.25x.

## Visual fixes

- **Painting header crop and fade (`Painting.kt`, `Chrome.kt`)**: Removed the hardcoded `390.dp` width and added `clipToBounds()` so the 34 s Ken Burns drift never shows a hard crop edge; added the 16 s drifting mist strip with cached vertical gradients.
- **Night painting filter (`Painting.kt`, `Tokens.kt`)**: Replaced the black multiply tint with an exact `ColorMatrix` implementing the board's `brightness(0.58) saturate(0.85)`, interpolated smoothly by `nightFactor` during Day/Night transitions.
- **Paper grain (`Painting.kt`)**: Replaced the stretched full-screen image with a pre-scaled 256 dp tiled `BitmapShader(REPEAT)` on isolated `graphicsLayer` nodes that cross-fade with `nightFactor`.
- **Navigation icons (`BackChevron.kt`)**: Replaced the placeholder strokes on `BackChevron` with the board's `<` chevron path, added `ThreadsMenuButton`, and moved corner buttons last in screen `Box` z-order so scrolling content never intercepts taps.
- **Seal geometry (`Seal.kt`)**: Scaled trigram icons to 70% and the send arrow to 62% inside a deterministic slightly rough-edged seal path, resting at `-3°`.
- **Copy and chrome (`Painting.kt`, `MainActivity.kt`, `AppHost.kt`)**: Updated `"butterfly"` to `"butterfly dream"`, synced status/navigation bar icon polarity dynamically with Day/Night theme switches, and anchored `NotificationReasonBar` at the bottom so it never overlaps headers.

## Motion and gesture fixes

- **Single call-site transitions (`NavHost.kt`)**: Rendered all transition layers through one `layers.forEach { key(layer.screen) }` call site so starting or ending a transition never tears down or flashes a visible screen.
- **Ink drop (`NavHost.kt`, `AppHost.kt`)**: Suppressed frame-0 full-frame flash when radius is near zero, added `0.985` scale + `0.35` dim on the leaving screen, and wired Start → Threads pairing to spread from the Pair seal.
- **Unroll and Roll pickers (`NavHost.kt`, `AppHost.kt`)**: Fixed `Unroll` to reveal top-down (800 ms) behind a 6 dp ink rod, and added `NavKind.Roll` (700 ms, `WuEasing.Roll`) rolling Model and Scenes up and away on back.
- **Back slide and predictive back (`NavHost.kt`, `AppHost.kt`)**: Kept the 420 ms back slide with `-22%` beneath parallax and left-edge shadow; wired `PredictiveBackHandler` to shrink to 90%, round corners to 30 dp, shift the beneath screen `-40 dp`, settle back in 320 ms on cancel, and slide out in 300 ms on commit.
- **Live turn timeline (`ThreadScreen.kt`, `LiveReducer.kt`, `AppState.kt`)**:
  - `ThinkingFold`: Added the 3.4 s growing left bar (`drawBehind`), cross-fade in place between rotating grind ring + `"thinking"` and static ring + `"thought for Xs ›"`, and 750 ms collapse on done.
  - `ToolRow`: Matched `Live.dc.html` ink dot (550 ms) → vermilion ring draw (900 ms, 100 ms delay) in place, synced right-side braille spinner/timer entrance with row alpha, added the 1.6 s flowing blue hairline, and unfolded/folded diff and test panels over 750 ms without re-animating already-completed tools.
  - `WordStreamText`: Replaced per-word timers with one `withFrameNanos` `Float` clock read exclusively inside `graphicsLayer` (500 ms ease + 3 dp rise, 55/65 ms stagger, zero per-frame recompositions).
- **Composer, keyboard, and text inputs (`ThreadScreen.kt`, `ThreadsScreen.kt`, `StartScreen.kt`)**: Kept the 210 dp painting fixed while the foreground column rides `WindowInsets.ime.union(WindowInsets.navigationBars)` frame by frame; added local input state guarded by `lastEmitted` so fast IME input does not drop characters; kept queued rows rising in with `n›` + `queued`.
- **Threads gestures (`ThreadsScreen.kt`, `Gestures.kt`, `MotionPrimitives.kt`)**:
  - Replaced `InkRippleHost` stub with a real 650 ms radial ink ripple and added `wuClickable` (180 ms sink, `-3°` seal tilt + `CONTEXT_CLICK` haptic).
  - Guarded swipe-left archive against firing `onOpen`, revealed the `paper2` archive wash over 90 dp, collapsed rows over 450 ms, and raised `UndoBar` for 4.6 s.
  - Added long-press lift (scale `1.025`, 10 dp corners, `LONG_PRESS` haptic) → 420 ms `SheetHost` slide over 380 ms scrim with drag-down and back-button dismiss.
  - Wired pull-to-refresh `PullInkRing` fill, 800 ms spin, and 450 ms settle.
  - Rewrote `wuStamp` and `wuRise` onto single-`Animatable` `tween(delayMillis)` animations so Compose `MotionDurationScale` scales delays and durations consistently at 1x and 0.25x.
- **Scene and theme transitions (`Tokens.kt`, `Painting.kt`, `ScenesScreen.kt`)**: Added `rememberAnimatedPalette()` easing all 10 tokens and `nightFactor` over 600 ms alongside the 1.2 s painting cross-fade.
- **Reduced motion (`Motion.kt`, `NavHost.kt`, `Gestures.kt`)**: Added a live `ContentObserver` on `ANIMATOR_DURATION_SCALE`; when zero, transitions become 120 ms cross-fades via `ReducedFadeScale` while swipe and pull gestures still track the finger 1:1.

## Performance and 120 Hz support

- **Peak refresh rate (`MainActivity.kt`)**: Requests the display's highest refresh-rate mode matching the active physical resolution (`preferredDisplayModeId` / `preferredRefreshRate`) so 90/120/144 Hz phones render at full native frame rate without changing resolution.
- **Zero-recomposition streaming and cached drawing**: Paintings decode once at display width (`BitmapCache`), grain tiles pre-scale once, gradients cache via `drawWithCache`, and `WordStreamText` updates strictly in `graphicsLayer` with a sub-millisecond `Float` frame clock.
- **Measured `gfxinfo` framestats** (Metal GPU-accelerated emulator, `emulator-5554`, 1080x2400): UI thread p50 is `0.5–2.0 ms` (p90 `0.9–4.4 ms`) and RenderThread `IssueDraw` p50 is `0.4–1.8 ms` across Flows 1–8 — within the `8.33 ms` 120 Hz budget. The emulator virtual display exposes only a 60 Hz mode (`60.0 fps`, ~18 ms swapchain wait), so 120 Hz presentation itself is verified by unit tests (`RefreshRateAndMotionTest`) and requires a physical 120 Hz display to observe at 120 fps.

## Native differences from HTML boards

- **Predictive back arrow**: On Android 14+, SystemUI draws its own edge-back pill during `OnBackAnimationCallback`, so the duplicate app-drawn back chip from `Flow.dc.html` is omitted to avoid two stacked chevrons.
- **Long-press sheet action**: `"Open in a new window"` from `Flow.dc.html` is labelled `"Open"` on Android since Android mobile runs a single activity task.
- **Font rasterization**: The bundled `EB Garamond` and `JetBrains Mono` fonts match the boards; slight optical weight differences come from Android FreeType hinting vs macOS CoreText.

## Verification

```text
ziran-0.7.1-android-release.apk
11,624,585 bytes (11.09 MiB)
SHA-256 e1612a7071399c3f116b2718ec18aadd22c68f726d3653b2d9d4b188f4f62f6b
package dev.ziran.android
versionCode 71, versionName 0.7.1
minSdk 26, targetSdk 37, compileSdk 37
APK Signature Scheme v2 and v3, Android Debug certificate
```

```sh
cd apps/android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleRelease
```

- All unit tests pass (90 JVM tests, including 7 new tests in `RefreshRateAndMotionTest`).
- `lintDebug` passes with 0 errors.
- Side-by-side 1x and 0.25x comparison videos and Day/Night screen comparisons are stored in `docs/evidence/v0.7.1/`.
