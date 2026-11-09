#!/usr/bin/env bash
# Print the supported workflow for the machine this is run on.
# Read-only: it never installs, starts, or stops anything.
set -u

say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

say "JCode Mobile platform check"
say "========================"
say "kernel: $(uname -srm)"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  say "distro: ${PRETTY_NAME:-unknown}"
fi
say "bun:     $(bun --version 2>/dev/null || echo missing)"
say "jcode:   $(jcode --version 2>/dev/null | head -1 || echo missing)"
say "gh:      $(gh --version 2>/dev/null | head -1 || echo missing)"
say ""

install_hint() {
  if [ -d "$HOME/playwright-deps/usr/lib/x86_64-linux-gnu" ]; then
    say "playwright libs: local prefix already present"
  else
    say "playwright libs: not in ~/playwright-deps"
  fi
}

case "$(uname -s)" in
  Darwin)
    say "Host: macOS"
    say "Use: native iOS/Android development plus the web e2e target."
    say ""
    say "  xcode-select -p                       # full Xcode required"
    say "  bun install --frozen-lockfile"
    say "  bunx --bun playwright install --with-deps chromium"
    say "  bun run check                         # tsc + eslint + jest"
    say "  bun run e2e                           # no LD_LIBRARY_PATH needed"
    say "  bun run ios                           # expo run:ios"
    say "  bun run android                       # expo run:android"
    ;;
  Linux)
    if [ -r /etc/debian_version ] || grep -qi 'ubuntu' /etc/os-release 2>/dev/null; then
      say "Host: Debian/Ubuntu Linux"
      if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
        say "Use: VPS/web e2e. Native iOS is unavailable; Android needs the SDK."
        say ""
        say "  bun install --frozen-lockfile"
        say "  bunx --bun playwright install chromium"
        say "  bunx --bun playwright install-deps chromium   # works here"
        say "  bun run check"
        say "  bun run e2e"
      else
        say "Use: VPS/web e2e with rootless Playwright libraries."
        say ""
        say "  bun install --frozen-lockfile"
        say "  bunx --bun playwright install chromium"
        say "  bash scripts/playwright-deps-linux.sh"
        say "  bun run check"
        say "  bun run e2e                           # run-e2e.sh sets LD_LIBRARY_PATH"
      fi
      install_hint
      say ""
      say "  Adapter only:  JCODE_ADAPTER_PORT=7644 bun integration/jcode-adapter/src/main.ts"
      say "  Web build:     CI=1 bunx --bun expo export -p web --output-dir dist/web"
      say "  Serve web:     bun --bun scripts/serve-web.mjs dist/web   # needs COOP/COEP"
    else
      say "Host: other Linux"
      say "Use: VPS/web e2e. Install Chromium dependencies with the distro package"
      say "manager (dnf, zypper, pacman), or use the Debian rootless script inside"
      say "a container. Native iOS is unavailable; Android needs the SDK."
      say ""
      say "  bun install --frozen-lockfile"
      say "  bunx --bun playwright install chromium"
      say "  bun run check"
      say "  bun run e2e"
      install_hint
    fi
    ;;
  *)
    say "Host: $(uname -s)"
    say "Unsupported for native builds. Use WSL2 on Windows, or a Linux/macOS"
    say "machine for the web e2e target."
    ;;
esac

if have adb; then say ""; say "android: $(adb version 2>/dev/null | head -1)"; fi
if have xcrun; then say "xcode:   $(xcodebuild -version 2>/dev/null | head -1)"; fi
