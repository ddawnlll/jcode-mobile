#!/usr/bin/env bash
# Build the current Ziran Android release (`apps/android/`).
#
# v0.7.0 ships the native Kotlin + Jetpack Compose Ziran client.
# Earlier clients remain buildable with scripts/build-stillness-android.sh
# (0.3.x–0.6.x Tauri) and scripts/build-expo-android-release.sh (0.2.x Expo).
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-ziran-android.sh" "$@"
