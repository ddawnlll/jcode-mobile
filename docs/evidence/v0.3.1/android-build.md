# Android release build - JCode Mobile 0.3.1

## Host & toolchain

- Host: macOS 26 (Darwin 25.1.0), arm64
- Java: OpenJDK Temurin 17.0.21 (`~/.local/android-toolchain/jdk17`)
- SDK:  `~/.local/android-toolchain/sdk` — platforms android-36, android-37.0,
  build-tools 36.0.0 and 37.0.0, NDK 27.1.12297006
- Rust targets: `aarch64-linux-android`, `armv7-linux-androideabi`
- App: `apps/stillness` (Tauri 2), version 0.3.1, versionCode 3001

## Build

```sh
JAVA_HOME=$HOME/.local/android-toolchain/jdk17/Contents/Home \
ANDROID_HOME=$HOME/.local/android-toolchain/sdk \
bash scripts/build-android-release.sh
```

## Result

```text
artifacts/jcode-mobile-0.3.1-android-release.apk
11,016,925 bytes
03a6d808524461e12dca1370540eede2e040e179e9f116cec980effb180da562
package dev.jcode.stillness
versionCode 3001, versionName 0.3.1
ABIs arm64-v8a + armeabi-v7a
Signer v2 + v3, Android Debug certificate
```

## Artifact verification

```text
apksigner verify --verbose -> Verified using v2 and v3 schemes: true, signers: 1
aapt2 badging -> package dev.jcode.stillness, versionCode 3001, versionName 0.3.1,
                 ABIs arm64-v8a + armeabi-v7a
zipalign -c -> ok
```

## Device verification

- Installed on AVD `jcode-audit-api35` (Pixel 7, API 35, google_apis, arm64-v8a).
- Fresh loopback pairing (`pm clear` + pair) against an isolated staging
  adapter: PASS, end-to-end pair exchange and credential hello.
- Fired cold start after force-stop/relaunch: PASS, session restored.
- Ran real turns through the pinned JCode daemon; tool cards render and the
  transcript reconciles correctly after navigation and restart.
- Marketing capture pipeline (`scripts/marketing-media/capture-stillness-screens.mjs`)
  reported `errors: []`.
