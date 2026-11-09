#!/usr/bin/env bash
# Run adapter tests against the isolated staging daemon.
set -euo pipefail

STAGE="${JCODE_STAGING_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/jcode-mobile-staging}"
export JCODE_HOME="$STAGE/home"
export JCODE_RUNTIME_DIR="$STAGE/run"
export JCODE_SOCKET="$STAGE/run/jcode.sock"
export JCODE_API_SOCKET="$STAGE/run/jcode-api.sock"
export JCODE_ADAPTER_STATE="$STAGE/adapter"
export STAGING_WORK_DIR="$STAGE/work"
export JCODE_STAGING_DIR="$STAGE"
export ADAPTER_BASE="${ADAPTER_BASE:-http://127.0.0.1:7643}"

cd "$(dirname "$0")/.."
exec bun "$@"
