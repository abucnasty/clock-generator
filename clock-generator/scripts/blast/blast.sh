#!/bin/bash
# blast.sh: the blast radius of an engine change (every sample config as it is and backed up, every pickup and over-hood
# fixture; every alternative's exported clock hashed), from any worktree, with a cache keyed by the engine's content.
#
#   blast.sh key <worktree>                 the cache key of the worktree as it is (engine from git, job list from a
#                                           config-only pass, ~10 s) and whether it is cached
#   blast.sh before <worktree> [-n N] [--full] [--base K]
#                                           the "before" jobs: the cached entry when the key matches (no generation);
#                                           else generates them with N processes and stores them, rerunning only the
#                                           jobs the change reaches (below). Refuses a worktree with uncommitted
#                                           changes to the engine's paths
#   blast.sh run <worktree> <out> [-n N] [--no-store] [--no-build] [--full] [--base K]
#                                           generates into <out> (resumable: done jobs stay, stale claims are freed);
#                                           a complete run of a clean worktree is also stored in the cache
#   blast.sh select <worktree> [--base K] [--no-build]
#                                           builds, then says which jobs a run would rerun and why; generates nothing
#   blast.sh store <worktree> <jobs-dir> --note <text>
#                                           stores finished jobs (made elsewhere, on the same engine and job list) as
#                                           the worktree's entry; jobs not in its list are left out and named
#   blast.sh compare <before> <after> [--json f]   compare.py (folders or cache entries)
#   blast.sh same <a> <b>                   whether two jobs folders (or cache entries) hold the same results, job by job
#   blast.sh list                           the cache's entries
#
# The worktree may be another checkout than this script's: blast.blastrun.ts, blast.recorder.ts and the two vitest configs beside this
# script are copied into its tests/game/builds/.scratch/ (gitignored) and run there, so a worktree from before these
# scripts can be measured too. The key's engine half is key.py's; its jobs half the job list's hash.
#
# Rerunning only what a change reaches (#378). Every job generates in a process of its own (so that none meets what an
# earlier job left in the engine's memory: a memo, say) and blast.recorder.ts / blast.blastrun.ts record which functions of
# the engine's build (dist/) ran in it (V8 coverage, from before the engine loads) and which files loaded: the job's
# footprint, stored in the cache entry beside its result (functions/, see functions.js). When the key misses, the nearest
# cached entry (in git) with footprints becomes the base, and a job is rerun only if
#   - it is new, or its config changed (the job list's per-job config hash), or the base has no footprint for it; or
#   - a function it ran is gone or differs ("differs" is the built code, a function's own tokens without comments or
#     layout, the code of functions nested in it left out; what ran while the engine loaded counts for every job); or
#   - a function it ran reads a name whose value changed: a top-level declaration (`const LIMIT = 4`, an import, a class's
#     statics) with other code, or one that reads such a name (read by name, in any file: a name that is only in the new
#     build is not a change, code that did not change cannot read it); or
#   - it loaded a file where a statement that only runs (a call, a patch of a prototype) is not the same; or
#   - a class that extends another gained or lost a member, or changed what it extends: then every job reruns (an implicit
#     constructor leaves no trace of the class in a footprint, and the new member may override an inherited one); or
#   - the engine's game data (resources/ but the sample configs and notes), package-lock.json (which has the version the
#     blueprints carry) or tsconfig.json differ from the base's: then no entry is a base and every job generates.
# Every other job's result is copied from the base, with its footprint. The engine is deterministic, so a job that ran no
# changed code cannot change: a change of comments or layout only reruns nothing, and the run's result is what a full run
# gives (checked job by job on real changes of the engine, see #378). What it cannot see: a value read by something other
# than its name (a computed property, a namespace passed around), and a global patched at run time. A change that reaches
# the main path (generateClockForConfig, the grouped hands) reruns nearly every job: the footprints say which jobs run a
# function, not which jobs a change of it alters. BLAST_SETUP and BLAST_ONLY runs, and runs of a worktree with uncommitted
# changes outside src/, are never selective. --full turns selection off; --base K
# names the cache entry to carry from (blast.sh list); `select` says what a run would rerun and why; BLAST_FUNCTIONS=0
# records nothing (the entry then cannot be a base); recording makes a full generation about 1.5 times as long in CPU time.
#
# Env: BLAST_GROUPS, BLAST_SKIP (default REAL_THAELN_CELL09: Thaeln's cell 09 is out of scope for 0.19.0, decided
# 2026-10-20; it is in no cache entry), BLAST_ONLY (run only; never cached), BLAST_SETUP (comma list of setup files from
# clock-generator/, e.g. a rule patch; such a run is never cached), BLAST_CACHE (default
# <main checkout>/clock-generator/.scratch/blast-cache, shared by every worktree of the repository), BLAST_LOCK (the file
# that lets one blast generate at a time on the machine, default <main checkout>/work/blast-cache/.generate.lock where
# that folder exists, else <cache>/.generate.lock: a copy of this tool kept outside the repository takes the first).
# Needs the worktree's own node_modules (scripts/worktree/setup.sh). N defaults to 4: each process is one vitest run
# and one fork worker on one core; keep the machine's total in mind when other sessions run.
set -u
HERE=$(cd "$(dirname "$0")" && pwd -P)
# the main checkout: the parent of the repository's common git folder, the same from every worktree
MAIN=$(cd "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
CACHE=${BLAST_CACHE:-$MAIN/clock-generator/.scratch/blast-cache}
if [ -n "${BLAST_LOCK:-}" ]; then LOCK=$BLAST_LOCK
elif [ -d "$MAIN/work/blast-cache" ]; then LOCK=$MAIN/work/blast-cache/.generate.lock
else LOCK=$CACHE/.generate.lock; fi
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
  cp "$HERE/blast.blastrun.ts" "$E/$TEST" && cp "$HERE/blast.recorder.ts" "$E/$SCRATCH/blast.recorder.ts" \
    && cp "$HERE/vitest.src.config.ts" "$E/$SCRATCH/vitest.scratch-src.config.ts" \
    && cp "$HERE/vitest.dist.config.ts" "$E/$SCRATCH/vitest.scratch-dist.config.ts" || die "could not copy the blast test into $E/$SCRATCH"
}

