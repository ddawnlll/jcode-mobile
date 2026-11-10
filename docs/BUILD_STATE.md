# Build state

Updated: 2026-11-10

## Current state

| Item | Value |
| --- | --- |
| Branch | `main` |
| Remote | `https://github.com/ddawnlll/jcode-mobile` (private) |
| App version | 0.2.2 |
| Expo SDK | 58.0.23 |
| React Native / React | 0.88.1 / 19.3.0 |
| Hermes / new architecture | enabled (SDK default) |
| JCode (installed + staging) | 0.99.1, commit `7206efd0c1dbf49ef38d06b63f3a96a3a7cee611` |
| Adapter protocol | v1 |
| Active iOS Simulator | iPhone 17 Pro, iOS 26.1 (`E9144064-F5FC-4846-A88C-E43DF837F103`) |
| Staging daemon | `$JCODE_SCRATCH_DIR/jcode-mobile-staging` (private home/runtime dirs) |
| Staging adapter | `127.0.0.1:7643` (plain ws, loopback development exception); stopped after verification |

## Decisions that affect resumption

- The project root is this directory (named `jcode-mobile-app`); the GitHub repository is `jcode-mobile`.
- `src/shell/` holds the app root and native stack. It is intentionally not `src/app/` because Expo tooling treats that as an Expo Router routes directory.
- The adapter is TypeScript running on Bun 1.4.4, not a Rust patch. It reuses the daemon runtime, persisted history, the curated harness bridge for control reads, and JCode's own `devices.json` pairing registry.
- Session attachment always uses the raw daemon socket with `continue_on_disconnect: true`; the curated bridge is never used to attach.
- Delivery receipts use the daemon `ack` plus a bounded adapter ledger keyed by client message id.
- Identity fencing is adapter-normalized: `attachment_id` per attach and a monotonic `turn_id` per attachment.
- iOS builds need a local compatibility patch for `expo-modules-jsi@58.0.22` (Xcode 26.1 Swift 6.2 sendability). `scripts/patch-expo-modules-jsi.js` runs on postinstall and is idempotent.
- Local simulator pairing is seeded through a development-only file import (`__DEV__` only, loopback only). Production pairing uses the real `/pair` endpoint with a code from `jcode pair`.
- The same attachment identity can arrive as history and as a live tool event; Work dedupes by `call_id` and prefers the live row. Attaching a different session resets the transcript and title instead of reusing the previous session's.
- Sending forces the transcript to the newest item even when the reader was parked at the seam.
- `JCODE_ADAPTER_FAULT=drop_after_send` is a test-only hook that closes the daemon attachment after a prompt write; it is off by default and used for the A05 capture.

## Release artifacts (freeze build)

| Artifact | Bytes (approx) | SHA-256 |
| --- | --- | --- |
| `artifacts/jcode-mobile-0.2.2-android-release.apk` | 62.7 MiB (65,731,410 B) | `f2ee7c4f0eae836c8361f956cd3ffe0403ddae389bac4c3a2fd59a17c001ddf9` |
| `artifacts/jcode-mobile-0.2.2-ios-simulator.app.zip` | 29 MiB | `33269e4e09d34d3da5d35653451172c4f49225edee0e22966d8343c84e8e3859` |
| `artifacts/jcode-mobile-0.2.1-android-release.apk` | 62.7 MiB (65,709,266 B) | `6f383af7f30cf97ac89934a69d8a2319e8390cf1fc7c3ef24d819f4dc810a6cb` |
| `artifacts/jcode-mobile-0.2.0-android-release.apk` | 63 MiB | `016890e42a293256fa1370c43176d65cb4aa67d2d7df0809847cb6ca03432351` |
| `artifacts/jcode-mobile-0.1.3-ios-simulator.app.zip` | 24 MiB | `d5b5259a22baf88b7a0b03e03a13f8bc9a66b0fc687b69e8e9bde3eb6c578586` |
| `artifacts/jcode-mobile-0.1.3-android-release.apk` | 60 MiB | `eb5c7029561c16b9dfb19dd06cece12794fcb49f0bc9a872c06e69b884ac1960` |

The 0.2.1 APK is a release build with an embedded Hermes bundle for `arm64-v8a` and `armeabi-v7a`, debug-signed for sideloading. It is attached to release `v0.2.1`. The 0.2.0 APK remains the previous release. The iOS artifact remains the v0.1.3 Release-configuration Simulator `.app` zip with `main.jsbundle`. Artifacts are not committed.

## v0.2.2 repair release

`docs/V0_2_2_VERIFICATION.md` records the audit repair matrix, the follow-up
fixes from the published builds, and native simulator evidence.

| Check | Result |
| --- | --- |
| `bun run check` | PASS, 11 suites / 99 tests |
| `bun run adapter:test` | PASS, 27 tests |
| `bun run e2e` | PASS, 32/32 on clean isolated staging |
| iOS Release Simulator | PASS, ad-hoc signed, paired, context/model/projects/direct create verified |
| Android release APK | NOT_RUN, no Android SDK/JDK on this host |

## v0.2.1 welcome release

Issue #14 is implemented on `main`: full-screen character grid, bitmap title
silhouette, torus-band idle redraw, Skip, Pause/Play, Reduce Motion still frame,
saved-server routing, and retained theme preview. Evidence is in
`docs/V0_2_1_VERIFICATION.md`.

