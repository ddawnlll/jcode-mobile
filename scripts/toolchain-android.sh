#!/usr/bin/env bash
# Install a user-owned JDK 17 and Android SDK without sudo.
# Homebrew casks for both require an interactive password in this environment.
set -euo pipefail

ROOT="${HOME}/.local/android-toolchain"
JDK_DIR="${ROOT}/jdk17"
SDK_DIR="${ROOT}/sdk"
mkdir -p "$ROOT" "$SDK_DIR"

if [ ! -x "$JDK_DIR/Contents/Home/bin/java" ]; then
  echo "downloading Temurin 17 (macOS arm64)"
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64) ADOPT_ARCH=aarch64 ;;
    x86_64) ADOPT_ARCH=x64 ;;
    *) echo "unsupported arch $ARCH"; exit 1 ;;
  esac
  curl -fsSL -o "$ROOT/jdk17.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/17/ga/mac/${ADOPT_ARCH}/jdk/hotspot/normal/eclipse?project=jdk"
  rm -rf "$JDK_DIR"
  mkdir -p "$JDK_DIR"
  tar -xzf "$ROOT/jdk17.tar.gz" -C "$JDK_DIR" --strip-components=1
  rm -f "$ROOT/jdk17.tar.gz"
fi
JAVA_HOME="$JDK_DIR/Contents/Home"
echo "JAVA_HOME=$JAVA_HOME"

if [ ! -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "resolving Android command-line tools"
  CT_URL="$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml \
    | python3 -c 'import re,sys; xml=sys.stdin.read(); m=re.findall(r"commandlinetools-mac-(\d+)_latest\.zip", xml); print(f"https://dl.google.com/android/repository/commandlinetools-mac-{max(set(m), key=int)}_latest.zip")')"
  echo "downloading $CT_URL"
  curl -fsSL -o "$ROOT/cmdline-tools.zip" "$CT_URL"
  rm -rf "$SDK_DIR/cmdline-tools"
  mkdir -p "$SDK_DIR/cmdline-tools"
  unzip -q "$ROOT/cmdline-tools.zip" -d "$SDK_DIR/cmdline-tools"
  mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  rm -f "$ROOT/cmdline-tools.zip"
fi

export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"

yes | sdkmanager --licenses >/dev/null || true
sdkmanager --install \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.0.0" \
  "emulator" \
  "system-images;android-36;google_apis;arm64-v8a" 2>&1 | tail -20

echo "ANDROID_HOME=$SDK_DIR"
sdkmanager --list_installed | sed -n '1,40p'
