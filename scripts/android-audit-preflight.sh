#!/usr/bin/env bash
# Read-only Android audit preflight. No device state, logs, or app data are changed.
set -u

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "Usage: ADB=/path/to/adb bash scripts/android-audit-preflight.sh DEVICE_SERIAL" >&2
  exit 2
fi
adb_bin=${ADB:-adb}
serial=$1
if ! command -v "$adb_bin" >/dev/null 2>&1; then
  echo "ERROR: adb not found: $adb_bin" >&2
  exit 2
fi
if [ "$("$adb_bin" -s "$serial" get-state 2>/dev/null)" != device ]; then
  echo "ERROR: selected device is not available and authorized: $serial" >&2
  exit 1
fi

printf 'UTC: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf 'Selected serial: %s\n' "$serial"
printf 'Git commit: %s\n' "$(git rev-parse HEAD 2>/dev/null || printf unknown)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo 'Working tree: dirty (record changes separately)'
else
  echo 'Working tree: clean or unavailable'
fi
failed=0
run() {
  printf '\n### %s\n' "$1"
  shift
  if ! "$adb_bin" -s "$serial" "$@"; then
    echo 'NOT_AVAILABLE: command failed' >&2
    failed=1
  fi
}
run 'ADB version' version
run 'Model' shell getprop ro.product.model
run 'Android release' shell getprop ro.build.version.release
run 'API level' shell getprop ro.build.version.sdk
run 'Build fingerprint (may identify a device build)' shell getprop ro.build.fingerprint
run 'ABIs' shell getprop ro.product.cpu.abilist
run 'Display size' shell wm size
run 'Display density' shell wm density
run 'Battery state (snapshot, not a drain measurement)' shell dumpsys battery
printf '\n### Package paths (not proof of APK hash or signature)\n'
package_paths=$("$adb_bin" -s "$serial" shell pm path dev.jcode.stillness) || failed=1
if [ -z "$package_paths" ]; then
  echo 'NOT_AVAILABLE: package not installed or package query failed' >&2
  failed=1
else
  printf '%s\n' "$package_paths"
fi
if [ "$failed" -ne 0 ]; then
  echo 'PARTIAL: one or more commands failed; inspect output.' >&2
  exit 1
fi
echo 'Preflight only: no issue acceptance criterion has been verified.'
