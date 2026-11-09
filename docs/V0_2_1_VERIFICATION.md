# v0.2.1 verification

Updated: 2026-11-09

Scope: issue #14, the full-screen animated ASCII welcome, plus the 0.2.1
release metadata and marketing updates.

## Candidate

| Item | Value |
| --- | --- |
| Branch | `main` |
| App version | 0.2.1 |
| Adapter | `jcode-mobile-adapter/0.2.1` |
| Expo / React Native / React | 58.0.23 / 0.88.1 / 19.3.0 |
| Bun | 1.4.4 |
| JCode staging | 0.99.1 |

## What changed

- The welcome is one full-screen character grid instead of a short 18 x 40
  strip. A halftone torus, contour field, opening noise, and a bitmap title
  silhouette share the same cell lattice.
- The settled screen reuses the outside-field raster verbatim and redraws only
  the rows that can contain the torus. The idle interval is 80 ms; the opening
  interval is 32 ms.
- The animation clock lives inside `AsciiWelcome`. A frame paint no longer
  re-renders the welcome copy, actions, theme strip, or preview card.
- Skip appears during the opening. Pause/Play appears after it settles. App
  background and screen unfocus stop the timer without counting the away time.
- Reduce Motion paints one settled frame and schedules no timer.
- A saved profile routes the primary action to Sessions (`welcome-sessions`).
  An unpaired profile routes to Connect (`welcome-connect`). Preview without
  connecting and the live theme strip stay available.
- Version metadata, CI artifact naming, README, website, and marketing tests
  move to 0.2.1.

## Issue #14 acceptance matrix

| Criterion | State | Evidence |
| --- | --- | --- |
| Port the full-screen ASCII reveal with Tidal palette, typography, and handoff to the idle donut | PASS (web) | `asciiTorus.test.ts`, `welcome.spec.ts`, `welcome-v021*.png` |
| Keep pairing, theme preview, Preview without connecting, Skip, and saved-server routing | PASS | `welcome.spec.ts`, `welcome-screen.test.tsx`, `connect.spec.ts` |
| Respect reduced motion; pause on background or offscreen | PASS (web) / PARTIAL (native timer behavior inspected only) | `welcome.spec.ts` reduced-motion test; `useAsciiWelcome.ts` AppState and `useIsFocused` guards |
| Reuse the character raster and limit idle redraws to the donut area | PASS | `outsideField` reuse; `welcome.spec.ts` asserts the donut band is less than 60% of rows and asserts at most 6 layer blocks |
| Measure frame pacing and startup on midrange Android and iOS | PARTIAL | Web pacing recorded below; physical Android/iOS pacing NOT_RUN (no device on this host) |
| Verify first launch, Skip, reduced motion, pairing/preview in Playwright and native builds | PASS (Playwright) / NOT_RUN (native device) | `welcome.spec.ts`; native APK build is CI-only |
| Confirm controls fit narrow screens and large text | PASS (320 x 568 and 320 x 720 web) / NOT_RUN (native large text) | `welcome.spec.ts` short-narrow test; `narrow.spec.ts`; native large-text capture NOT_RUN |

## Checks

| Check | Command | Result |
| --- | --- | --- |
| Types | `bun run typecheck` | PASS |
| Lint | `bun run lint` | PASS, one pre-existing `registry.ts` warning |
| Jest / RNTL | `bun run test` | PASS, 11 suites / 81 tests |
| Adapter contract | `bun run adapter:test` | PASS, 16 tests |
| Playwright app e2e | `bun run e2e` | PASS, 26/26 in 3.8 min (the first full run was 24/25 because the saved-server spec used the Appearance screen's `Theme family` heading instead of its `appearance-screen` test id; after the fix the full suite passed) |
| Marketing build | `bun run marketing:build` | PASS, 27 files |
| Marketing tests | `bun run marketing:test` with the rootless Chromium `LD_LIBRARY_PATH` | PASS, 76 passed / 3 skipped |
| Android release APK | CI `check.yml` workflow dispatch | PASS, 62.7 MiB, SHA-256 `6f383af7f30cf97ac89934a69d8a2319e8390cf1fc7c3ef24d819f4dc810a6cb` |
| Native iOS / Android device pacing and large text | device or simulator | NOT_RUN on this Debian VPS |

The first marketing run failed before launching Chromium because
`libatk-1.0.so.0` is not installed system-wide on this rootless host. Re-running
with the existing `~/playwright-deps/usr/lib/x86_64-linux-gnu` prefix passed;
this is the same library path `scripts/run-e2e.sh` uses for app e2e.

## Web pacing sample

Measured from `window.__JCODE_WELCOME_PERF__` in Playwright Chromium at
390 x 844, device scale factor 2, after the isolated staging bundle:

| Field | Observed |
| --- | --- |
| Opening duration | 1.63 s to 1.74 s |
| Opening frames | 38 to 42 |
| Average opening interval | about 39 to 46 ms |
| Worst opening interval | 92 to 114 ms, including the first layout and font settle |
| Idle interval target | 80 ms |
| Grid | 67 columns x 105 rows at 390 x 844 |
| Idle redraw band | torus rows 8 to 40 (32 of 105 rows) |

These are React commit timings from the web verification surface, not native
GPU frame pacing. The native measurement remains NOT_RUN.

## Evidence

- `docs/media/marketing/welcome-v021.png` (Tidal Light, 1170 x 2532)
- `docs/media/marketing/welcome-v021-night.png` (Tidal Night, 1170 x 2532)
- Playwright screenshots under `.staging/e2e/screens/v021-welcome-*.png`
- Playwright trace and failure artefacts under `.staging/e2e/results/` while the
  staging run exists; they are not committed.

## Release artifact

| Item | Value |
| --- | --- |
| Asset | `jcode-mobile-0.2.1-android-release.apk` |
| Size | 65,709,266 bytes (62.7 MiB) |
| SHA-256 | `6f383af7f30cf97ac89934a69d8a2319e8390cf1fc7c3ef24d819f4dc810a6cb` |
| CI run | `42677587489`, `android-release` job in 14m41s |
| ABIs | `arm64-v8a`, `armeabi-v7a` |
| Bundle | `assets/index.android.bundle` present |
| Signing | debug-signed, sideload only |
| Device install | NOT_RUN |

## Remaining native gates

- Cold-start and opening frame pacing on a midrange Android device and an
  iPhone.
- Native Reduce Motion and Reduce Transparency with the real OS preference.
- Large text (200%) on the welcome screen with the native font scale.
- TalkBack and VoiceOver reading order for the skip/pause controls, heading,
  theme radios, and primary actions.
- The release APK is built in CI but was not installed on a physical device in
  this session.
