#!/bin/sh
# scripts/sweep.sh <out dir> [processes, default 6]
# Every potential clock of every sample, one JSON a sample (see sweep-sample.js). Build first: `npx tsc`.
# About 4 minutes with 6 processes, and 8 GB at the start: run `free -g` first. NON_MOVING=1 turns "Belts do not
# move" on. PROCESSING_UNITS_BELT_EXPORT is left out, which takes more than 5 minutes by itself: FULL=1 sweeps it too,
# for the sweep before a pull request.
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
node -e 'const { dist } = require(process.argv[1] + "/lib"); console.log(Object.keys(dist("config/config-paths.js").ConfigPaths).filter(key => process.env.FULL === "1" || key !== "PROCESSING_UNITS_BELT_EXPORT").join("\n"))' "$here" \
    | xargs -P "${2:-6}" -I{} node "$here/sweep-sample.js" "$out" {} > /dev/null 2>&1
ls "$out" | wc -l
