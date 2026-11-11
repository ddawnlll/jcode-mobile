#!/usr/bin/env bash
# Real-stack Stillness 12 e2e.
#
# Starts an isolated JCode daemon from the pinned fork binary, a Rust Adapter
# v2 instance, and serves the production web bundle from that adapter. It
# never touches the production daemon or the live adapter ports.
#
# Playwright Chromium is browser coverage. It is not native iOS or Android
# verification.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${STILLNESS_E2E_DIR:-$ROOT/.staging/stillness}"
PORT="${STILLNESS_E2E_PORT:-7650}"
PAIR_CODE="${STILLNESS_E2E_PAIR_CODE:-482913}"
JCODE_BIN="${JCODE_BIN:-$HOME/projects/jcode-fork/target/release/jcode}"
ADAPTER_BIN="${JCODE_ADAPTER_BIN:-$ROOT/target/debug/jcode-adapter-v2}"

mkdir -p "$STAGE"

if [ ! -x "$JCODE_BIN" ]; then
  echo "BLOCKED: pinned JCode binary is not built at $JCODE_BIN" >&2
  echo "Build it with: (cd ~/projects/jcode-fork && cargo build --release --bin jcode)" >&2
  exit 2
fi
if [ ! -x "$ADAPTER_BIN" ]; then
  echo "building Rust Adapter v2"
  (cd "$ROOT" && cargo build -p adapter-server --bin jcode-adapter-v2)
fi

stop_pid() {
  local file="$1"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 30); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_pid "$STAGE/adapter.pid"

echo "building Stillness web bundle"
(cd "$ROOT/apps/stillness" && bun run build > "$STAGE/web-build.log" 2>&1)

JCODE_STAGING_DIR="$STAGE/daemon" JCODE_BIN="$JCODE_BIN" bash "$ROOT/scripts/staging-up.sh" > "$STAGE/staging-up.log"
export JCODE_HOME="$STAGE/daemon/home"
export JCODE_RUNTIME_DIR="$STAGE/daemon/run"
export JCODE_SOCKET="$STAGE/daemon/run/jcode.sock"
export JCODE_API_SOCKET="$STAGE/daemon/run/jcode-api.sock"

if [ ! -S "$JCODE_API_SOCKET" ]; then
  echo "FAIL: staging daemon did not create the API socket at $JCODE_API_SOCKET" >&2
  tail -30 "$STAGE/daemon/serve.log" >&2 || true
  exit 1
fi

rm -rf "$STAGE/adapter"
rm -f "$ROOT/apps/stillness/.e2e-auth.json"

echo "starting Rust Adapter v2 on 127.0.0.1:$PORT"
setsid -f bash -c 'echo $$ > "$1"; shift; exec "$@"' _ "$STAGE/adapter.pid" \
  env \
  JCODE_HOME="$JCODE_HOME" \
  JCODE_RUNTIME_DIR="$JCODE_RUNTIME_DIR" \
  JCODE_SOCKET="$JCODE_SOCKET" \
  JCODE_API_SOCKET="$JCODE_API_SOCKET" \
  JCODE_ADAPTER_BIND="127.0.0.1:$PORT" \
  JCODE_ADAPTER_DATA_DIR="$STAGE/adapter" \
  JCODE_ADAPTER_ALLOWED_ROOTS="$ROOT" \
  JCODE_ADAPTER_DEFAULT_WORKDIR="$ROOT" \
  JCODE_ADAPTER_PAIRING_CODE="$PAIR_CODE" \
  JCODE_ADAPTER_WEB_DIR="$ROOT/apps/stillness/dist" \
  JCODE_ADAPTER_ALLOWED_ORIGINS="http://127.0.0.1:$PORT,http://localhost:$PORT" \
  JCODE_ADAPTER_NAME="JCode Mobile" \
  "$ADAPTER_BIN" \
  > "$STAGE/adapter.log" 2>&1 < /dev/null

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:$PORT/health" > /dev/null; then break; fi
  if ! kill -0 "$(cat "$STAGE/adapter.pid")" 2>/dev/null; then
    echo "FAIL: adapter exited before becoming healthy" >&2
    tail -40 "$STAGE/adapter.log" >&2 || true
    exit 1
  fi
  sleep 0.25
done
if ! curl -sf "http://127.0.0.1:$PORT/health" > /dev/null; then
  echo "FAIL: adapter did not become healthy" >&2
  tail -40 "$STAGE/adapter.log" >&2 || true
  exit 1
fi
if ! curl -sf "http://127.0.0.1:$PORT/health" | grep -q '"jcode_connected":true'; then
  echo "FAIL: adapter is up but the isolated JCode harness is not connected" >&2
  curl -s "http://127.0.0.1:$PORT/health" >&2 || true
  echo >&2
  tail -40 "$STAGE/daemon/serve.log" >&2 || true
  exit 1
fi

if [ -d "$HOME/playwright-deps/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$HOME/playwright-deps/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export STILLNESS_E2E_BASE_URL="http://127.0.0.1:$PORT"
export STILLNESS_E2E_PAIR_CODE="$PAIR_CODE"

cd "$ROOT"
set +e
bunx --bun playwright test -c apps/stillness/playwright.config.ts "$@"
STATUS=$?
set -e
exit "$STATUS"
