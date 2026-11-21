# Ziran 0.7.0 — "Wu wei"

A native Android client for JCode, built in Kotlin and Jetpack Compose. The
phone stays a client; the daemon owns execution. Ziran speaks the Adapter v4
protocol directly without a WebView.

## What is here

- **Native Android client (`apps/android/`)**: Standalone Gradle project,
  application id `dev.ziran.android`, version `0.7.0` (`versionCode 70`),
  `compileSdk 37`, `targetSdk 37`, `minSdk 26`, strict `lint { abortOnError = true }`.
- **Wu wei design system (`design/wu-wei/`)**: Start, Threads, Thread, Model and
  effort, and Scene and theme screens in Day and Night ink. Bundled EB Garamond
  and JetBrains Mono fonts (OFL), pre-scaled 256 dp tiled paper grain, and
  twelve open-access painting details with exact Day/Night `ColorMatrix`
  treatment (`brightness(0.58) saturate(0.85)`).
- **Adapter v4 protocol**: Pairing via one-time code or `ziran://pair` link with
  Keystore-encrypted tokens, `client.hello` negotiation, `transport.bytes`
  packages, sessions delta and subscribe, event replay, reserve and dispatch,
  explicit Stop, permissions, models, reasoning effort, archive, restore,
  favourite, and rename.
- **Wu wei motion and gestures**:
  - Single easing (`CubicBezierEasing(0.22f, 1f, 0.36f, 1f)`), single call-site
    transitions (`NavHost.kt`), zero screen-teardown flashes.
  - Ink drop (900 ms) from the tapped row or Pair seal; Model and Scenes unroll
    top-down (800 ms) and roll up (700 ms) behind a 6 dp ink rod.
  - Back slide (420 ms, `-22%` parallax) and Android 14+ predictive back
    (1:1 edge shrink to 90%, 30 dp rounded corners, 320 ms cancel settle, 300 ms
    commit).
  - Live turn timeline: growing/folding thinking bar, tool rows with ink dot →
    flowing blue hairline → self-drawing vermilion ring, unfolding diff and test
    panels, and zero-recomposition `withFrameNanos` word streaming.
  - Composer rides the Android IME frame by frame; swipe-to-archive with undo,
    long-press lift + action sheet, pull-to-refresh ink ring, and 120 ms fades
    when `ANIMATOR_DURATION_SCALE = 0`.
- **120 Hz ready**: `MainActivity` requests the display's peak refresh-rate mode
  matching the active physical resolution (`preferredDisplayModeId` /
  `preferredRefreshRate`).

## Artifact

```text
ziran-0.7.0-android-release.apk
11,624,585 bytes (11.09 MiB)
SHA-256 fa4946d18b98cab22a70438183201c33818fc8064d477275d4983d95586ea875
package dev.ziran.android
versionCode 70, versionName 0.7.0
minSdk 26, targetSdk 37, compileSdk 37
APK Signature Scheme v2 and v3, Android Debug certificate
```

```sh
adb install -r ziran-0.7.0-android-release.apk
```

## Build

```sh
cd apps/android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
cd ../..
bash scripts/build-android-release.sh
```

## Verification

- `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleRelease`
  PASS (90 JVM unit tests, 0 lint errors).
- `apksigner verify` (v2 + v3), `zipalign -c -v 4`, and `aapt2 dump badging` PASS.
- Side-by-side verification against `design/wu-wei/` across all 9 flows at 1x
  and 0.25x plus 10 Day/Night screen comparisons:
  [`docs/evidence/v0.7.1/README.md`](evidence/v0.7.1/README.md) and
  [`docs/V0_7_1_RELEASE_NOTES.md`](V0_7_1_RELEASE_NOTES.md).
- `gfxinfo framestats` on Metal GPU emulator (`emulator-5554`, API 36): UI
  thread p50 `0.5–2.0 ms` (p90 `0.9–4.4 ms`), RenderThread `IssueDraw` p50
  `0.4–1.8 ms`, jank `0.17–2.36%` across Flows 1–8. Emulator display exposes
  60 Hz only; 120 Hz mode selection is covered by `RefreshRateAndMotionTest`.
- Adapter v4 Rust workspace (`cargo test --workspace`): 96 tests PASS.
- Rebranded Ziran website (`bun run marketing:test`): PASS.

## Rules that hold

- Nothing on the phone cancels a turn except the explicit Stop control for that
  session. Navigation, background, socket close, and process death never do.
- Reopening restores the exact server and session. A missing session shows an
  honest recovery state; it never creates a replacement.
- An unconfirmed send stays pending and unknown. The client never resends bytes
  that may already have reached the agent.
- Zero Chinese characters anywhere in the UI.
