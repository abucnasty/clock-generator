#!/bin/sh
# scripts/sweep.sh <out dir> [processes, default 6]
# Every potential clock of every sample, one JSON a sample (see sweep-sample.js). Build first: `npx tsc`.
# About 2 minutes with 6 processes, and 8 GB at the start: run `free -g` first. BACKED_UP=1 turns "Backed-up belts" on. SEARCH=1 turns "Search for fewer wake-ups" on, which runs the four searches for every sample and takes
# about 4 minutes: without it they only run where no other clock is stable. START_DEPENDENCE=1 tries every clock from
# the other starts too (docs/stability.md, "How a clock is started"). The samples that exist to be refused
# (ExpectedRefusals in src/config/config-paths.ts) are left out.
#
# Run it before and after a change to the simulator or the planner, then scripts/compare-sweeps.py.
# For the sweep of another commit, build a worktree of it and name it:
#   git worktree add .scratch/base <commit> && ln -s "$PWD/node_modules" .scratch/base/clock-generator/node_modules
#   (cd .scratch/base/clock-generator && npx tsc)
#   CLOCK_GENERATOR_ROOT=.scratch/base/clock-generator scripts/sweep.sh .scratch/base-off
# Keep results under .scratch/, which git ignores: /tmp is emptied on a reboot.
here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
[ -n "$CLOCK_GENERATOR_ROOT" ] && CLOCK_GENERATOR_ROOT=$(cd "$CLOCK_GENERATOR_ROOT" && pwd) && export CLOCK_GENERATOR_ROOT
node -e 'console.log(require(process.argv[1] + "/lib").sampleKeys().join("\n"))' "$here" \
    | xargs -P "${2:-6}" -I{} node "$here/sweep-sample.js" "$out" {} > /dev/null 2>&1
ls "$out" | wc -l
