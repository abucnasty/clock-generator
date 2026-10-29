#!/bin/bash
# replay.sh: the replay check of an engine change that must keep results identical (the engine refactor's per-commit
# check, P4 section 6.2). Every job of the blast's job list is run with no search, on the clock the blast selected for
# it, and what every entity holds and shows is hashed per period of the clock (replay.js); a check lays those hashes
# against a base recorded once on the parent commit (compare.js).
#
#   replay.sh record <worktree> <blast-jobs> [-n N] [--losses] [--out DIR]
#                     builds the worktree, writes every job's input (its config, and the windows and period of the
#                     blast's selected clock, from <blast-jobs>: a blast's jobs folder or cache entry of the same job
#                     list, BLAST_GROUPS as the blast's) and replays them into DIR (default
#                     <main checkout>/clock-generator/.scratch/replay/base-<HEAD>), which becomes the base (`base` beside it
#                     links to it)
#   replay.sh check <worktree> [--base DIR] [-n N] [--losses] [--only k1,k2] [--no-build]
#                     replays the base's inputs on the worktree as it is (uncommitted changes included) into
#                     <replay>/check-<HEAD>[-dirty] and compares; exits 1 when a job differs or is missing
#   replay.sh compare <base-results> <results>
#   replay.sh explain <job-key> <run> <period> <worktree-base> <worktree-now> [--base DIR]
#                     the per-tick dump of one period of one run (asbuilt, plan, speed or losses) on both worktrees,
#                     and the first tick and signal at which they differ
#
# A job runs in a process of its own (node replay.js), N at a time (default: nproc - 1), so that none meets what an
# earlier job left in the engine's memory; its heap may grow to REPLAY_HEAP_MB (default 6144: the as-built run of
# processing units with a belt export, 4 periods of 116,160 ticks recorded, peaks near 3.6 GB RSS). Results are resumable: a job whose result exists is not run again (delete the
# folder to start over). Each run also records its milliseconds, ticks per second and scavenges (V8's GC profiler); the
# speed run (the as-built run with nothing recorded) is the one compare.js sets against the base's, as a median ratio.
# The scripts are this checkout's, whichever worktree they replay: the hashes are made the same way on both sides.
# What it cannot see: the candidate search, other taker orders, rounded or rotated trials, loop windows, start-dependence
# runs, insights and descriptions (the blast's and the results digest's).
set -u
HERE=$(cd "$(dirname "$0")" && pwd -P)
MAIN=$(cd "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
REPLAY=$MAIN/clock-generator/.scratch/replay
BLAST=$HERE/../blast
SCRATCH=tests/game/builds/.scratch
die() { echo "replay.sh: $*" >&2; exit 1; }
say() { echo "== $*"; }

worktree() {
  [ -n "${1:-}" ] && [ -d "$1/clock-generator" ] || die "not a worktree with clock-generator/: ${1:-<none>}"
  W=$(cd "$1" && pwd -P); E="$W/clock-generator"
  [ -x "$E/node_modules/.bin/vitest" ] || die "no node_modules in $E: run scripts/worktree/setup.sh $W"
  REV=$(git -C "$W" rev-parse --short=8 HEAD)
  DIRTY=$(git -C "$W" status --porcelain -- clock-generator/src clock-generator/resources | head -1)
}
build() { say "npm run build ($E)"; (cd "$E" && npm run build > /dev/null) || die "the build failed in $E"; }

# replay every input of $1 into $2 with $N processes; $3: extra replay.js arguments
replay_all() {
  local inputs=$1 out=$2 extra=$3 list
  mkdir -p "$out"
  list=$(cd "$inputs" && ls -- *.json 2>/dev/null | grep -v '^_' | while read -r f; do
    k=${f%.json}
    if [ -n "${ONLY:-}" ] && ! echo ",$ONLY," | grep -q ",$k,"; then continue; fi
    [ -f "$out/$f" ] || echo "$k"
  done)
  local count; count=$(echo -n "$list" | grep -c . || true)
  say "replaying $count jobs into $out with $N processes"
  local started=$SECONDS
  echo -n "$list" | grep . | xargs -P "$N" -I{} sh -c \
    'node --max-old-space-size=$5 "$0" --engine "$1" --input "$2/{}.json" --output "$3/{}.json" $4 2> "$3/.{}.err" && rm -f "$3/.{}.err" || echo "replay.sh: {} failed (see $3/.{}.err)" >&2' \
    "$HERE/replay.js" "$E" "$inputs" "$out" "$extra" "${REPLAY_HEAP_MB:-6144}"
  say "replayed in $((SECONDS - started)) s"
}

cmd=${1:-}; shift || true
N=$(( $(nproc) > 1 ? $(nproc) - 1 : 1 )); LOSSES=""; OUT=""; BASE=""; ONLY=""; NOBUILD=0
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N=$2; shift ;;
    --losses) LOSSES=--losses ;;
    --out) OUT=$2; shift ;;
    --base) BASE=$2; shift ;;
    --only) ONLY=$2; shift ;;
    --no-build) NOBUILD=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) POS+=("$1") ;;
  esac
  shift
