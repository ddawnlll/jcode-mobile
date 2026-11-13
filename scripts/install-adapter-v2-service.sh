#!/usr/bin/env bash
# Install the JCode Mobile Adapter v2 (0.3.1) as per-user systemd services.
#
# The 0.2.2 TypeScript adapter runs from the system unit
# `jcode-mobile-adapter.service`, which needs root to stop or disable. This
# script installs the 0.3.1 pair under the user manager instead, so no step
# here requires sudo. Linger is enabled for this account, so the services
# start at boot and survive logout.
#
# Services:
#   jcode-mobile-api-bridge.service  harness API bridge -> JCode daemon
#   jcode-mobile-adapter-v2.service  Rust Adapter v2 on 127.0.0.1:7644
#
# The adapter serves the Stillness 12 web build and the v2 API on the same
# origin Caddy already proxies (https://dawnll.duckdns.org).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ADAPTER_BIN="$ROOT/target/release/jcode-adapter-v2"
WEB_DIR="$ROOT/apps/stillness/dist"
JCODE_BIN="${JCODE_BIN:-/home/quant/local/opt/jcode-0.99.1/jcode-linux-x86_64.bin}"
DATA_DIR="${JCODE_MOBILE_DATA_DIR:-$HOME/.jcode/mobile-adapter-v2}"
API_SOCKET="$DATA_DIR/api.sock"
PORT="${JCODE_MOBILE_PORT:-7644}"
ORIGINS="${JCODE_MOBILE_ORIGINS:-https://dawnll.duckdns.org}"

if [ ! -x "$ADAPTER_BIN" ]; then
  echo "missing $ADAPTER_BIN; run: cargo build --release -p adapter-server --bin jcode-adapter-v2" >&2
  exit 1
fi
if [ ! -f "$WEB_DIR/index.html" ]; then
  echo "missing $WEB_DIR; run: (cd apps/stillness && bun run build)" >&2
  exit 1
fi
if [ ! -x "$JCODE_BIN" ]; then
  echo "missing JCode binary $JCODE_BIN" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR" "$DATA_DIR"

cat > "$UNIT_DIR/jcode-mobile-api-bridge.service" <<EOF
[Unit]
Description=JCode harness API bridge for JCode Mobile Adapter v2
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=JCODE_HOME=$HOME/.jcode
Environment=JCODE_RUNTIME_DIR=/run/user/$(id -u)
Environment=JCODE_SOCKET=/run/user/$(id -u)/jcode.sock
ExecStart=$JCODE_BIN api --api-socket $API_SOCKET
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/jcode-mobile-adapter-v2.service" <<EOF
[Unit]
Description=JCode Mobile Adapter v2 (0.3.1)
After=network-online.target jcode-mobile-api-bridge.service
Wants=network-online.target jcode-mobile-api-bridge.service

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=JCODE_HOME=$HOME/.jcode
Environment=JCODE_RUNTIME_DIR=/run/user/$(id -u)
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
systemctl --user enable jcode-mobile-api-bridge.service jcode-mobile-adapter-v2.service
systemctl --user restart jcode-mobile-api-bridge.service
systemctl --user restart jcode-mobile-adapter-v2.service

for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo "adapter health:"
curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" || true
echo
echo
echo "pairing code (valid 10 minutes, single use):"
systemctl --user show jcode-mobile-adapter-v2.service -p ExecStart >/dev/null 2>&1 || true
journalctl --user -u jcode-mobile-adapter-v2.service -n 40 --no-pager 2>/dev/null |
  grep -m1 "Pairing code" || echo "see: journalctl --user -u jcode-mobile-adapter-v2.service -n 40"

echo
echo "Legacy 0.2.2 system unit still holds the name jcode-mobile-adapter.service."
if systemctl is-enabled jcode-mobile-adapter.service >/dev/null 2>&1 &&
   [ "$(systemctl is-active jcode-mobile-adapter.service 2>/dev/null)" = "active" ]; then
  echo "Stop and disable it once with:"
  echo "  sudo systemctl disable --now jcode-mobile-adapter.service"
elif systemctl is-enabled jcode-mobile-adapter.service >/dev/null 2>&1; then
  echo "Disable it so it does not race for port $PORT at boot:"
  echo "  sudo systemctl disable jcode-mobile-adapter.service"
fi
