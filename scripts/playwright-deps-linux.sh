#!/usr/bin/env bash
# Install Chromium's shared libraries for Playwright without root.
#
# Debian/Ubuntu hosts that allow `sudo npx playwright install-deps chromium`
# should use that instead. This script is for locked-down VPS accounts where
# apt works read-only: it downloads the .deb files, extracts them under
# ~/playwright-deps, and prints the LD_LIBRARY_PATH to use.
set -euo pipefail

PREFIX="${PLAYWRIGHT_DEPS_DIR:-$HOME/playwright-deps}"
LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"
DEBS="${PLAYWRIGHT_DEBS_DIR:-${JCODE_SCRATCH_DIR:-/tmp}/playwright-debs}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script handles Debian/Ubuntu only. On other Linux use the" >&2
  echo "distribution's package manager, or run Playwright in a container." >&2
  exit 1
fi

CHROME="${PLAYWRIGHT_CHROME_BIN:-$HOME/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell}"
if [ ! -x "$CHROME" ]; then
  # Fall back to the first installed headless shell.
  CHROME="$(find "$HOME/.cache/ms-playwright" -path '*chrome-headless-shell-linux64/chrome-headless-shell' -type f 2>/dev/null | head -1)"
fi

if [ -x "$CHROME" ] && LD_LIBRARY_PATH="$LIBDIR" ldd "$CHROME" 2>/dev/null | grep -q 'not found'; then
  :
elif [ -x "$CHROME" ] && [ -d "$LIBDIR" ] && [ -f "$PREFIX/etc/fonts/fonts.conf" ]; then
  echo "Playwright browser libraries already resolve under $LIBDIR"
  echo "export LD_LIBRARY_PATH=\"$LIBDIR\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}\""
  exit 0
fi

mkdir -p "$DEBS" "$PREFIX"

download() {
  local name
  for name in "$@"; do
    if ls "$DEBS/${name}_"*.deb >/dev/null 2>&1; then return 0; fi
    if (cd "$DEBS" && apt-get download "$name" >/dev/null 2>&1); then return 0; fi
  done
  echo "could not download any of: $*" >&2
  return 1
}

# Package names differ between Debian releases (t64 transition) and Ubuntu.
download libasound2t64 libasound2
download libatk1.0-0t64 libatk1.0-0
download libatk-bridge2.0-0t64 libatk-bridge2.0-0
download libatspi2.0-0t64 libatspi2.0-0
download libgbm1
download libxcomposite1
download libxdamage1
download libxfixes3
download libxkbcommon0
download libxrandr2
download libdrm2
download libxi6
download libxrender1
download libfontconfig1
download fonts-dejavu-core
download fonts-dejavu-mono

for deb in "$DEBS"/*.deb; do
  dpkg -x "$deb" "$PREFIX"
done

# Chromium's headless shell refuses web fonts when fontconfig is absent. Keep a
# private fontconfig configuration and DejaVu so text renders in the rootless
# Playwright target.
mkdir -p "$PREFIX/etc/fonts" "$PREFIX/cache/fontconfig"
cat > "$PREFIX/etc/fonts/fonts.conf" <<FONTCONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$PREFIX/usr/share/fonts</dir>
  <cachedir>$PREFIX/cache/fontconfig</cachedir>
</fontconfig>
FONTCONF

if [ -x "$CHROME" ]; then
  missing="$(LD_LIBRARY_PATH="$LIBDIR" ldd "$CHROME" 2>/dev/null | grep 'not found' || true)"
  if [ -n "$missing" ]; then
    echo "Chromium still needs libraries:" >&2
    echo "$missing" >&2
    exit 1
  fi
fi

cat <<EOF
Playwright browser libraries are under:
  $LIBDIR

Run Playwright with:
  export LD_LIBRARY_PATH="$LIBDIR\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
  export FONTCONFIG_FILE="$PREFIX/etc/fonts/fonts.conf"

scripts/run-e2e.sh and scripts/stillness-e2e.sh set these automatically.
EOF
