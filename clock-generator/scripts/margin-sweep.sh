#!/bin/sh
# scripts/margin-sweep.sh <out dir> [processes, default 6]
# Every stable potential clock of every sample, tried with its windows a tick shorter (see margin-sample.js): one JSON
# a sample. Build first (`npx tsc`), and run `free -g` first. Then scripts/margin-table.py <out dir>.
here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
[ -n "$CLOCK_GENERATOR_ROOT" ] && CLOCK_GENERATOR_ROOT=$(cd "$CLOCK_GENERATOR_ROOT" && pwd) && export CLOCK_GENERATOR_ROOT
node -e 'console.log(require(process.argv[1] + "/lib").sampleKeys().join("\n"))' "$here" \
    | xargs -P "${2:-6}" -I{} node "$here/margin-sample.js" "$out" {} > /dev/null 2>&1
ls "$out" | wc -l
