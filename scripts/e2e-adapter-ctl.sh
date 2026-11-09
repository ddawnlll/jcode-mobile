#!/usr/bin/env bash
# Start/stop/status the isolated e2e adapter. Never touches the production
# daemon or the live adapter on 7644.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${JCODE_E2E_DIR:-$ROOT/.staging/e2e}"
DAEMON_STAGE="${JCODE_E2E_DAEMON_DIR:-$ROOT/.staging/jcode}"
PORT="${JCODE_E2E_ADAPTER_PORT:-7645}"
ACTION="${1:-status}"

# Keep in sync with e2e-prepare.sh. Linux util-linux uses `setsid -f`; hosts
# without it (macOS) fall back to nohup. Both paths record the PID that execs
# the target so `stop` kills the right process.
launch_detached() {
  local pid_file="$1" log_file="$2"
  shift 2
  if command -v setsid >/dev/null 2>&1 && setsid -f true >/dev/null 2>&1; then
    setsid -f bash -c 'echo $$ > "$1"; shift; exec "$@"' _ "$pid_file" "$@" \
      >"$log_file" 2>&1 </dev/null
  else
    nohup bash -c 'exec "$@"' _ "$@" >"$log_file" 2>&1 </dev/null &
    echo $! >"$pid_file"
  fi
}

case "$ACTION" in
  status)
    if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then echo up; else echo down; fi
    ;;
  stop)
    if [ -f "$STAGE/adapter.pid" ]; then
      pid="$(cat "$STAGE/adapter.pid")"
      if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
      rm -f "$STAGE/adapter.pid"
    fi
    for _ in $(seq 1 40); do
      if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then break; fi
      sleep 0.25
    done
    echo down
    ;;
  start)
    if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then echo up; exit 0; fi
    mkdir -p "$STAGE"
    launch_detached "$STAGE/adapter.pid" "$STAGE/adapter.log" \
      env \
      JCODE_HOME="$DAEMON_STAGE/home" \
      JCODE_RUNTIME_DIR="$DAEMON_STAGE/run" \
      JCODE_SOCKET="$DAEMON_STAGE/run/jcode.sock" \
      JCODE_API_SOCKET="$DAEMON_STAGE/run/jcode-api.sock" \
      JCODE_ADAPTER_HOST=127.0.0.1 \
      JCODE_ADAPTER_PORT="$PORT" \
      JCODE_ADAPTER_STATE="$STAGE/adapter" \
      bun "$ROOT/integration/jcode-adapter/src/main.ts"
    for _ in $(seq 1 60); do
      if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then echo up; exit 0; fi
      sleep 0.25
    done
    echo "adapter did not start; see $STAGE/adapter.log" >&2
    exit 1
    ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
