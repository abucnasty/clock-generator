#!/bin/bash
# blast.sh: the blast radius of an engine change (every sample config as it is and backed up, every pickup and over-hood
# fixture; every alternative's exported clock hashed), from any worktree, with a cache keyed by the engine's content.
#
#   blast.sh key <worktree>                 the cache key of the worktree as it is (engine from git, job list from a
#                                           config-only pass, ~10 s) and whether it is cached
#   blast.sh before <worktree> [-n N]       the "before" jobs: the cached entry when the key matches (no generation);
#                                           else generates them with N processes and stores them. Refuses a worktree
#                                           with uncommitted changes to the engine's paths
#   blast.sh run <worktree> <out> [-n N] [--no-store] [--no-build]
#                                           generates into <out> (resumable: done jobs stay, stale claims are freed);
#                                           a complete run of a clean worktree is also stored in the cache
#   blast.sh store <worktree> <jobs-dir> --note <text>
#                                           stores finished jobs (made elsewhere, on the same engine and job list) as
#                                           the worktree's entry; jobs not in its list are left out and named
#   blast.sh compare <before> <after> [--json f]   compare.py (folders or cache entries)
#   blast.sh list                           the cache's entries
#
# The worktree may be another checkout than this script's: blast.blastrun.ts and the two vitest configs beside this
# script are copied into its tests/game/builds/.scratch/ (gitignored) and run there, so a worktree from before these
# scripts can be measured too. The key's engine half is key.py's; its jobs half the job list's hash.
#
# Env: BLAST_GROUPS, BLAST_SKIP (default REAL_THAELN_CELL09: Thaeln's cell 09 is out of scope for 0.19.0, decided
# 2026-10-20; it is in no cache entry), BLAST_ONLY (run only; never cached), BLAST_SETUP (comma list of setup files from
# clock-generator/, e.g. a rule patch; such a run is never cached), BLAST_CACHE (default
# <main checkout>/clock-generator/.scratch/blast-cache, shared by every worktree of the repository).
# Needs the worktree's own node_modules (scripts/worktree/setup.sh). N defaults to 4: each process is one vitest run
# and one fork worker on one core; keep the machine's total in mind when other sessions run.
set -u
HERE=$(cd "$(dirname "$0")" && pwd -P)
# the main checkout: the parent of the repository's common git folder, the same from every worktree
MAIN=$(cd "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
CACHE=${BLAST_CACHE:-$MAIN/clock-generator/.scratch/blast-cache}
SCRATCH=tests/game/builds/.scratch
TEST=$SCRATCH/blast.blastrun.ts
die() { echo "blast.sh: $*" >&2; exit 1; }
say() { echo "== $*"; }

worktree() {
  [ -n "${1:-}" ] && [ -d "$1/clock-generator" ] || die "not a worktree with clock-generator/: ${1:-<none>}"
  W=$(cd "$1" && pwd -P); E="$W/clock-generator"
  [ -x "$E/node_modules/.bin/vitest" ] || die "no node_modules in $E: run scripts/worktree/setup.sh $W"
  [ -L "$E/node_modules" ] && echo "blast.sh: warning: $E/node_modules is a symlink ($(readlink "$E/node_modules")); give the worktree its own (setup.sh --unlink)" >&2
  git -C "$W" check-ignore -q "$E/$SCRATCH/x.ts" || die "$E/$SCRATCH is not gitignored in this worktree; refusing to write there"
  mkdir -p "$E/$SCRATCH"
  cp "$HERE/blast.blastrun.ts" "$E/$TEST" && cp "$HERE/vitest.src.config.ts" "$E/$SCRATCH/vitest.scratch-src.config.ts" \
    && cp "$HERE/vitest.dist.config.ts" "$E/$SCRATCH/vitest.scratch-dist.config.ts" || die "could not copy the blast test into $E/$SCRATCH"
}

# the key of the worktree as it is: sets KEY, KEYDIR (holds engine.json and _jobs.json), DIRTY
compute_key() {
  KEYDIR=$(mktemp -d "${TMPDIR:-/tmp}/blast-key.XXXXXX")
  python3 "$HERE/key.py" "$W" > "$KEYDIR/engine.json" || die "key.py failed"
  DIRTY=$(python3 -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1]))['dirty']))" "$KEYDIR/engine.json")
  (cd "$E" && env -u CLOCK_PROOF_PHASES -u BLAST_ONLY NO_COLOR=1 SCRATCH_INCLUDE=$TEST BLAST_MODE=jobs BLAST_OUT="$KEYDIR" \
    ./node_modules/.bin/vitest run --config $SCRATCH/vitest.scratch-src.config.ts > "$KEYDIR/jobs-pass.log" 2>&1) \
    || die "the job-list pass failed ($KEYDIR/jobs-pass.log)"
  [ -f "$KEYDIR/_jobs.json" ] || die "the job-list pass wrote no _jobs.json ($KEYDIR/jobs-pass.log)"
  KEY=$(python3 -c "import json,sys; e=json.load(open(sys.argv[1])); j=json.load(open(sys.argv[2])); print(e['engine'][:12]+'-'+j['jobs_sha256'][:12])" "$KEYDIR/engine.json" "$KEYDIR/_jobs.json")
}