# the key of the worktree as it is: sets KEY, KEYDIR (holds engine.json and _jobs.json), DIRTY
compute_key() {
  KEYDIR=$(mktemp -d "${TMPDIR:-/tmp}/blast-key.XXXXXX")
  trap 'rm -rf "$KEYDIR"' EXIT
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

# Selection: copies into $1 the results of every job the change does not reach, from the nearest cached entry that recorded
# footprints, and leaves $1/.seed.json (which entry, which jobs were carried, which rerun and why). Needs KEYDIR, the built dist/.
seed() {
  local out=$1 bases chosen fdir bjobs
  if [ "$FULL" = 1 ]; then say "selection off (--full): every job generates"; return 0; fi
  if [ -n "${BLAST_ONLY:-}" ] || [ -n "${BLAST_SETUP:-}" ]; then say "selection off (BLAST_ONLY or BLAST_SETUP): every job generates"; return 0; fi
  if [ -n "$(echo "$DIRTY" | grep -v ' clock-generator/src/')" ]; then say "selection off (uncommitted changes outside src/): every job generates"; return 0; fi
  bases=$(python3 "$HERE/cache.py" bases "$CACHE" "$KEYDIR/engine.json" "$KEYDIR/_jobs.json" "$(node "$HERE/functions.js" tool)" "$W")
  if [ -n "$BASE" ]; then chosen=$(echo "$bases" | grep "\"key\": \"$BASE\"" | head -1)
  else chosen=$(echo "$bases" | head -1); fi
  if [ -z "$chosen" ]; then say "no cached entry with footprints to carry jobs from${BASE:+ ($BASE is not one)}: every job generates"; return 0; fi
  fdir=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['functions'])" "$chosen")
  bjobs=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['jobs'])" "$chosen")
  say "carrying from $(python3 -c "import json,sys; c=json.loads(sys.argv[1]); print(c['key'], '(commit', c['rev'][:8] + ',', c['distance'], 'commits away)')" "$chosen")"
  node "$HERE/functions.js" plan --dist "$E/dist" --base "$fdir" --jobs "$KEYDIR/_jobs.json" --base-jobs "$bjobs/_jobs.json" --out "$out/.plan.json" \
    || { say "the plan failed: every job generates"; return 0; }
  python3 "$HERE/cache.py" seed "$out" "$bjobs" "$fdir" "$KEYDIR/_jobs.json" ${DRY:+--dry}
}

