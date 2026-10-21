#!/bin/bash
# run-lane.sh -w <worktree> -r <evidence root> -l <lane> [options] <list file>...
#
# One Factorio lane: runs each case of the list files, one vitest process and one
# Factorio at a time, from <worktree>/clock-generator with vitest.game.config.ts, and prints one line per case:
# "ok <pattern>" when vitest reports <expected> passed and nothing failed, else "CHECK <pattern> -> <summary> (<log>)".
# A list line is <test file from clock-generator/> TAB <-t pattern> TAB <expected passed count>; # starts a comment.
#
# Before every case it stops ("STOP: ...", exit 1) when the worktree's HEAD is not the frozen head or a tracked file
# changed, or when a Factorio of this lane is still running. It waits while the machine already runs the cap of harness
# Factorio processes (a watched run is two). Factorio processes are found by path (scripts/worktree/procs.py: the harness's
# arguments, and the lane's folders on the command line), never by name; the owner's game is never counted.
#
#   -w <worktree>       the frozen worktree (its own node_modules: scripts/worktree/setup.sh)
#   -r <root>           evidence root, e.g. clock-generator/.scratch/<topic>/<run>: captures in <root>/<lane>/, logs in <root>/logs/<lane>/, TMPDIR <root>/tmp/<lane>/
#   -l <lane>           lane name (one per Factorio process you are allowed)
#   -f <head|file>      the frozen head, a commit or a file holding one (default <root>/FROZEN_HEAD)
#   -m record|replay|generate
#                       record (default): Factorio, BELT_CLOCK_CALIBRATE=1, BELT_SPEED_CAPTURE_DIR=<root>/<lane>;
#                       replay: no Factorio, BELT_CLOCK_REPLAY_DIR (-d, default <root>/replay-all), -e expectations;
#                       generate: no Factorio, BELT_CLOCK_GENERATION_ONLY=1, BELT_CLOCK_GENERATION_DIR=<root>/<lane>
#   -e <controls file>  BELT_CLOCK_EXPECTATIONS (replay)
#   -d <dir>            BELT_CLOCK_REPLAY_DIR (replay)
#   -x KEY=VALUE        an extra environment variable for every case (repeatable), e.g. -x SCAFFOLD_CAPTURE_DIR=<root>/<lane>/kept
#   -c <cap>            harness Factorio processes allowed on the machine at once (default 4, ROADMAP section 2)
#   --factorio <path>   default $FACTORIO_PATH or /Applications/factorio_2_1.app/Contents/MacOS/factorio
#   --save <zip>        default <worktree>/clock-generator/resources/clock_generator_staging.zip
set -u
PROCS=$(cd "$(dirname "$0")/../worktree" && pwd -P)/procs.py
W=""; ROOT=""; LANE=""; FROZEN=""; MODE=record; EXPECT=""; REPLAY=""; CAP=4; EXTRA=()
FACTORIO=${FACTORIO_PATH:-/Applications/factorio_2_1.app/Contents/MacOS/factorio}; SAVE=""
LISTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -w) W=$2; shift ;;
    -r) ROOT=$2; shift ;;
    -l) LANE=$2; shift ;;
    -f) FROZEN=$2; shift ;;
    -m) MODE=$2; shift ;;
    -e) EXPECT=$2; shift ;;
    -d) REPLAY=$2; shift ;;
    -x) EXTRA+=("$2"); shift ;;
    -c) CAP=$2; shift ;;
    --factorio) FACTORIO=$2; shift ;;
    --save) SAVE=$2; shift ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    -*) echo "run-lane.sh: unknown option $1" >&2; exit 2 ;;
    *) LISTS+=("$1") ;;
  esac
  shift
done
die() { echo "run-lane.sh: $*" >&2; exit 2; }
[ -n "$W" ] && [ -n "$ROOT" ] && [ -n "$LANE" ] && [ ${#LISTS[@]} -gt 0 ] || die "usage: run-lane.sh -w <worktree> -r <root> -l <lane> [options] <list file>..."
W=$(cd "$W" && pwd -P) || die "no worktree $W"
mkdir -p "$ROOT" && ROOT=$(cd "$ROOT" && pwd -P)
case "$LANE" in *[!A-Za-z0-9._-]*) die "a lane name is letters, digits, dot, dash and underscore" ;; esac
[ -z "$FROZEN" ] && [ -f "$ROOT/FROZEN_HEAD" ] && FROZEN="$ROOT/FROZEN_HEAD"
[ -n "$FROZEN" ] || die "no frozen head: -f <commit|file> or <root>/FROZEN_HEAD"
[ -f "$FROZEN" ] && FROZEN=$(tr -d '[:space:]' < "$FROZEN")
FROZEN=$(git -C "$W" rev-parse --verify "$FROZEN^{commit}" 2>/dev/null) || die "the frozen head is not a commit of $W"
[ -x "$W/clock-generator/node_modules/.bin/vitest" ] || die "no node_modules in $W/clock-generator: run scripts/worktree/setup.sh $W"
for l in "${LISTS[@]}"; do [ -f "$l" ] || die "no list file $l"; done
case "$MODE" in record|replay|generate) ;; *) die "-m is record, replay or generate" ;; esac

