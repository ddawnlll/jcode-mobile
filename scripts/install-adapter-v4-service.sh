#!/usr/bin/env bash
# Install the JCode Mobile Adapter v4 (0.5.0) as per-user systemd services.
#
# This replaces the Adapter v2 (0.3.1) user services that are still running on
# 127.0.0.1:7644 behind Caddy. Nothing here needs root: the only root-owned
# unit in the history is the legacy 0.2.2 system unit
# `jcode-mobile-adapter.service`, which must already be stopped and disabled.
#
# Services installed:
#   jcode-mobile-api-bridge.service   harness API bridge -> JCode daemon
#   jcode-mobile-adapter-v4.service   Rust Adapter v4 on 127.0.0.1:7644
#
# Services left installed but disabled, for rollback:
#   jcode-mobile-adapter-v2.service   Adapter v2 (0.3.1)
#
# The adapter names are aliases for the same versioned server, so a v2 unit
# file that was left pointing at `jcode-adapter-v2` keeps working. It is
# disabled here only so it cannot race for the port after a reboot.
#
# Config is read from the environment, with the deployment defaults baked in:
#   JCODE_MOBILE_DATA_DIR  adapter data directory (default ~/.jcode/mobile-adapter-v2)
#   JCODE_MOBILE_PORT      bind port on loopback   (default 7644)
#   JCODE_MOBILE_ORIGINS   allowed browser origins (default https://dawnll.duckdns.org)
#   JCODE_BIN              JCode binary used by the harness API bridge
#
# Build first (the script does not build):
#   cargo build --release --locked -p adapter-server --bin jcode-adapter-v4
#   (cd apps/stillness && bun run build)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ADAPTER_BIN="$ROOT/target/release/jcode-adapter-v4"
WEB_DIR="$ROOT/apps/stillness/dist"
JCODE_BIN="${JCODE_BIN:-/home/quant/local/opt/jcode-0.99.1/jcode-linux-x86_64.bin}"
# The data directory name is retained from Adapter v2 on purpose: the schema is
# extended in place with CREATE TABLE IF NOT EXISTS, so paired device tokens and
# the server_id survive the upgrade and the phone does not have to re-pair.
DATA_DIR="${JCODE_MOBILE_DATA_DIR:-$HOME/.jcode/mobile-adapter-v2}"
API_SOCKET="$DATA_DIR/api.sock"
PORT="${JCODE_MOBILE_PORT:-7644}"
ORIGINS="${JCODE_MOBILE_ORIGINS:-https://dawnll.duckdns.org}"
UID_NUM="$(id -u)"
RUNTIME_DIR="/run/user/$UID_NUM"

if [ ! -x "$ADAPTER_BIN" ]; then
  echo "missing $ADAPTER_BIN" >&2
  echo "run: cargo build --release --locked -p adapter-server --bin jcode-adapter-v4" >&2
  exit 1
fi
if [ ! -f "$WEB_DIR/index.html" ]; then
  echo "missing $WEB_DIR" >&2
  echo "run: (cd apps/stillness && bun run build)" >&2
  exit 1
fi
if [ ! -x "$JCODE_BIN" ]; then
  echo "missing JCode binary $JCODE_BIN" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR" "$DATA_DIR"

cat > "$UNIT_DIR/jcode-mobile-api-bridge.service" <<EOF
[Unit]
Description=JCode harness API bridge for JCode Mobile Adapter v4
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=JCODE_HOME=$HOME/.jcode
Environment=JCODE_RUNTIME_DIR=$RUNTIME_DIR
Environment=JCODE_SOCKET=$RUNTIME_DIR/jcode.sock
ExecStart=$JCODE_BIN api --api-socket $API_SOCKET
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

# JCODE_API_SOCKET is the harness bridge (inventory, archive, restore).
# JCODE_SOCKET is the daemon's own native socket. Adapter v4 also opens native
# per-session links, and that path is required. It must not default to a
# jcode.sock beside the bridge socket, which does not exist.
cat > "$UNIT_DIR/jcode-mobile-adapter-v4.service" <<EOF
[Unit]
Description=JCode Mobile Adapter v4 (0.5.0, protocol 4)
After=network-online.target jcode-mobile-api-bridge.service
Wants=network-online.target jcode-mobile-api-bridge.service

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=JCODE_HOME=$HOME/.jcode
Environment=JCODE_RUNTIME_DIR=$RUNTIME_DIR
Environment=JCODE_SOCKET=$RUNTIME_DIR/jcode.sock
Environment=JCODE_ADAPTER_BIND=127.0.0.1:$PORT
Environment=JCODE_ADAPTER_DATA_DIR=$DATA_DIR
Environment=JCODE_API_SOCKET=$API_SOCKET
Environment=JCODE_ADAPTER_ALLOWED_ROOTS=$HOME
Environment=JCODE_ADAPTER_DEFAULT_WORKDIR=$HOME
Environment=JCODE_ADAPTER_WEB_DIR=$WEB_DIR
Environment=JCODE_ADAPTER_ALLOWED_ORIGINS=$ORIGINS
Environment=RUST_LOG=info
ExecStart=$ADAPTER_BIN
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable jcode-mobile-api-bridge.service jcode-mobile-adapter-v4.service

# Retire the v2 service only after the v4 unit exists, so the port is never
# unowned for longer than one restart.
for old in jcode-mobile-adapter-v2.service; do
  if systemctl --user list-unit-files "$old" >/dev/null 2>&1 &&
     systemctl --user cat "$old" >/dev/null 2>&1; then
    systemctl --user disable --now "$old" >/dev/null 2>&1 || true
    echo "retired $old (unit file kept for rollback)"
  fi
done

systemctl --user restart jcode-mobile-api-bridge.service
systemctl --user restart jcode-mobile-adapter-v4.service

for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo
echo "adapter health:"
curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" || {
  echo "health endpoint did not answer, see: journalctl --user -u jcode-mobile-adapter-v4.service -n 40" >&2
  exit 1
}
echo
echo
echo "pairing code (valid 10 minutes, single use):"
# The last match is this run's code, not one from an earlier restart.
journalctl --user -u jcode-mobile-adapter-v4.service -n 60 --no-pager 2>/dev/null |
  grep "Pairing code" | tail -1 ||
  echo "see: journalctl --user -u jcode-mobile-adapter-v4.service -n 60"

echo
echo "rollback:"
echo "  systemctl --user disable --now jcode-mobile-adapter-v4.service"
echo "  systemctl --user enable --now jcode-mobile-adapter-v2.service"
echo "The 0.3.1 binary ignores the v4 tables and reuses the same data directory."
