#!/usr/bin/env bash
# Run Playwright with the local browser libraries when they are not installed
# system-wide. On macOS, or on Linux with Playwright's system dependencies,
# this is just an npx invocation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -d "$HOME/playwright-deps/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$HOME/playwright-deps/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec npx playwright test "$@"
