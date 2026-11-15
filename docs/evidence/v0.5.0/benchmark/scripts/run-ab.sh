#!/usr/bin/env bash
# Run 3 old/new rounds against the currently running benchmark stage.
set -euo pipefail
BENCH=/Users/hootie/.jcode/scratch/bench
STAGE="$(cat "$BENCH/current-stage")"
TAG="$(basename "$STAGE")"
ROUNDS="${ROUNDS:-3}"
OLD_CODE="${OLD_CODE:-483101}"
NEW_CODE="${NEW_CODE:-483102}"
RESULTS="$BENCH/results/$TAG"
mkdir -p "$RESULTS"
export PATH=/Users/hootie/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
export HOME=/Users/hootie

run_one() {
  local label="$1" url="$2" protocol="$3" code="$4" out="$5" token="$6"
  echo "=== $label ==="
  env -i PATH="$PATH" HOME="$HOME" \
    ADAPTER_URL="$url" PAIR_CODE="$code" WORKDIR="$STAGE/work" \
    LABEL="$label" PROTOCOL="$protocol" PREWARM_MS="${PREWARM_MS:-3000}" \
    TOKEN_FILE="$token" OUT="$out" PROMPT=bench \
    MAX_MS="${MAX_MS:-60000}" IDLE_MS="${IDLE_MS:-1500}" \
    timeout 120 bun "$BENCH/bench-client.ts" > "$out.stdout" 2>&1 || {
      echo "FAILED $label"; tail -30 "$out.stdout"; return 1;
    }
  python3 - "$out" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print(json.dumps({k:m[k] for k in [
 'label','note','t_first_delta_ms','dispatch_to_first_delta_ms','first_to_last_delta_ms',
 'total_wall_ms','text_delta_count','text_delta_bytes','session_event_frames',
 'ws_text_frames','ws_text_bytes','ws_binary_frames','ws_binary_bytes',
 'transport_bytes_descriptors','max_text_frame_bytes']}, indent=1))
print('event_kinds', m['event_kinds'])
PY
}

for round in $(seq 1 "$ROUNDS"); do
  run_one "old-r$round" http://127.0.0.1:7655 3 "$OLD_CODE" \
    "$RESULTS/old-r$round.json" "$RESULTS/token-old"
  run_one "new-r$round" http://127.0.0.1:7656 4 "$NEW_CODE" \
    "$RESULTS/new-r$round.json" "$RESULTS/token-new"
done