# generates every job of the list into $1 with $2 processes
generate() {
  local out=$1 n=$2 build=$3 i pid missing
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
  [ -f "$out/.seed.json" ] || seed "$out" || { rm -rf "$out/.lock"; exit 1; }
  # the job list as the built engine makes it, for the processes below and for the check that dist/ is not stale
  if [ ! -f "$out/_jobs.json" ]; then
    (cd "$E" && env -u CLOCK_PROOF_PHASES -u BLAST_ONLY BLAST_FUNCTIONS=0 NO_COLOR=1 SCRATCH_INCLUDE=$TEST SCRATCH_SETUP="${BLAST_SETUP:-}" BLAST_MODE=jobs BLAST_OUT="$out" \
      ./node_modules/.bin/vitest run --config $SCRATCH/vitest.scratch-dist.config.ts > "$out/.logs/jobs-pass.log" 2>&1) \
      && [ -f "$out/_jobs.json" ] || { rm -rf "$out/.lock"; die "the job-list pass of the built engine failed ($out/.logs/jobs-pass.log)"; }
  fi
  # the jobs of the list that have no result yet; if the change reaches few, no more processes than jobs
  missing=$(python3 "$HERE/cache.py" missing "$out" "$out/_jobs.json")
  [ "$missing" -ge "$n" ] || n=$missing
  if [ "$n" -gt 0 ]; then
    # one blast generates at a time on the machine (memory: two at once ran it out on 2026-10-23)
    mkdir -p "$(dirname "$LOCK")"; exec 9>"$LOCK"
    if ! flock -n 9; then say "waiting for another blast's generation to end"; flock 9; fi
  else say "no job to generate"; fi
  say "generating $missing jobs into $out with $n processes (logs in $out/.logs/)"
  PIDS=()
  set -m
  trap 'echo "blast.sh: stopping"; for p in ${PIDS[@]+"${PIDS[@]}"}; do kill -TERM -- -$p 2>/dev/null; done; wait; rm -rf "$out/.lock"; exit 130' INT TERM
  rm -f "$out/.drained"
  for i in $(seq 1 "$n"); do
    # each of the n slots runs one process per job (BLAST_ONE), until none is left; three failures in a row end the slot
    (fails=0
     while [ ! -e "$out/.drained" ] && [ "$fails" -lt 3 ]; do
       if (cd "$E" && env -u CLOCK_PROOF_PHASES NO_COLOR=1 SCRATCH_INCLUDE=$TEST SCRATCH_SETUP="${BLAST_SETUP:-}" BLAST_MODE=generate BLAST_ONE=1 \
             BLAST_OUT="$out" BLAST_CLAIMS="$out/.claims" ./node_modules/.bin/vitest run --config $SCRATCH/vitest.scratch-dist.config.ts) >> "$out/.logs/proc$i.log" 2>&1
       then fails=0; else fails=$((fails + 1)); fi
     done
     [ "$fails" -lt 3 ]) &
    PIDS+=($!)
    sleep 2
  done
  local failed=0
  for p in ${PIDS[@]+"${PIDS[@]}"}; do wait "$p" || failed=$((failed + 1)); done
  set +m; trap - INT TERM
  rm -rf "$out/.lock"
  [ "$failed" = 0 ] || echo "blast.sh: $failed of $n processes failed (see $out/.logs/)" >&2
  if [ -z "${BLAST_ONLY:-}" ] && [ -z "${BLAST_SETUP:-}" ] && { [ "${BLAST_FUNCTIONS:-}" != 0 ] || [ -f "$out/.seed.json" ]; }; then
    node "$HERE/functions.js" collect --dist "$E/dist" --raw "$out/.functions" --out "$out/functions" --carry "$out/.seed.json" \
      || echo "blast.sh: could not write the footprints; the entry will not be a base" >&2
  fi
  python3 "$HERE/cache.py" complete "$out"
}

