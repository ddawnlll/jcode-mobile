#!/usr/bin/env bash
# Build a release Android APK with embedded JS using the user-owned toolchain.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN="${HOME}/.local/android-toolchain"
export JAVA_HOME="${JAVA_HOME:-$TOOLCHAIN/jdk17/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$TOOLCHAIN/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

cd "$ROOT"
if [ ! -d android ]; then
  npx expo prebuild --platform android --no-install
fi

cd android
./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
cd ..

mkdir -p artifacts
APK="android/app/build/outputs/apk/release/app-release.apk"
cp "$APK" artifacts/jcode-mobile-0.1.0-android-release.apk
shasum -a 256 artifacts/jcode-mobile-0.1.0-android-release.apk | tee artifacts/jcode-mobile-0.1.0-android-release.apk.sha256
ls -lh artifacts/jcode-mobile-0.1.0-android-release.apk
