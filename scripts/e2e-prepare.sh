#!/usr/bin/env bash
# Prepare the isolated web e2e environment:
#   1. an isolated JCode daemon and adapter (never the production daemon)
#   2. a web bundle built with EXPO_PUBLIC_E2E=1
#   3. a static server for that bundle
#
# Idempotent. Safe to run while developing; it only starts processes whose
# ports are not already answering.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${JCODE_E2E_DIR:-$ROOT/.staging/e2e}"
DAEMON_STAGE="${JCODE_E2E_DAEMON_DIR:-$ROOT/.staging/jcode}"
ADAPTER_PORT="${JCODE_E2E_ADAPTER_PORT:-7645}"
WEB_PORT="${JCODE_E2E_WEB_PORT:-8091}"

mkdir -p "$STAGE"

# 1. Isolated daemon. staging-up.sh reuses a live socket and copies only the
# local provider config; it never touches the production JCode home.
JCODE_STAGING_DIR="$DAEMON_STAGE" bash "$ROOT/scripts/staging-up.sh" >/dev/null

export JCODE_HOME="$DAEMON_STAGE/home"
export JCODE_RUNTIME_DIR="$DAEMON_STAGE/run"
export JCODE_SOCKET="$DAEMON_STAGE/run/jcode.sock"
export JCODE_API_SOCKET="$DAEMON_STAGE/run/jcode-api.sock"
export JCODE_ADAPTER_HOST=127.0.0.1
export JCODE_ADAPTER_PORT="$ADAPTER_PORT"
export JCODE_ADAPTER_STATE="$STAGE/adapter"

# 2. Adapter for the isolated daemon.
if ! curl -sf "http://127.0.0.1:$ADAPTER_PORT/health" >/dev/null; then
  echo "starting e2e adapter on 127.0.0.1:$ADAPTER_PORT"
  setsid -f bash -c "echo \$\$ > '$STAGE/adapter.pid'; exec env \
    JCODE_HOME='$JCODE_HOME' \
    JCODE_RUNTIME_DIR='$JCODE_RUNTIME_DIR' \
    JCODE_SOCKET='$JCODE_SOCKET' \
    JCODE_API_SOCKET='$JCODE_API_SOCKET' \
    JCODE_ADAPTER_HOST='$JCODE_ADAPTER_HOST' \
    JCODE_ADAPTER_PORT='$JCODE_ADAPTER_PORT' \
    JCODE_ADAPTER_STATE='$JCODE_ADAPTER_STATE' \
    node '$ROOT/integration/jcode-adapter/src/main.ts'" \
    >"$STAGE/adapter.log" 2>&1 </dev/null
fi

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$ADAPTER_PORT/health" >/dev/null; then break; fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:$ADAPTER_PORT/health" >/dev/null; then
  echo "e2e adapter did not become healthy; see $STAGE/adapter.log" >&2
  tail -20 "$STAGE/adapter.log" >&2 || true
  exit 1
fi

# 3. Test bundle. EXPO_PUBLIC_E2E is inlined at build time; the normal export
# cannot contain the seed path.
echo "exporting e2e web bundle"
(
  cd "$ROOT"
  EXPO_PUBLIC_E2E=1 CI=1 npx expo export -p web --output-dir "$STAGE/web" \
    >"$STAGE/export.log" 2>&1
)

# 4. Static server. serve-web.mjs adds the COOP/COEP headers expo-sqlite needs.
if ! curl -sf "http://127.0.0.1:$WEB_PORT/" >/dev/null; then
  echo "starting e2e web server on 127.0.0.1:$WEB_PORT"
  setsid -f bash -c "echo \$\$ > '$STAGE/web.pid'; exec env PORT=$WEB_PORT HOST=127.0.0.1 node '$ROOT/scripts/serve-web.mjs' '$STAGE/web'" \
    >"$STAGE/web.log" 2>&1 </dev/null
fi

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$WEB_PORT/" >/dev/null; then break; fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:$WEB_PORT/" >/dev/null; then
  echo "e2e web server did not become healthy; see $STAGE/web.log" >&2
  tail -20 "$STAGE/web.log" >&2 || true
  exit 1
fi

echo "e2e ready: web http://127.0.0.1:$WEB_PORT adapter http://127.0.0.1:$ADAPTER_PORT"