done
set -- "${POS[@]+"${POS[@]}"}"

case "$cmd" in
  record)
    worktree "${1:-}"; JOBS=${2:-}; [ -d "$JOBS" ] || die "no blast jobs folder: ${JOBS:-<none>}"
    JOBS=$(cd "$JOBS" && pwd -P)
    [ -z "$DIRTY" ] || die "the worktree has uncommitted changes to the engine; a base is recorded on a commit"
    OUT=${OUT:-$REPLAY/base-$REV}; mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd -P)
    build
    mkdir -p "$E/$SCRATCH"
    git -C "$W" check-ignore -q "$E/$SCRATCH/x.ts" || die "$E/$SCRATCH is not gitignored in this worktree"
    cp "$BLAST/blast.blastrun.ts" "$BLAST/blast.digest.ts" "$E/$SCRATCH/" && cp "$HERE/replay.configs.ts" "$E/$SCRATCH/replay.configs.ts" \
      && cp "$BLAST/vitest.dist.config.ts" "$E/$SCRATCH/vitest.scratch-dist.config.ts" || die "could not install the scratch files"
    say "writing the inputs from $JOBS"
    (cd "$E" && env -u BLAST_OUT NO_COLOR=1 REPLAY_JOBS="$JOBS" REPLAY_INPUTS="$OUT/inputs" SCRATCH_INCLUDE=$SCRATCH/replay.configs.ts \
      ./node_modules/.bin/vitest run --config $SCRATCH/vitest.scratch-dist.config.ts > "$OUT/inputs.log" 2>&1) \
      || die "the inputs pass failed ($OUT/inputs.log)"
    replay_all "$OUT/inputs" "$OUT/results" "$LOSSES"
    node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({rev:process.argv[2],jobs:process.argv[3],losses:process.argv[4]==="--losses",node:process.version,recorded:new Date().toISOString()},null,1))' \
      "$OUT/_base.json" "$(git -C "$W" rev-parse HEAD)" "$JOBS" "$LOSSES"
    mkdir -p "$REPLAY" && ln -sfn "$OUT" "$REPLAY/base"
    say "base $OUT ($(ls "$OUT/results" | grep -c '\.json$') results)"
    ;;
  check)
    worktree "${1:-}"
    BASE=${BASE:-$REPLAY/base}; [ -d "$BASE/inputs" ] || die "no base at $BASE (replay.sh record)"
    BASE=$(cd "$BASE" && pwd -P)
    [ "$NOBUILD" = 1 ] || build
    OUT=${OUT:-$REPLAY/check-$REV${DIRTY:+-dirty}}
    # a dirty worktree changes under the same name: start over
    [ -z "$DIRTY" ] || rm -rf "$OUT"
    mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd -P)
    replay_all "$BASE/inputs" "$OUT" "$LOSSES"
    if [ -n "$ONLY" ]; then
      tmp=$(mktemp -d); for k in ${ONLY//,/ }; do cp "$BASE/results/$k.json" "$tmp/" 2>/dev/null; done
      node "$HERE/compare.js" "$tmp" "$OUT" --json "$OUT/_compare.json"; rc=$?; rm -rf "$tmp"; exit $rc
    fi
    node "$HERE/compare.js" "$BASE/results" "$OUT" --json "$OUT/_compare.json"
    ;;
  compare)
    node "$HERE/compare.js" "${1:?base results}" "${2:?results}"
    ;;
  explain)
    KEY=${1:?job key}; RUN=${2:?run}; PERIOD=${3:?period}
    BASE=${BASE:-$REPLAY/base}; INPUT=$BASE/inputs/$KEY.json; [ -f "$INPUT" ] || die "no input $INPUT"
    tmp=$(mktemp -d)
    worktree "${4:-}"; [ "$NOBUILD" = 1 ] || build
    node "$HERE/replay.js" --engine "$E" --input "$INPUT" --dump "$RUN" --period "$PERIOD" > "$tmp/a.json" || die "dump failed in $W"
    worktree "${5:-}"; [ "$NOBUILD" = 1 ] || build
    node "$HERE/replay.js" --engine "$E" --input "$INPUT" --dump "$RUN" --period "$PERIOD" > "$tmp/b.json" || die "dump failed in $W"
    node "$HERE/compare.js" --dumps "$tmp/a.json" "$tmp/b.json"; rc=$?
    rm -rf "$tmp"; exit $rc
    ;;
  *) sed -n '2,30p' "$0"; exit 2 ;;
esac
