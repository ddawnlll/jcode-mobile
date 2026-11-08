#!/usr/bin/env bash
# Development-only: pair the iOS Simulator app with the staging adapter by
# writing a short-lived import file into the app's Documents directory. The app
# imports it on next launch, stores the token in Keychain, and deletes the file.
#
# The token and pairing code are never printed. Loopback only.
set -euo pipefail

STAGE="${JCODE_STAGING_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/jcode-mobile-staging}"
APP_ID="com.jcodemobile.app"
ADAPTER="http://127.0.0.1:7643"

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

DATA_DIR="$(xcrun simctl get_app_container booted "$APP_ID" data)"
if [ -z "$DATA_DIR" ]; then
  echo "app is not installed in the booted simulator" >&2
  exit 1
fi

BODY="$(printf '{"code":"%s","device_id":"dev-simulator-device","device_name":"Studio Simulator"}' "$CODE")"
RESPONSE="$(curl -fsS -X POST -H 'content-type: application/json' -d "$BODY" "$ADAPTER/pair")"

printf '%s' "$RESPONSE" | python3 -c '
import json, os, sys
data = json.load(sys.stdin)
if not data.get("ok") or not data.get("token"):
    raise SystemExit("pairing failed")
token = data["token"]
out = {
    "label": "Studio VPS (staging)",
    "host": "127.0.0.1",
    "port": 7643,
    "tls": False,
    "token": token,
    "deviceId": data.get("device", {}).get("id", "dev-simulator-device"),
}
path = os.path.join(sys.argv[1], "Documents", "dev-pair.json")
with open(path, "w", encoding="utf-8") as handle:
    json.dump(out, handle)
os.chmod(path, 0o600)
' "$DATA_DIR"

echo "seeded simulator profile; relaunch the app to import it"