cd "$W/clock-generator" || exit 2
unset CLOCK_PROOF_PHASES BELT_CLOCK_GENERATION_DIR BELT_CLOCK_GENERATION_ONLY BELT_CLOCK_REPLAY_DIR \
      BELT_CLOCK_EXPECTATIONS BELT_CLOCK_TRACE_PICKUPS BELT_CLOCK_CALIBRATE BELT_SPEED_CAPTURE_DIR FACTORIO_HARNESS_WATCH
export NO_COLOR=1 TMPDIR="$ROOT/tmp/$LANE"
case "$MODE" in
  replay)
    unset FACTORIO_PATH FACTORIO_HARNESS_SAVE
    export BELT_CLOCK_REPLAY_DIR="${REPLAY:-$ROOT/replay-all}"
    [ -n "$EXPECT" ] && export BELT_CLOCK_EXPECTATIONS="$EXPECT" ;;
  generate)
    unset FACTORIO_PATH FACTORIO_HARNESS_SAVE
    export BELT_CLOCK_GENERATION_ONLY=1 BELT_CLOCK_GENERATION_DIR="$ROOT/$LANE" ;;
  record)
    [ -x "$FACTORIO" ] || die "no Factorio at $FACTORIO"
    export FACTORIO_PATH="$FACTORIO" FACTORIO_HARNESS_SAVE="${SAVE:-$W/clock-generator/resources/clock_generator_staging.zip}"
    export BELT_CLOCK_CALIBRATE=1 BELT_SPEED_CAPTURE_DIR="$ROOT/$LANE" ;;
esac
for kv in ${EXTRA[@]+"${EXTRA[@]}"}; do export "$kv"; done
mkdir -p "$TMPDIR" "$ROOT/logs/$LANE" "$ROOT/$LANE"

# the harness Factorio processes of this lane: their command line names the lane's TMPDIR or capture folder
lane_factorio() {
  python3 "$PROCS" --kinds factorio --json | python3 -c '
import json, sys
roots = sys.argv[1:]
for line in sys.stdin:
    r = json.loads(line)
    if any(root in r["command"] for root in roots): print(r["pid"])' "$ROOT/tmp/$LANE/" "$ROOT/$LANE/"
}
all_factorio() { python3 "$PROCS" --kinds factorio --pids | wc -l | tr -d ' '; }

echo "$(date +%T) lane $LANE: $MODE, $W at ${FROZEN:0:8}, root $ROOT"
grep -hv '^[[:space:]]*\(#\|$\)' "${LISTS[@]}" | while IFS="$(printf '\t')" read -r file pattern expected; do
  if [ "$(git -C "$W" rev-parse HEAD)" != "$FROZEN" ] || [ -n "$(git -C "$W" status --porcelain --untracked-files=no)" ]; then
    echo "$(date +%T) STOP: the worktree moved (HEAD $(git -C "$W" rev-parse --short HEAD), frozen ${FROZEN:0:8}, or a tracked change)"; exit 1
  fi
  if [ -n "$(lane_factorio)" ]; then
    echo "$(date +%T) STOP: a Factorio of lane $LANE is still running ($(lane_factorio | tr '\n' ' '))"; exit 1
  fi
  if [ "$MODE" = record ]; then
    waited=0
    while [ "$(all_factorio)" -ge "$CAP" ]; do
      [ "$waited" = 0 ] && echo "$(date +%T) wait: $(all_factorio) harness Factorio processes run (cap $CAP)"
      waited=1; sleep 30
    done
  fi
  log="$ROOT/logs/$LANE/$(date +%H%M%S)-$(printf '%s' "$pattern" | tr -c 'A-Za-z0-9-' '_' | cut -c1-90).log"
  ./node_modules/.bin/vitest run --config vitest.game.config.ts "$file" -t "$pattern" --reporter=verbose > "$log" 2>&1
  result=$(grep -E '^ +Tests ' "$log" | tail -1)
  # vitest 4 counts -t-filtered tests as skipped: accept "<n> passed | <m> skipped (<t>)" or "<n> passed (<n>)", and
  # reject any "failed"
  case "$result" in
    *failed*) echo "$(date +%T) CHECK  $pattern -> ${result:-no test summary} ($log)" ;;
    *" $expected passed ($expected)"*|*" $expected passed | "*" skipped "*) echo "$(date +%T) ok     $pattern" ;;
    *) echo "$(date +%T) CHECK  $pattern -> ${result:-no test summary} ($log)" ;;
  esac
done
