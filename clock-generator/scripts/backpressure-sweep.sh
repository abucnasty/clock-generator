#!/bin/sh
# scripts/backpressure-sweep.sh <out dir> [processes, default 6]
# Every potential clock of every sample that holds its expected output, tried for backpressure loss (see
# backpressure-sample.js): one JSON a sample. Build first (`npx tsc`), and run `free -g` first. Then
# scripts/backpressure-table.py <out dir>.
here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
node -e 'console.log(require(process.argv[1] + "/lib").sampleKeys().join("\n"))' "$here" \
    | xargs -P "${2:-6}" -I{} node "$here/backpressure-sample.js" "$out" {} > /dev/null 2>&1
ls "$out" | wc -l
