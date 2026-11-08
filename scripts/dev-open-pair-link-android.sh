#!/usr/bin/env bash
# Open a loopback pairing deep link on the Android emulator with a fresh code.
set -euo pipefail

STAGE="${JCODE_STAGING_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/jcode-mobile-staging}"
TOOLCHAIN="${HOME}/.local/android-toolchain"

read_pairing_code() {
  python3 - "$STAGE/home/devices.json" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(1)
codes = data.get("pending_codes", [])
if not codes:
    raise SystemExit(1)
codes.sort(key=lambda item: item.get("created_at", ""))
print(codes[-1]["code"])
PY
}

env JCODE_HOME="$STAGE/home" JCODE_RUNTIME_DIR="$STAGE/run" JCODE_SOCKET="$STAGE/run/jcode.sock" jcode pair >/dev/null 2>&1 || true
CODE="$(read_pairing_code || true)"
if [ -z "$CODE" ]; then
  echo "could not mint a pairing code" >&2
  exit 1
fi

URL="jcodemobile://pair?host=127.0.0.1&port=7643&code=${CODE}&insecure=1"
"$TOOLCHAIN/sdk/platform-tools/adb" shell am start \
  -a android.intent.action.VIEW \
  -d "'${URL}'" \
  com.jcodemobile.app >/dev/null
echo "opened loopback pairing link on Android"
