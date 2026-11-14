#!/usr/bin/env bash
# Adapter v3 real-stack smoke test.
#
# Starts an isolated JCode daemon (private HOME/runtime), the Rust Adapter v3 on
# a dedicated port, then exercises pairing, negotiation, delta sync, the durable
# journal and a real one-turn agent reply. It never touches the production
# daemon, production adapter ports or existing sessions.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${V3_SMOKE_DIR:-$ROOT/.staging/e2e-v3}"
PORT="${V3_SMOKE_PORT:-7660}"
PAIR_CODE="${V3_SMOKE_PAIR_CODE:-482914}"

mkdir -p "$STAGE"

echo "== staging daemon =="
JCODE_STAGING_DIR="$STAGE" JCODE_BIN="${JCODE_BIN:-jcode}" bash "$ROOT/scripts/staging-up.sh"

echo "== adapter v3 =="
if [ -f "$STAGE/adapter-v3.pid" ] && kill -0 "$(cat "$STAGE/adapter-v3.pid")" 2>/dev/null; then
  kill "$(cat "$STAGE/adapter-v3.pid")" 2>/dev/null || true
  sleep 0.5
fi
mkdir -p "$STAGE/adapter3"
(cd "$ROOT" && cargo build -p adapter-server --bin jcode-adapter-v3 >/dev/null)
JCODE_HOME="$STAGE/home" \
JCODE_RUNTIME_DIR="$STAGE/run" \
JCODE_SOCKET="$STAGE/run/jcode.sock" \
JCODE_API_SOCKET="$STAGE/run/jcode-api.sock" \
JCODE_ADAPTER_BIND="127.0.0.1:$PORT" \
JCODE_ADAPTER_DATA_DIR="$STAGE/adapter3" \
JCODE_ADAPTER_ALLOWED_ROOTS="$ROOT" \
JCODE_ADAPTER_DEFAULT_WORKDIR="$ROOT" \
JCODE_ADAPTER_PAIRING_CODE="$PAIR_CODE" \
JCODE_ADAPTER_ALLOWED_ORIGINS="http://127.0.0.1:$PORT" \
JCODE_ADAPTER_NAME="Adapter v3 smoke" \
nohup "$ROOT/target/debug/jcode-adapter-v3" >"$STAGE/adapter-v3.log" 2>&1 &
echo $! >"$STAGE/adapter-v3.pid"

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then break; fi
  sleep 0.25
done
curl -sf "http://127.0.0.1:$PORT/health" | tee "$STAGE/health.json"
echo

echo "== v3 protocol smoke =="
V3_SMOKE_BASE_URL="http://127.0.0.1:$PORT" \
V3_SMOKE_PAIR_CODE="$PAIR_CODE" \
bun run "$ROOT/scripts/v3-smoke.ts"