# a JSON object from key value pairs (no braces for the shell to expand)
json_of() { python3 -c 'import json, sys; a = sys.argv[1:]; print(json.dumps(dict(zip(a[0::2], a[1::2]))))' "$@"; }

store_entry() { # $1 jobs dir, $2 source json
  python3 "$HERE/cache.py" store "$CACHE" "$KEY" "$1" "$KEYDIR/_jobs.json" "$KEYDIR/engine.json" "$2"
}

cmd=${1:-}; shift || true
DRY=""; N=4; STORE=1; BUILD=1; NOTE=""; FULL=0; BASE=""; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N=$2; shift ;;
    --no-store) STORE=0 ;;
    --no-build) BUILD=0 ;;
    --note) NOTE=$2; shift ;;
    --full) FULL=1 ;;
    --base) BASE=$2; shift ;;
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
    store_entry "$staging" "$(json_of kind generated worktree "$W" rev "$rev" processes "$N" note "blast.sh before $(python3 "$HERE/cache.py" seednote "$staging")")" || exit 1
    rm -rf "$staging"
    say "stored: $(python3 "$HERE/cache.py" lookup "$CACHE" "$KEY")"
    ;;
  run)
    worktree "${ARGS[0]:-}"; out=${ARGS[1]:-}; [ -n "$out" ] || die "run <worktree> <out>"
    mkdir -p "$out"; out=$(cd "$out" && pwd -P)
    compute_key
    generate "$out" "$N" "$BUILD" || die "the run is incomplete; rerun the same command to resume"
    if [ "$STORE" = 1 ] && [ -z "${BLAST_ONLY:-}" ] && [ -z "${BLAST_SETUP:-}" ]; then
      if [ -n "$DIRTY" ]; then say "not cached: uncommitted changes to the engine's paths"
      elif ! cmp -s <(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['jobs_sha256'])" "$out/_jobs.json") \
                    <(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['jobs_sha256'])" "$KEYDIR/_jobs.json"); then
        say "not cached: the run's job list differs from the worktree's now"
      else
        rev=$(git -C "$W" rev-parse HEAD)
        store_entry "$out" "$(json_of kind generated worktree "$W" rev "$rev" processes "$N" note "blast.sh run $(python3 "$HERE/cache.py" seednote "$out")")" || true
      fi
    fi
    ;;
  select)
    worktree "${ARGS[0]:-}"; compute_key; say "key $KEY"
    if [ "$BUILD" = 1 ]; then say "npm run build ($E)"; (cd "$E" && npm run --silent build) || die "npm run build failed"; fi
    out=$(mktemp -d "${TMPDIR:-/tmp}/blast-select.XXXXXX"); DRY=1; seed "$out"; rm -rf "$out"
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
  same) [ ${#ARGS[@]} -ge 2 ] || die "same <a> <b>"; python3 "$HERE/cache.py" same "${ARGS[@]}" ;;
  list) python3 "$HERE/cache.py" list "$CACHE" ;;
  *) sed -n '2,/^set -u/{/^#/p}' "$0"; exit 2 ;;
esac
