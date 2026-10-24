#!/bin/bash
# orphans.sh [<worktree>] [--kill [--dry-run]] [--all-kinds]
#
# Lists the vitest runs and fork workers, harness Factorio games and vite/esbuild servers that have no live parent or
# whose worktree is gone, anywhere on the machine; then every vitest run, worker and harness Factorio (with --all-kinds
# also the servers) whose working directory is in <worktree>. Processes are found by working directory and the
# harness's own arguments, never by name alone; a game the harness did not start never matches (procs.py).
#
# --kill stops only the named worktree's processes of those kinds (TERM, then KILL after 10 s): vitest runs first,
# then workers, then Factorio (with --all-kinds the servers too). --dry-run prints what --kill would stop. Without
# <worktree>, --kill is refused. Run it at the end of every session on its own worktree, and before relaunching a
# parallel vitest run.
set -u
HERE=$(cd "$(dirname "$0")" && pwd -P)
W=""; KILL=0; DRY=0; KINDS=vitest,vitest-worker,factorio
while [ $# -gt 0 ]; do
  case "$1" in
    --kill) KILL=1 ;;
    --dry-run) DRY=1 ;;
    --all-kinds) KINDS=vitest,vitest-worker,factorio,vite,esbuild ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "orphans.sh: unknown option $1" >&2; exit 2 ;;
    *) W=$1 ;;
  esac
  shift
done
if [ -n "$W" ]; then
  if [ -d "$W" ]; then W=$(cd "$W" && pwd -P); else W=$(cd "$(dirname "$W")" 2>/dev/null && pwd -P)/$(basename "$W"); fi
fi

header() { printf '%6s %6s %12s %6s %-13s %-40s %s\n' PID PPID ELAPSED CPU KIND WORKTREE COMMAND; }

echo "== orphans anywhere (no live parent, or worktree gone; vite and esbuild servers included)"
out=$(python3 "$HERE/procs.py" --orphans)
if [ -n "$out" ]; then header; echo "$out"; else echo "   none"; fi
if [ -n "$W" ]; then
  echo "== processes of $W"
  out=$(python3 "$HERE/procs.py" --worktree "$W" --kinds "$KINDS")
  if [ -n "$out" ]; then header; echo "$out"; else echo "   none"; fi
fi

[ "$KILL" = 1 ] || exit 0
if [ -z "$W" ]; then echo "orphans.sh: --kill needs a worktree; it stops only that worktree's processes" >&2; exit 2; fi
# vitest runs before their workers (a worker outlives its killed run), Factorio and servers last
pids=""
for kind in vitest vitest-worker factorio vite esbuild; do
  case ",$KINDS," in *",$kind,"*) ;; *) continue ;; esac
  pids="$pids $(python3 "$HERE/procs.py" --worktree "$W" --kinds "$kind" --pids | tr '\n' ' ')"
done
pids=$(echo $pids)
if [ -z "$pids" ]; then echo "== nothing to stop in $W"; exit 0; fi
if [ "$DRY" = 1 ]; then echo "== --kill --dry-run: would stop (TERM, then KILL after 10 s): $pids"; exit 0; fi
echo "== stopping $pids"
kill -TERM $pids 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do
  left=""; for p in $pids; do kill -0 "$p" 2>/dev/null && left="$left $p"; done
  [ -z "$left" ] && break
  sleep 1
done
if [ -n "$left" ]; then echo "== still running after TERM, killing:$left"; kill -KILL $left 2>/dev/null; fi
left=$(python3 "$HERE/procs.py" --worktree "$W" --kinds "$KINDS" --pids | tr '\n' ' ')
if [ -n "$left" ]; then echo "== still there: $left"; exit 1; fi
echo "== none left in $W"
