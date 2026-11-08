#!/usr/bin/env bash
# Development helper: report whether the staging daemon can mint pairing codes.
# Prints the command result with any six-digit code redacted.
set -euo pipefail

STAGE="${JCODE_STAGING_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/jcode-mobile-staging}"
export JCODE_HOME="$STAGE/home"
export JCODE_RUNTIME_DIR="$STAGE/run"
export JCODE_SOCKET="$STAGE/run/jcode.sock"

jcode pair 2>&1 | sed -E 's/[0-9]{6}/<code>/g'