describe_key() {
  python3 - "$KEYDIR/engine.json" "$KEYDIR/_jobs.json" <<'EOF'
import json, sys
e, j = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
print(f"   engine {e['engine'][:12]} ({e['format']}: src {e['src'][:12]} over {e['src_files']} files without *.test.ts and *.md,"
      f" resources {e['resources'][:12]}, package-lock {e['lock'][:12]}, tsconfig {e['tsconfig'][:12]}; HEAD {e['rev'][:8]})")
print(f"   jobs   {j['jobs_sha256'][:12]} ({j['format']}: {j['count']} jobs, groups {','.join(j['groups'])}, skip {','.join(j['skip']) or 'none'})")
EOF
}

# generates every job of the list into $1 with $2 processes
generate() {
  local out=$1 n=$2 build=$3 i pid
  mkdir -p "$out/.claims" "$out/.logs"
  if ! mkdir "$out/.lock" 2>/dev/null; then
    pid=$(cat "$out/.lock/pid" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then die "$out is being generated by process $pid"; fi
    echo "blast.sh: taking over the stale lock of $out (process ${pid:-?} is gone)" >&2
  fi
  echo $$ > "$out/.lock/pid"
  # the folder holds jobs of one engine state only: a resume on another refuses
  local setup=() f state
  for f in $(echo "${BLAST_SETUP:-}" | tr ',' ' '); do setup+=("$E/$f"); done
  state=$(python3 "$HERE/key.py" --state "$W" ${setup[@]+"${setup[@]}"}) || { rm -rf "$out/.lock"; die "key.py --state failed"; }
  if [ -f "$out/.engine-state" ] && [ "$(cat "$out/.engine-state")" != "$state" ] && ls "$out"/*.json > /dev/null 2>&1; then
    rm -rf "$out/.lock"
    die "$out holds jobs of another engine state (the worktree or BLAST_SETUP changed since); use a fresh folder"
  fi
  echo "$state" > "$out/.engine-state"
  # a claim without its job file was left by a process that stopped: free it
  for c in "$out"/.claims/*; do [ -d "$c" ] && [ ! -f "$out/$(basename "$c").json" ] && rmdir "$c"; done
  if [ "$build" = 1 ]; then say "npm run build ($E)"; (cd "$E" && npm run --silent build) || { rm -rf "$out/.lock"; die "npm run build failed"; }; fi
  say "generating into $out with $n processes (logs in $out/.logs/)"
  PIDS=()
  set -m
  trap 'echo "blast.sh: stopping"; for p in ${PIDS[@]+"${PIDS[@]}"}; do kill -TERM -- -$p 2>/dev/null; done; wait; rm -rf "$out/.lock"; exit 130' INT TERM
  for i in $(seq 1 "$n"); do
    (cd "$E" && exec env -u CLOCK_PROOF_PHASES NO_COLOR=1 SCRATCH_INCLUDE=$TEST SCRATCH_SETUP="${BLAST_SETUP:-}" BLAST_MODE=generate \
      BLAST_OUT="$out" BLAST_CLAIMS="$out/.claims" ./node_modules/.bin/vitest run --config $SCRATCH/vitest.scratch-dist.config.ts) \
      > "$out/.logs/proc$i.log" 2>&1 &
    PIDS+=($!)
    sleep 2
  done
  local failed=0
  for p in "${PIDS[@]}"; do wait "$p" || failed=$((failed + 1)); done
  set +m; trap - INT TERM
  rm -rf "$out/.lock"
  [ "$failed" = 0 ] || echo "blast.sh: $failed of $n processes failed (see $out/.logs/)" >&2
  python3 "$HERE/cache.py" complete "$out"
}

# a JSON object from key value pairs (no braces for the shell to expand)
json_of() { python3 -c 'import json, sys; a = sys.argv[1:]; print(json.dumps(dict(zip(a[0::2], a[1::2]))))' "$@"; }

store_entry() { # $1 jobs dir, $2 source json
  python3 "$HERE/cache.py" store "$CACHE" "$KEY" "$1" "$KEYDIR/_jobs.json" "$KEYDIR/engine.json" "$2"
}

cmd=${1:-}; shift || true
N=4; STORE=1; BUILD=1; NOTE=""; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N=$2; shift ;;
    --no-store) STORE=0 ;;
    --no-build) BUILD=0 ;;
    --note) NOTE=$2; shift ;;
    --json|--md) ARGS+=("$1" "$2"); shift ;;
    -*) die "unknown option $1" ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done
case "$N" in ''|*[!0-9]*) die "-n takes a number" ;; esac

case "$cmd" in
  key)
    worktree "${ARGS[0]:-}"; compute_key
    say "key $KEY"; describe_key
    [ -n "$DIRTY" ] && { echo "   DIRTY (the engine part is HEAD's, not the working tree's):"; echo "$DIRTY" | sed 's/^/     /'; }
    if entry=$(python3 "$HERE/cache.py" lookup "$CACHE" "$KEY" 2>/dev/null); then echo "   cached: $entry"; else echo "   not cached"; fi
    ;;
  before)
    [ -z "${BLAST_ONLY:-}" ] || die "before takes every job; unset BLAST_ONLY"
    [ -z "${BLAST_SETUP:-}" ] || die "before is the engine as it is; unset BLAST_SETUP"
    worktree "${ARGS[0]:-}"; compute_key
    [ -z "$DIRTY" ] || { echo "$DIRTY" >&2; die "the worktree has uncommitted changes to the engine's paths (above); \"before\" is a committed engine"; }
    say "key $KEY"; describe_key
    if entry=$(python3 "$HERE/cache.py" lookup "$CACHE" "$KEY"); then
      say "HIT: $entry (nothing generated)"; exit 0
    fi
    say "MISS: generating the before jobs"
    staging="$CACHE/.run-$KEY"
    generate "$staging" "$N" "$BUILD" || die "the run is incomplete; rerun the same command to resume ($staging)"
    cmp -s <(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['jobs_sha256'])" "$staging/_jobs.json") \
           <(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['jobs_sha256'])" "$KEYDIR/_jobs.json") \
      || die "the run's job list (engine from dist/) differs from the key's (from src/): is dist/ stale? ($staging)"
    rev=$(git -C "$W" rev-parse HEAD)
    store_entry "$staging" "$(json_of kind generated worktree "$W" rev "$rev" processes "$N" note "blast.sh before")" || exit 1
    rm -rf "$staging"
    say "stored: $(python3 "$HERE/cache.py" lookup "$CACHE" "$KEY")"
    ;;
  run)
    worktree "${ARGS[0]:-}"; out=${ARGS[1]:-}; [ -n "$out" ] || die "run <worktree> <out>"
    mkdir -p "$out"; out=$(cd "$out" && pwd -P)
    generate "$out" "$N" "$BUILD" || die "the run is incomplete; rerun the same command to resume"
    if [ "$STORE" = 1 ] && [ -z "${BLAST_ONLY:-}" ] && [ -z "${BLAST_SETUP:-}" ]; then
      compute_key
      if [ -n "$DIRTY" ]; then say "not cached: uncommitted changes to the engine's paths"
      elif ! cmp -s <(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['jobs_sha256'])" "$out/_jobs.json") \
                    <(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['jobs_sha256'])" "$KEYDIR/_jobs.json"); then
        say "not cached: the run's job list differs from the worktree's now"
      else
        rev=$(git -C "$W" rev-parse HEAD)
        store_entry "$out" "$(json_of kind generated worktree "$W" rev "$rev" processes "$N" note "blast.sh run")" || true
      fi
    fi
    ;;
  store)
    worktree "${ARGS[0]:-}"; src=${ARGS[1]:-}; [ -d "$src" ] && [ -n "$NOTE" ] || die "store <worktree> <jobs-dir> --note <text>"
    src=$(cd "$src" && pwd -P)
    compute_key
    [ -z "$DIRTY" ] || die "the worktree has uncommitted changes to the engine's paths"
    say "key $KEY"; describe_key
    rev=$(git -C "$W" rev-parse HEAD)
    store_entry "$src" "$(json_of kind stored from "$src" worktree "$W" rev "$rev" note "$NOTE")"
    ;;
  compare) [ ${#ARGS[@]} -ge 2 ] || die "compare <before> <after> [--json out.json]"; python3 "$HERE/compare.py" "${ARGS[@]}" ;;
  list) python3 "$HERE/cache.py" list "$CACHE" ;;
  *) sed -n '2,30p' "$0"; exit 2 ;;
esac
