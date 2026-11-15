#!/usr/bin/env bash
# Start a clean benchmark stack: fake Responses provider, isolated JCode
# daemon + harness API bridge, and the 0.4.0 (v3) and 0.5.0 (v4) adapters.
#
# Usage: stage-start.sh [tag] [deltas] [chunk] [chunk_ms] [replace_bytes] [big_delta_bytes]
# Everything lives under the agent scratch directory.
set -euo pipefail

BENCH=/Users/hootie/.jcode/scratch/bench
TAG="${1:-run}"
DELTAS="${2:-12000}"
CHUNK="${3:-200}"
CHUNK_MS="${4:-20}"
REPLACE="${5:-0}"
BIG_DELTA="${6:-0}"
JCODE=/Users/hootie/src/jcode-fork/target/release/jcode
OLD_ADAPTER=/Users/hootie/src/jcode-mobile-app/target/debug/jcode-adapter-v3
NEW_ADAPTER="$BENCH/new/target/debug/jcode-adapter-v4"
OLD_CODE=483101
NEW_CODE=483102

stop_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null || true
}

if [ -f "$BENCH/current-stage" ]; then
  PREV="$(cat "$BENCH/current-stage")"
  for pidfile in "$PREV"/*.pid; do
    [ -f "$pidfile" ] || continue
    stop_pid "$(cat "$pidfile")"
  done
fi
if [ -f "$BENCH/fake-provider.pid" ]; then
  stop_pid "$(cat "$BENCH/fake-provider.pid")"
fi

# The adapters ignore SIGTERM while a client is attached. Clear the benchmark
# ports explicitly so a failed bind can never masquerade as a healthy stage.
for port in 7655 7656 7899; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -n1 kill -9 2>/dev/null || true
  fi
done
for _ in $(seq 1 40); do
  busy="$( { lsof -tiTCP:7655 -sTCP:LISTEN; lsof -tiTCP:7656 -sTCP:LISTEN; lsof -tiTCP:7899 -sTCP:LISTEN; } 2>/dev/null || true )"
  [ -z "$busy" ] && break
  sleep 0.1
done

STAGE="$BENCH/stage-$TAG"
mkdir -p "$STAGE/home" "$STAGE/run" "$STAGE/work" "$STAGE/adapter-old" "$STAGE/adapter-new"
echo "$STAGE" > "$BENCH/current-stage"

cd "$BENCH"
env -i PATH=/Users/hootie/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=/Users/hootie \
  FAKE_PORT=7899 FAKE_DELTAS="$DELTAS" FAKE_CHUNK="$CHUNK" FAKE_CHUNK_MS="$CHUNK_MS" \
  FAKE_REPLACE_BYTES="$REPLACE" FAKE_BIG_DELTA_BYTES="$BIG_DELTA" FAKE_MODEL=gpt-5.5 FAKE_SKIP_BODY=1 \
  FAKE_LOG="$STAGE/fake-provider.log" \
  nohup bun "$BENCH/fake-provider.ts" > "$STAGE/fake-provider.out" 2>&1 &
echo $! > "$BENCH/fake-provider.pid"
disown

for i in $(seq 1 60); do curl -sf http://127.0.0.1:7899/health >/dev/null && break; sleep 0.2; done
curl -sf http://127.0.0.1:7899/health >/dev/null || { echo "FAIL: fake provider"; exit 1; }

cd "$STAGE"
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=/Users/hootie \
  JCODE_HOME="$STAGE/home" JCODE_RUNTIME_DIR="$STAGE/run" \
  JCODE_SOCKET="$STAGE/run/jcode.sock" JCODE_API_SOCKET="$STAGE/run/jcode-api.sock" \
  JCODE_NO_TELEMETRY=1 OPENAI_API_KEY=fake-bench-key \
  JCODE_OPENAI_API_BASE=http://127.0.0.1:7899/v1 JCODE_OPENAI_TRANSPORT=https \
  nohup "$JCODE" serve -p openai-api -m gpt-5.5 > "$STAGE/serve.log" 2>&1 &
echo $! > "$STAGE/serve.pid"
disown
for i in $(seq 1 100); do [ -S "$STAGE/run/jcode.sock" ] && break; sleep 0.2; done
[ -S "$STAGE/run/jcode.sock" ] || { echo "FAIL: daemon socket"; tail -20 "$STAGE/serve.log"; exit 1; }

env -i PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=/Users/hootie \
  JCODE_HOME="$STAGE/home" JCODE_RUNTIME_DIR="$STAGE/run" \
  JCODE_SOCKET="$STAGE/run/jcode.sock" JCODE_API_SOCKET="$STAGE/run/jcode-api.sock" \
  JCODE_NO_TELEMETRY=1 OPENAI_API_KEY=fake-bench-key \
  JCODE_OPENAI_API_BASE=http://127.0.0.1:7899/v1 JCODE_OPENAI_TRANSPORT=https \
  nohup "$JCODE" api-bridge --api-socket "$STAGE/run/jcode-api.sock" > "$STAGE/api.log" 2>&1 &
echo $! > "$STAGE/api.pid"
disown
for i in $(seq 1 100); do [ -S "$STAGE/run/jcode-api.sock" ] && break; sleep 0.2; done
[ -S "$STAGE/run/jcode-api.sock" ] || { echo "FAIL: api socket"; tail -20 "$STAGE/api.log"; exit 1; }

start_adapter() {
  local name="$1" bin="$2" port="$3" code="$4"
  env -i PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=/Users/hootie \
    JCODE_HOME="$STAGE/home" JCODE_RUNTIME_DIR="$STAGE/run" \
    JCODE_SOCKET="$STAGE/run/jcode.sock" JCODE_API_SOCKET="$STAGE/run/jcode-api.sock" \
    JCODE_NO_TELEMETRY=1 \
    JCODE_ADAPTER_BIND="127.0.0.1:$port" JCODE_ADAPTER_DATA_DIR="$STAGE/adapter-$name" \
    JCODE_ADAPTER_ALLOWED_ROOTS="$STAGE/work" JCODE_ADAPTER_DEFAULT_WORKDIR="$STAGE/work" \
    JCODE_ADAPTER_PAIRING_CODE="$code" JCODE_ADAPTER_NAME="JCode Mobile Bench $name" \
    nohup "$bin" > "$STAGE/adapter-$name.log" 2>&1 &
  echo $! > "$STAGE/adapter-$name.pid"
  disown
}

start_adapter old "$OLD_ADAPTER" 7655 "$OLD_CODE"
start_adapter new "$NEW_ADAPTER" 7656 "$NEW_CODE"

for i in $(seq 1 120); do
  curl -sf http://127.0.0.1:7655/health >/dev/null && curl -sf http://127.0.0.1:7656/health >/dev/null && break
  sleep 0.2
done
curl -sf http://127.0.0.1:7655/health >/dev/null || { echo "FAIL: old adapter"; tail -20 "$STAGE/adapter-old.log"; exit 1; }
curl -sf http://127.0.0.1:7656/health >/dev/null || { echo "FAIL: new adapter"; tail -20 "$STAGE/adapter-new.log"; exit 1; }

echo "stage=$STAGE deltas=$DELTAS chunk=$CHUNK chunk_ms=$CHUNK_MS replace=$REPLACE big_delta=$BIG_DELTA"
echo "old_code=$OLD_CODE new_code=$NEW_CODE"
curl -s http://127.0.0.1:7655/health; echo
curl -s http://127.0.0.1:7656/health; echo
