#!/usr/bin/env bash
# Create (if needed) and boot the Android emulator used for evidence.
set -euo pipefail

TOOLCHAIN="${HOME}/.local/android-toolchain"
export JAVA_HOME="$TOOLCHAIN/jdk17/Contents/Home"
export ANDROID_HOME="$TOOLCHAIN/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

AVD_NAME="${AVD_NAME:-jcode-mobile}"
IMAGE="system-images;android-36;google_apis;arm64-v8a"

if ! avdmanager list avd 2>/dev/null | grep -q "Name: $AVD_NAME"; then
  echo no | avdmanager create avd -n "$AVD_NAME" -k "$IMAGE" --device "pixel_7"
fi

if ! pgrep -f "qemu-system-aarch64.*$AVD_NAME" >/dev/null 2>&1; then
  nohup emulator -avd "$AVD_NAME" -no-snapshot -no-boot-anim -gpu swiftshader_indirect >/tmp/jcode-emulator.log 2>&1 &
  echo $! >/tmp/jcode-emulator.pid
fi

adb wait-for-device
for _ in $(seq 1 180); do
  if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    echo "emulator booted"
    adb devices
    exit 0
  fi
  sleep 2
done
echo "emulator did not finish booting" >&2
exit 1
