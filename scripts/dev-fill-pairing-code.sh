#!/usr/bin/env bash
# Mint a staging pairing code and type it into the focused field via agent-device.
# The code is never printed: output is redacted before it reaches the terminal.
set -euo pipefail

STAGE="${JCODE_STAGING_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/jcode-mobile-staging}"
TARGET="${1:-@e13}"

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
agent-device fill "$TARGET" "$CODE" --settle 2>&1 | sed -E 's/[0-9]{6}/<code>/g'
