#!/usr/bin/env bash
# Start an isolated JCode daemon for mobile integration tests.
#
# Isolation: a private JCODE_HOME (sessions, archive state, device registry) and
# a private runtime dir (daemon/API sockets). Provider credentials are inherited
# from the caller's environment only; no credential file is copied or printed.
# The production daemon and its sessions are never touched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${JCODE_STAGING_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/jcode-mobile-staging}"
JCODE_BIN="${JCODE_BIN:-jcode}"
HOME_DIR="$STAGE/home"
RUN_DIR="$STAGE/run"
WORK_DIR="$STAGE/work"

mkdir -p "$HOME_DIR" "$RUN_DIR" "$WORK_DIR"
chmod 700 "$HOME_DIR" "$RUN_DIR" "$WORK_DIR"
if [ ! -f "$HOME_DIR/config.toml" ] && [ -f "$HOME/.jcode/config.toml" ]; then
  cp "$HOME/.jcode/config.toml" "$HOME_DIR/config.toml"
  chmod 600 "$HOME_DIR/config.toml"
fi

# Local-only credential snapshot so the isolated daemon can reach the same
# provider without sharing production state. Never printed, mode 0600, and it
# lives outside the repository. Delete the staging dir to remove it.
snapshot_credential() {
  local name="$1"
  if [ -f "$HOME/.jcode/$name" ] && [ ! -e "$HOME_DIR/$name" ]; then
    cp "$HOME/.jcode/$name" "$HOME_DIR/$name"
    chmod 600 "$HOME_DIR/$name"
  fi
}
snapshot_credential openai-auth.json
snapshot_credential auth-refresh-state.json
snapshot_credential command_code_accounts.json

export JCODE_HOME="$HOME_DIR"
export JCODE_RUNTIME_DIR="$RUN_DIR"
export JCODE_SOCKET="$RUN_DIR/jcode.sock"
export JCODE_API_SOCKET="$RUN_DIR/jcode-api.sock"

if [ -S "$JCODE_SOCKET" ] && "$JCODE_BIN" debug --socket "$JCODE_SOCKET" state >/dev/null 2>&1; then
  echo "staging daemon already running at $JCODE_SOCKET"
else
  echo "starting staging daemon (JCODE_HOME=$JCODE_HOME, binary=$JCODE_BIN)"
  nohup "$JCODE_BIN" serve >"$STAGE/serve.log" 2>&1 &
  echo $! >"$STAGE/serve.pid"
  for _ in $(seq 1 60); do
    if [ -S "$JCODE_SOCKET" ]; then break; fi
    if ! kill -0 "$(cat "$STAGE/serve.pid")" 2>/dev/null; then
      echo "staging daemon exited before creating a socket; see $STAGE/serve.log" >&2
      exit 1
    fi
    sleep 0.5
  done
  if [ ! -S "$JCODE_SOCKET" ]; then
    echo "staging daemon did not produce a socket; see $STAGE/serve.log" >&2
    exit 1
  fi
fi

# The harness API bridge is a separate process in this JCode revision. The
# adapter's curated SDK talks to this socket, not to the legacy daemon socket.
if [ -S "$JCODE_API_SOCKET" ] && [ -f "$STAGE/api.pid" ] && kill -0 "$(cat "$STAGE/api.pid")" 2>/dev/null; then
  echo "staging harness API already listening at $JCODE_API_SOCKET"
else
  rm -f "$JCODE_API_SOCKET"
  echo "starting staging harness API bridge (socket=$JCODE_API_SOCKET)"
  nohup "$JCODE_BIN" api >"$STAGE/api.log" 2>&1 &
  echo $! >"$STAGE/api.pid"
  for _ in $(seq 1 120); do
    if [ -S "$JCODE_API_SOCKET" ]; then break; fi
    if ! kill -0 "$(cat "$STAGE/api.pid")" 2>/dev/null; then
      echo "staging harness API exited before creating a socket; see $STAGE/api.log" >&2
      tail -30 "$STAGE/api.log" >&2 || true
      exit 1
    fi
    sleep 0.25
  done
  if [ ! -S "$JCODE_API_SOCKET" ]; then
    echo "staging harness API did not produce a socket; see $STAGE/api.log" >&2
    tail -30 "$STAGE/api.log" >&2 || true
    exit 1
  fi
fi

echo "$STAGE"
