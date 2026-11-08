#!/usr/bin/env bash
# Run agent-device with the user-owned Android SDK on PATH.
set -euo pipefail

TOOLCHAIN="${HOME}/.local/android-toolchain"
export ANDROID_HOME="$TOOLCHAIN/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

exec agent-device "$@"
