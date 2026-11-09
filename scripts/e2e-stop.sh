#!/usr/bin/env bash
# Stop the static web server started by e2e-prepare.sh. The isolated daemon and
# adapter are intentionally left running so repeated runs stay fast; use
# JCODE_E2E_STOP_ALL=1 to stop those too.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${JCODE_E2E_DIR:-$ROOT/.staging/e2e}"

if [ -f "$STAGE/web.pid" ]; then
  pid="$(cat "$STAGE/web.pid")"
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  rm -f "$STAGE/web.pid"
fi

if [ "${JCODE_E2E_STOP_ALL:-0}" = "1" ] && [ -f "$STAGE/adapter.pid" ]; then
  pid="$(cat "$STAGE/adapter.pid")"
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  rm -f "$STAGE/adapter.pid"
fi
