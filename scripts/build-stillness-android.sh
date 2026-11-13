#!/usr/bin/env bash
# Build and sign the Stillness 12 v0.3.1 Android release APK.
#
# This is the Tauri 2 shell under apps/stillness, not the older Expo client.
# The release APK is debug-signed for sideloading unless ANDROID_KEYSTORE and
# its password variables are supplied.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/stillness"
TAURI="$APP/node_modules/.bin/tauri"
GEN="$APP/src-tauri/gen/android"
TOOLCHAIN="${HOME}/.local/android-toolchain"

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

if [ -z "${NDK_HOME:-}" ]; then
  NDK_HOME="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
fi
export NDK_HOME="${NDK_HOME:?Android NDK was not found; set NDK_HOME}"

PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export PATH

for tool in java javac node bun keytool; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is not available on PATH" >&2
    exit 1
  fi
done
if [ ! -x "$TAURI" ]; then
  echo "error: Tauri CLI missing; run bun install in apps/stillness" >&2
  exit 1
fi

BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
export BUILD_TOOLS
if [ -z "$BUILD_TOOLS" ] || [ ! -x "$BUILD_TOOLS/apksigner" ]; then
  echo "error: Android build-tools with apksigner were not found" >&2
  exit 1
fi

echo "Java:"
java -version 2>&1
echo "SDK:        $ANDROID_HOME"
echo "NDK:        $NDK_HOME"
echo "Build tools: $(basename "$BUILD_TOOLS")"

if [ ! -d "$GEN" ]; then
  echo "Android project missing; initializing Tauri Android target"
  (cd "$APP" && CI=true "$TAURI" android init --ci)
  PATCH_FILE="$ROOT/scripts/patches/tauri-android-cli-path.patch"
  if [ -f "$PATCH_FILE" ]; then
    patch -p1 -d "$ROOT" < "$PATCH_FILE"
  fi
fi

# Tauri's generated Gradle project needs a local.properties when Gradle is
# invoked outside the Tauri CLI's environment.
if [ ! -f "$GEN/local.properties" ]; then
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$GEN/local.properties"
fi

for target in aarch64-linux-android armv7-linux-androideabi; do
  if ! rustup target list --installed | grep -qx "$target"; then
    rustup target add "$target"
  fi
done

echo "Building Stillness web bundle and Android release"
(cd "$APP" && CI=true "$TAURI" android build --apk --target aarch64 armv7)

UNSIGNED="$GEN/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
if [ ! -f "$UNSIGNED" ]; then
  echo "error: expected unsigned APK at $UNSIGNED" >&2
  exit 1
fi

KEYSTORE="${ANDROID_KEYSTORE:-$ROOT/android/app/debug.keystore}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-androiddebugkey}"
KEYSTORE_PASS="${ANDROID_KEYSTORE_PASS:-android}"
KEY_PASS="${ANDROID_KEY_PASS:-android}"
if [ ! -f "$KEYSTORE" ]; then
  echo "No keystore at $KEYSTORE; generating a local sideload debug key"
  KEYSTORE="$ROOT/.staging/android/debug.keystore"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass "$KEYSTORE_PASS" \
    -keypass "$KEY_PASS" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US"
fi

ALIGNED="$(mktemp "${TMPDIR:-/tmp}/jcode-stillness-aligned.XXXXXX.apk")"
if "$BUILD_TOOLS/zipalign" -c -v 4 "$UNSIGNED" >/dev/null 2>&1; then
  cp "$UNSIGNED" "$ALIGNED"
else
  "$BUILD_TOOLS/zipalign" -p 4 "$UNSIGNED" "$ALIGNED"
fi

VERSION="$(cd "$ROOT" && bun -p "require('./apps/stillness/package.json').version")"
OUT="$ROOT/artifacts/jcode-mobile-$VERSION-android-release.apk"
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
BADGING="$(mktemp "${TMPDIR:-/tmp}/jcode-stillness-badging.XXXXXX.txt")"
"$BUILD_TOOLS/aapt2" dump badging "$OUT" > "$BADGING"
sed -n '1,4p' "$BADGING"
rm -f "$BADGING"

HASH_LINE="$(shasum -a 256 "$OUT")"
printf '%s  %s\n' "${HASH_LINE%% *}" "$(basename "$OUT")" | tee "$OUT.sha256"
ls -lh "$OUT"
