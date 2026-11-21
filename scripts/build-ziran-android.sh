#!/usr/bin/env bash
# Build and sign the Ziran native Android release APK (`apps/android/`).
#
# The release APK is debug-signed for sideloading unless ANDROID_KEYSTORE and
# its password variables are supplied.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/android"
TOOLCHAIN="${HOME}/.local/android-toolchain"

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "/usr/lib/jvm/java-21-openjdk-amd64" \
    "/usr/lib/jvm/java-17-openjdk-amd64" \
    "/Library/Java/JavaVirtualMachines/jdk-24.jdk/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home" \
    "${HOME}/jdk17/jdk-17.0.21+9" \
    "${TOOLCHAIN}/jdk17/Contents/Home"; do
    if [ -x "${candidate}/bin/javac" ]; then
      JAVA_HOME="$candidate"
      break
    fi
  done
fi
export JAVA_HOME="${JAVA_HOME:?JDK 17+ was not found; set JAVA_HOME}"

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

PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export PATH

BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
export BUILD_TOOLS
if [ -z "$BUILD_TOOLS" ] || [ ! -x "$BUILD_TOOLS/apksigner" ]; then
  echo "error: Android build-tools with apksigner were not found" >&2
  exit 1
fi

if [ ! -f "$APP/local.properties" ]; then
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$APP/local.properties"
fi

echo "Java:        $(java -version 2>&1 | head -n 1)"
echo "SDK:         $ANDROID_HOME"
echo "Build tools: $(basename "$BUILD_TOOLS")"

echo "Running unit tests, lint, and assembling release APK..."
(cd "$APP" && ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleRelease)

UNSIGNED="$APP/app/build/outputs/apk/release/app-release-unsigned.apk"
if [ ! -f "$UNSIGNED" ]; then
  UNSIGNED="$APP/app/build/outputs/apk/release/app-release.apk"
fi
if [ ! -f "$UNSIGNED" ]; then
  echo "error: expected release APK under $APP/app/build/outputs/apk/release/" >&2
  exit 1
fi

KEYSTORE="${ANDROID_KEYSTORE:-$ROOT/android/app/debug.keystore}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-androiddebugkey}"
KEYSTORE_PASS="${ANDROID_KEYSTORE_PASS:-android}"
KEY_PASS="${ANDROID_KEY_PASS:-android}"
if [ ! -f "$KEYSTORE" ]; then
  echo "error: keystore not found at $KEYSTORE" >&2
  exit 1
fi

ALIGNED="$(mktemp "${TMPDIR:-/tmp}/ziran-aligned.XXXXXX.apk")"
if "$BUILD_TOOLS/zipalign" -c -v 4 "$UNSIGNED" >/dev/null 2>&1; then
  cp "$UNSIGNED" "$ALIGNED"
else
  "$BUILD_TOOLS/zipalign" -p 4 "$UNSIGNED" "$ALIGNED"
fi

VERSION="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' "$APP/app/build.gradle.kts" | head -n 1)"
VERSION="${VERSION:?could not read versionName from apps/android/app/build.gradle.kts}"
OUT="$ROOT/artifacts/ziran-$VERSION-android-release.apk"
mkdir -p "$ROOT/artifacts"

"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass "pass:$KEYSTORE_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --ks-key-alias "$KEY_ALIAS" \
  --out "$OUT" \
  "$ALIGNED"
rm -f "$ALIGNED"

"$BUILD_TOOLS/apksigner" verify --verbose "$OUT"
"$BUILD_TOOLS/zipalign" -c -v 4 "$OUT" >/dev/null
BADGING="$(mktemp "${TMPDIR:-/tmp}/ziran-badging.XXXXXX.txt")"
"$BUILD_TOOLS/aapt2" dump badging "$OUT" > "$BADGING"
sed -n '1,6p' "$BADGING"
rm -f "$BADGING"

HASH_LINE="$(shasum -a 256 "$OUT")"
printf '%s  %s\n' "${HASH_LINE%% *}" "$(basename "$OUT")" | tee "$OUT.sha256"
ls -lh "$OUT"
