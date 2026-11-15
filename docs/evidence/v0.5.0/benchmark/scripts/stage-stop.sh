#!/usr/bin/env bash
# Stop the benchmark stack and clear its reserved ports.
set -euo pipefail
BENCH=/Users/hootie/.jcode/scratch/bench

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
  STAGE="$(cat "$BENCH/current-stage")"
  for pidfile in "$STAGE"/*.pid; do
    [ -f "$pidfile" ] || continue
    stop_pid "$(cat "$pidfile")"
  done
fi
if [ -f "$BENCH/fake-provider.pid" ]; then
  stop_pid "$(cat "$BENCH/fake-provider.pid")"
fi
for port in 7655 7656 7899; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -n1 kill -9 2>/dev/null || true
  fi
done
echo "benchmark stack stopped"
