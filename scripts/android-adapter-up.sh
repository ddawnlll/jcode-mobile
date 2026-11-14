#!/usr/bin/env bash
# Start a staging Adapter v3 for Android emulator verification (10.0.2.2 host).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$ROOT/.staging/e2e-v3"
PORT="${ANDROID_ADAPTER_PORT:-7661}"
CODE="${ANDROID_ADAPTER_PAIR_CODE:-482930}"

mkdir -p "$STAGE/adapter-android"
JCODE_HOME="$STAGE/home" \
JCODE_RUNTIME_DIR="$STAGE/run" \
JCODE_SOCKET="$STAGE/run/jcode.sock" \
JCODE_API_SOCKET="$STAGE/run/jcode-api.sock" \
JCODE_ADAPTER_BIND="0.0.0.0:$PORT" \
JCODE_ADAPTER_DATA_DIR="$STAGE/adapter-android" \
JCODE_ADAPTER_ALLOWED_ROOTS="$ROOT" \
JCODE_ADAPTER_DEFAULT_WORKDIR="$ROOT" \
JCODE_ADAPTER_PAIRING_CODE="$CODE" \
JCODE_ADAPTER_ALLOWED_ORIGINS="http://10.0.2.2:$PORT,http://127.0.0.1:$PORT" \
JCODE_ADAPTER_NAME="Adapter v3 Android" \
nohup "$ROOT/target/debug/jcode-adapter-v3" >"$STAGE/adapter-android.log" 2>&1 &
echo $! >"$STAGE/adapter-android.pid"
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then break; fi
  sleep 0.25
done
curl -s "http://127.0.0.1:$PORT/health"
echo
echo "pairing code: $CODE"
