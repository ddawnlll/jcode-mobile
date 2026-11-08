# Build state

Updated: 2026-11-08

## Current state

| Item | Value |
| --- | --- |
| Branch | `main` |
| Remote | `https://github.com/ddawnlll/jcode-mobile` (private) |
| App version | 0.1.1 |
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
- The adapter is TypeScript on Node 22 (type stripping), not a Rust patch. It reuses the daemon runtime, persisted history, the curated harness bridge for control reads, and JCode's own `devices.json` pairing registry.
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
| `artifacts/jcode-mobile-0.1.1-ios-simulator.app.zip` | 24 MiB | `7ee0afd5b15cab79148dffe713965fe74df71a9cb2f77aab245d2d69858ea968` |
| `artifacts/jcode-mobile-0.1.1-android-release.apk` | 60 MiB | `0e1e97092788d399949a8bebe21913f8f63ba72dc21563b76b61c5895d7714e9` |

The APK is a release build (embedded Hermes bundle, debug signing for local install only). The iOS artifact is a Release-configuration Simulator `.app` zip with `main.jsbundle`. Artifacts are not committed; they are attached to the private draft release.

## Commands that pass

```sh
npx tsc --noEmit            # pass
npx eslint .                # pass
npm test                    # 34/34 pass
node --test integration/jcode-adapter/test/*.test.ts   # 7/7 pass
bash scripts/staging-run.sh integration/jcode-adapter/test/continuity.ts  # PASS
bash scripts/staging-run.sh integration/jcode-adapter/test/daemon-death.ts # PASS
npx expo run:ios --device "iPhone 17 Pro"  # dev build + launch, pass
bash scripts/build-android-release.sh        # release APK, pass
bash scripts/build-ios-simulator.sh          # release Simulator .app, pass
gh workflow run check.yml --ref main         # Android 36 build, pass
```

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
