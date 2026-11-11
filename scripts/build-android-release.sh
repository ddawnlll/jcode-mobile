#!/usr/bin/env bash
# Build the current JCode Mobile Android release.
#
# v0.3.0 ships the Stillness 12 Tauri shell. The earlier Expo/React Native
# client is still buildable with scripts/build-expo-android-release.sh.
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-stillness-android.sh" "$@"
