#!/usr/bin/env bash
# Start the mobile adapter against the isolated staging daemon.
set -euo pipefail

STAGE="${JCODE_STAGING_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/jcode-mobile-staging}"
export JCODE_HOME="$STAGE/home"
export JCODE_RUNTIME_DIR="$STAGE/run"
export JCODE_SOCKET="$STAGE/run/jcode.sock"
export JCODE_API_SOCKET="$STAGE/run/jcode-api.sock"
export JCODE_ADAPTER_STATE="$STAGE/adapter"
export JCODE_ADAPTER_PORT="${JCODE_ADAPTER_PORT:-7643}"
export JCODE_ADAPTER_HOST="${JCODE_ADAPTER_HOST:-127.0.0.1}"
export JCODE_ADAPTER_LOG="${JCODE_ADAPTER_LOG:-info}"

exec bun "$(dirname "$0")/../integration/jcode-adapter/src/main.ts"
