#!/bin/sh
# scripts/backpressure-sweep.sh <out dir> [processes, default 6]
# Every stable potential clock of every sample, tried for backpressure loss (see backpressure-sample.js): one JSON a
# sample. Build first (`npx tsc`), and run `free -g` first. Then scripts/backpressure-table.py <out dir>.
here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
node -e 'const { dist } = require(process.argv[1] + "/lib"); console.log(Object.keys(dist("config/config-paths.js").ConfigPaths).join("\n"))' "$here" \
    | xargs -P "${2:-6}" -I{} node "$here/backpressure-sample.js" "$out" {} > /dev/null 2>&1
ls "$out" | wc -l