| Check | Result |
| --- | --- |
| `bun run check` | PASS, 11 suites / 81 tests |
| `bun run adapter:test` | PASS, 16 tests |
| `bun run e2e` | PASS, 26/26 |
| `bun run marketing:test` | PASS, 76 passed / 3 skipped |
| Android release APK | PASS, 62.7 MiB, `arm64-v8a` + `armeabi-v7a`, debug-signed; checksum above |
| Native device pacing, large text, screen reader | NOT_RUN |

## Commands verified for v0.2.0

```sh
bun run typecheck           # pass, including a Bun-only PATH
bun run lint                # pass (one pre-existing warning in registry.ts)
bun run test                # 10 suites / 75 tests
bun run adapter:test        # 16 tests
bun run e2e                 # 20/20 Playwright tests, isolated staging
bunx --bun expo export -p web
bunx --bun expo prebuild --platform android --no-install  # Bun Gradle config generated
gh workflow run check.yml --ref feature/v0.2.0-tidal-glass -f release=true  # release APK
```

Historical native artifact commands below were run on the v0.1.3 host. They
are not re-certified for v0.2.0 on this VPS (no JDK/Android SDK or macOS):

```sh
bun run ios --device "iPhone 17 Pro"
bun run android
bash scripts/build-android-release.sh
bash scripts/build-ios-simulator.sh
gh workflow run check.yml --ref main
```

## v0.1.4 reliability patch

Ten reliability fixes for issues #2-#11 are implemented on `reliability/v0.1.4`, followed by nine review-round race fixes. Full evidence is in `docs/V0_1_4_VERIFICATION.md`. Current checks under Node 22.21.1: `npm run check` (62 Jest tests), `npm run adapter:test` (12 tests), `npm run e2e` (10 tests, Expo web/Chromium). Native Android/iOS checks remain NOT_RUN on this host.

## v0.2.0 Tidal Glass and Bun

Bun 1.4.4 is the sole host runtime and package manager. `bun.lock` is the one
lockfile; CI uses `oven-sh/setup-bun` and `bun install --frozen-lockfile`.
Adapter, typecheck, lint, Jest/RNTL, Playwright, and Expo web export run under
Bun. Full evidence, coverage matrix, and the Bun/Node performance comparison are
in `docs/V0_2_0_VERIFICATION.md`.

| Item | Value |
| --- | --- |
| Theme families | 11 families / 22 Light+Night palettes; Tidal preserved |
| Rich content | CommonMark/GFM + footnotes + math, highlight.js, native LaTeX |
| Images | bounded prompt images + controlled Markdown image loading |
| Adapter additions | directory browse, config/effort, context snapshot, images, changes |
| Web e2e | iPhone 14, Pixel 7, and 320-wide projects |
| Native v0.2 gates | Android debug CI PASS (`assembleDebug`); device release NOT_RUN |

## Web target (verified 2026-11-09 on Debian 13)

| Item | Value |
| --- | --- |
| Web runtime | Expo export with `react-native-web`; expo-sqlite WASM with COOP/COEP |
| Web server | `scripts/serve-web.mjs`, or the adapter with `JCODE_ADAPTER_WEB_DIR` |
| Playwright | 1.65 / Chromium, iPhone 14 and Pixel 7 profiles |
| E2E environment | isolated `.staging/jcode` daemon, adapter 7645, web 8091 |
| E2E coverage | Connect, sessions, conversation reply, Work/Plan, rich content, themes, context, Find, Changes, New session, 320-wide |
| Result | `bun run e2e`: 20 passed (2026-11-09) |
| Live deployment | Caddy `https://dawnll.duckdns.org` proxies to adapter `127.0.0.1:7644` |
| Rootless browsers | Chromium libraries extracted under `~/playwright-deps` |

The e2e seed is gated by the build-time `EXPO_PUBLIC_E2E=1` constant and is
inert in a normal web export. Web tokens live in localStorage, so the web
target is a preview/test surface, not a replacement for the native
Keystore/Keychain build.

## Commands that failed and why

| Command | Result | Resolution |
| --- | --- | --- |
| `brew install --cask temurin@17` | FAIL: sudo password required | Downloaded Temurin 17 tarball into `~/.local/android-toolchain` |
| `brew install --cask android-commandlinetools` | FAIL: Homebrew download error | Downloaded command-line tools from Google and installed SDK 36 into `~/.local/android-toolchain/sdk` |
| `xcodebuild` (first iOS build) | FAIL: expo-modules-jsi Swift 6 data-race error | Local postinstall patch wraps the pointer in the package's `UncheckedSendable` |
| `npm install` | FAIL: shared npm cache permission | Project-local cache `.npm-cache` for all installs |

## Resumption point

1. Final release artifacts are rebuilt from the freeze commit; checksums are in `artifacts/*.sha256`.
2. Native integration, offline/reconnect, Work, Night, and large-text evidence is under `docs/evidence/native/`.
3. Remaining gates are enumerated in `docs/VERIFICATION.md` as NOT_RUN/PARTIAL/BLOCKED (physical devices, live VPS, some adversarial scenarios).
4. Push the freeze commit and inspect the GitHub Actions run. Done at `d2bccc8`; CI `42497990160` passed. Staging daemon/adapter/emulator were stopped after verification; restart with `scripts/staging-up.sh` and `scripts/staging-adapter.sh`.

## Device/build identifiers

- iOS bundle: `com.jcodemobile.app`
- Android package: `com.jcodemobile.app`
- Simulator device: iPhone 17 Pro, iOS 26.1
- Staging session IDs are recorded in `docs/evidence/` (not production).
