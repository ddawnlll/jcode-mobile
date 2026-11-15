#!/usr/bin/env bash
# Stillness production build A/B: v0.4.0 vs 0.5.0 candidate.
# Alternates revisions per round to spread thermal/load bias evenly.
set -euo pipefail
BENCH=/Users/hootie/.jcode/scratch/bench
OUT="$BENCH/results-build.tsv"
printf 'round\trevision\treal_s\tuser_s\tsys_s\tvite_ms\tjs_raw\tjs_gzip\tjs_brotli\tcss_raw\tcss_gzip\tdeferred_raw\tdeferred_gzip\tdeferred_brotli\tsha256\n' > "$OUT"

for round in 1 2 3 4; do
  for v in old new; do
    dir="$BENCH/$v/apps/stillness"
    cd "$dir"
    log="$BENCH/logs/build-$v-r$round.log"
    /usr/bin/time -p bun run build > "$log" 2>&1
    real=$(awk '/^real /{print $2}' "$log")
    user=$(awk '/^user /{print $2}' "$log")
    sys=$(awk '/^sys /{print $2}' "$log")
    vite_ms=$(grep -oE 'built in [0-9.]+m?s' "$log" | tail -1 || true)
    entry=$(grep -oE 'src="/assets/[^"]+\.js"' dist/index.html | sed 's/src="\///;s/"//')
    css=$(grep -oE 'href="/assets/[^"]+\.css"' dist/index.html | sed 's/href="\///;s/"//')
    js_raw=$(stat -f%z "dist/$entry")
    js_gzip=$(gzip -9 -c "dist/$entry" | wc -c | tr -d ' ')
    js_brotli=$(node -e 'const z=require("zlib"),f=require("fs");process.stdout.write(String(z.brotliCompressSync(f.readFileSync(process.argv[1])).length))' "dist/$entry")
    css_raw=$(stat -f%z "dist/$css")
    css_gzip=$(gzip -9 -c "dist/$css" | wc -c | tr -d ' ')
    deferred=$(ls dist/assets/RichMarkdown-*.js 2>/dev/null | head -1 || true)
    if [ -n "$deferred" ]; then
      d_raw=$(stat -f%z "$deferred")
      d_gzip=$(gzip -9 -c "$deferred" | wc -c | tr -d ' ')
      d_brotli=$(node -e 'const z=require("zlib"),f=require("fs");process.stdout.write(String(z.brotliCompressSync(f.readFileSync(process.argv[1])).length))' "$deferred")
    else
      d_raw=0; d_gzip=0; d_brotli=0
    fi
    sha=$(shasum -a 256 "dist/$entry" | awk '{print $1}')
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$round" "$v" "$real" "$user" "$sys" "$vite_ms" "$js_raw" "$js_gzip" "$js_brotli" "$css_raw" "$css_gzip" "$d_raw" "$d_gzip" "$d_brotli" "$sha" >> "$OUT"
  done
done
cat "$OUT"
