# Ziran 0.7.2

Ziran `0.7.2` (`versionCode 72`) updates the native Android client (`apps/android/`) to the revised Wu wei design, adds the Plan screen, and makes the pairing screen respond to real server and code state.

## Changes

- **Indigo accent everywhere (`Tokens.kt`, `colors.xml`, `ic_launcher_foreground.xml`, `LocalNotifications.kt`)**: Replaced the vermilion/red seal accent with indigo (day `#2E4374`, night `#93A6D9`) across seals, send button, done rings/dots, prompt numbers, diff deletions with strikethrough, launcher icon, splash screen, and local notifications. Errors use `ink` / `ink3` with indigo accents and no red.
- **Recoloured paintings and new flock painting (`res/drawable-nodpi/*.webp`, `Painting.kt`)**: Re-exported all 12 scene paintings from `design/wu-wei/assets/` to WebP and added `painting_flock.webp` for the Plan screen.
- **New trigrams (`Protocol.kt`, `Seal.kt`)**: Added `wren` (`110`) and `lynx` (`001`).
- **Thread header dots & Plan entry (`ThreadScreen.kt`, `BackChevron.kt`)**: Added `PlanButton` at the top right of the thread screen and positioned plan step dots `58 dp` above the bottom of the painting so they clear the subtitle line in Day and Night.
- **Plan screen (`PlanScreen.kt`, `PlanParser.kt`, `AppController.kt`, `LiveReducer.kt`)**: Added the Plan screen with the `300 dp` flock painting header, coordinator trigram seal, mono summary, segmented progress bar (indigo done, flowing teal now, line waiting), step list on a vertical thread line with unfolding details (`750 ms`) and tabular-figure elapsed clock, and a coordinator composer (no Stop). Backed by `SessionSnapshot.plan`, `plan_updated` events, and `plan.snapshot`, with an honest empty state when no plan exists.
- **Live pairing (`StartScreen.kt`, `PairingHttp.kt`, `AppController.kt`, `AppHost.kt`)**:
  - Debounced `GET {server}/health` probe (`500 ms` after typing, immediate on paste/link), cancelling in-flight probes, with a flowing teal hairline and mono status line (reachable, unreachable, or incompatible protocol).
  - `XXXX-XXXX-XXXX` code formatting with per-character `6 dp` rise + fade (`180 ms`, `20 ms` stagger on paste) and a progressive ink underline that turns indigo on error.
  - Pair seal remains dim until 12 code characters and a reachable compatible server are present, then stamps in once.
  - Painting's 3-stage dots track `pairingStage` (`pairing` -> `connecting` -> `verified`), Ken Burns drift slows while waiting, `verified` stamps the last dot with `CONFIRM` haptic, and after `350 ms` ink drops from the Pair seal into `Threads`.

## Verification

- `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug` passed (`PlanParserTest`, `StartPairingTest`, and all existing JVM unit tests; `lintDebug` with `abortOnError = true` passed with 0 errors).
- Side-by-side `390x844` Day/Night screenshots, 1x and 0.25x pairing flow videos, 21 s Plan loop videos, and launcher icon capture are in [`docs/evidence/v0.7.2/README.md`](evidence/v0.7.2/README.md).
- Grep across `apps/android/app/src/` found zero leftover red hexes (`A8322B`, `C5483C`, `A33B2A`, `Color.Red`, `F4EBD6`).

## APK

There is no release signing config in `apps/android/app/build.gradle.kts`, so this pre-release attaches the debug APK:

```text
app-debug.apk
15,589,017 bytes (14.87 MiB)
SHA-256 a5ee4791a75c954d6b64024a3dd22d50b013b5ebcb4822c98f6fe7cf78449c1c
package dev.ziran.android
versionCode 72, versionName 0.7.2
```
