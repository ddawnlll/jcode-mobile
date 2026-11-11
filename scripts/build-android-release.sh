#!/usr/bin/env bash
# Build a release Android APK with embedded JS using the user-owned toolchain.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN="${HOME}/.local/android-toolchain"
export BUN_BIN="${BUN_BIN:-$(command -v bun)}"
export NODE_BINARY="$BUN_BIN"
export PATH="$ROOT/scripts/bun-shims:$PATH"

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "/usr/lib/jvm/java-21-openjdk-amd64" \
    "/usr/lib/jvm/java-17-openjdk-amd64" \
    "${HOME}/jdk17/jdk-17.0.21+9" \
    "${TOOLCHAIN}/jdk17/Contents/Home"; do
    if [ -x "${candidate}/bin/javac" ]; then
      JAVA_HOME="$candidate"
      break
    fi
  done
fi
export JAVA_HOME="${JAVA_HOME:?JDK 21 or 17 was not found; set JAVA_HOME}"

if [ -z "${ANDROID_HOME:-}" ] && [ -n "${ANDROID_SDK_ROOT:-}" ]; then
  ANDROID_HOME="$ANDROID_SDK_ROOT"
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  for candidate in "${HOME}/android-sdk" "${HOME}/Android/Sdk" "${TOOLCHAIN}/sdk"; do
    if [ -d "${candidate}/platforms" ]; then
      ANDROID_HOME="$candidate"
      break
    fi
  done
fi
export ANDROID_HOME="${ANDROID_HOME:?Android SDK was not found; set ANDROID_HOME}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ROOT/scripts/bun-shims:$PATH"

for tool in java javac adb; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is not available on PATH" >&2
    exit 1
  fi
done

echo "Java:"
java -version 2>&1
echo "SDK:     $ANDROID_HOME"
echo "Build tools: $(ls "$ANDROID_HOME/build-tools" 2>/dev/null | tail -n 1)"

cd "$ROOT"
if [ ! -d android ]; then
  bunx --bun expo prebuild --platform android --no-install
fi
if [ ! -f android/local.properties ]; then
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
fi

cd android
./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
cd ..

mkdir -p artifacts
APK="android/app/build/outputs/apk/release/app-release.apk"
VERSION="$(bun -p "require('./package.json').version")"
cp "$APK" "artifacts/jcode-mobile-$VERSION-android-release.apk"
shasum -a 256 "artifacts/jcode-mobile-$VERSION-android-release.apk" | tee "artifacts/jcode-mobile-$VERSION-android-release.apk.sha256"
ls -lh "artifacts/jcode-mobile-$VERSION-android-release.apk"
