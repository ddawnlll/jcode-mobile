#!/usr/bin/env bash
# Print the adapter's current pairing code, or rotate it and print the new one.
#
# The code itself is never stored: only its hash is, so the plaintext code
# exists only in the adapter's own log line. This script reads that line and
# then checks the stored row to say whether the code is still valid, instead of
# printing a code that has already expired or been replaced.
#
# Usage:
#   bash scripts/adapter-pairing-code.sh            # show the current code
#   bash scripts/adapter-pairing-code.sh --rotate   # restart the adapter first
set -euo pipefail

UNIT="${JCODE_MOBILE_UNIT:-jcode-mobile-adapter-v4.service}"
PORT="${JCODE_MOBILE_PORT:-7644}"
DATA_DIR="${JCODE_MOBILE_DATA_DIR:-$HOME/.jcode/mobile-adapter-v2}"
DB="$DATA_DIR/adapter-v2.sqlite3"
ROTATE="${1:-}"

if [ "$ROTATE" = "--rotate" ]; then
  systemctl --user restart "$UNIT"
  for _ in $(seq 1 60); do
    curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

if [ ! -f "$DB" ]; then
  echo "no adapter database at $DB" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required to check the code's stored state" >&2
  exit 1
fi

# Newest printed code wins. A restart invalidates every earlier one.
code="$(journalctl --user -u "$UNIT" -n 400 --no-pager 2>/dev/null |
  grep -oE 'single use\): [A-Za-z0-9-]+' | tail -1 | awk '{print $NF}')"
if [ -z "$code" ]; then
  echo "no pairing code in the log for $UNIT" >&2
  echo "start it first: systemctl --user start $UNIT" >&2
  exit 1
fi

# Matching normalizes the code: keep alphanumerics, then upper-case.
normalized="$(printf '%s' "$code" | tr -cd 'A-Za-z0-9' | tr '[:lower:]' '[:upper:]')"
hash="$(printf '%s' "$normalized" | sha256sum | awk '{print $1}')"
now_ms="$(( $(date +%s) * 1000 ))"

row="$(sqlite3 "$DB" \
  "SELECT CASE WHEN used_at_ms IS NOT NULL THEN 'used'
               WHEN expires_at_ms <= $now_ms THEN 'expired'
               ELSE 'valid' END || '|' || expires_at_ms
   FROM pairing_codes WHERE code_hash = '$hash' LIMIT 1;" 2>/dev/null || true)"

state="${row%%|*}"
expires_ms="${row##*|}"
remaining=""
if [ -n "$row" ] && [ "$expires_ms" != "$row" ]; then
  remaining="$(( (expires_ms - now_ms) / 1000 ))"
fi

echo "server:  https://dawnll.duckdns.org"
echo "code:    $code"
case "$state" in
  valid)
    echo "state:   valid, single use, ${remaining}s left ($(( remaining / 60 ))m $(( remaining % 60 ))s)"
    ;;
  expired)
    echo "state:   EXPIRED ${remaining#-}s ago; rotate it: bash scripts/adapter-pairing-code.sh --rotate" >&2
    exit 2
    ;;
  used)
    echo "state:   already used; rotate it: bash scripts/adapter-pairing-code.sh --rotate" >&2
    exit 2
    ;;
  *)
    echo "state:   no stored row for this code (it was replaced by a later adapter start)" >&2
    echo "         rotate it: bash scripts/adapter-pairing-code.sh --rotate" >&2
    exit 2
    ;;
esac
