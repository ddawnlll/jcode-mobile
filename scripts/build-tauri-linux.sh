#!/usr/bin/env bash
# Build the Stillness Tauri shell on Linux.
#
# System GTK 3 / WebKitGTK 4.1 development packages are preferred. When they
# are absent and no passwordless sudo exists, point TAURI_SYSROOT at a
# dpkg-extracted user prefix. The e2e evidence host uses exactly that fallback.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/stillness"
SYSROOT="${TAURI_SYSROOT:-$HOME/tauri-sysroot}"

if pkg-config --exists gtk+-3.0 webkit2gtk-4.1 2>/dev/null; then
  echo "using system GTK/WebKit development packages"
elif [ -d "$SYSROOT/usr" ]; then
  echo "using user-space GTK/WebKit prefix at $SYSROOT"
  export PKG_CONFIG_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu/pkgconfig:$SYSROOT/usr/share/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
  export PKG_CONFIG_SYSROOT_DIR="$SYSROOT"
  export LIBRARY_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu:$SYSROOT/usr/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
  export LD_LIBRARY_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu:$SYSROOT/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export PATH="$SYSROOT/usr/bin:$PATH"
  if ! pkg-config --exists gtk+-3.0 webkit2gtk-4.1 2>/dev/null; then
    echo "FAIL: $SYSROOT does not expose gtk+-3.0 and webkit2gtk-4.1 through pkg-config" >&2
    exit 1
  fi
else
  echo "BLOCKED: GTK 3 and WebKitGTK 4.1 development packages are missing." >&2
  echo "Install libgtk-3-dev libwebkit2gtk-4.1-dev, or set TAURI_SYSROOT to an extracted prefix." >&2
  exit 2
fi

cd "$APP"
# --no-bundle avoids AppImage/deb tooling downloads. The release binary is still
# produced under src-tauri/target/release/stillness.
exec bunx --bun tauri build --no-bundle "$@"
