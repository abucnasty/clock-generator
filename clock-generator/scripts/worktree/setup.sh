#!/bin/bash
# setup.sh <worktree> [--check] [--unlink] [--no-ui] [--no-build]
#
# Gives a worktree its own node_modules: `npm ci` in <worktree>/clock-generator, `npm run build` there (dist/, which the
# UI and the generation tests load), then `npm ci` in <worktree>/clock-generator-ui, whose `clock-generator` dependency
# (file:../clock-generator) npm links to this worktree's engine. It never runs the UI's build:deps, and it never
# installs through a symlink: a node_modules that is a link (to the main checkout's, say) is refused, and with
# --unlink removed with `unlink` (the link only, never what it points to) before the install. It refuses the main
# checkout itself, a worktree whose package folders are links, and a worktree with live vitest, Factorio or vite
# processes (procs.py), whose modules an install would pull away. Ends with a check, which --check prints alone.
#
#   --check     print the check only; install nothing
#   --unlink    remove a node_modules symlink (with unlink) and install a real folder in its place
#   --no-ui     the engine only
#   --no-build  skip `npm run build`
set -u
HERE=$(cd "$(dirname "$0")" && pwd -P)
MAIN=$(cd "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
W=""; CHECK=0; UNLINK=0; UI=1; BUILD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --unlink) UNLINK=1 ;;
    --no-ui) UI=0 ;;
    --no-build) BUILD=0 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) echo "setup.sh: unknown option $1" >&2; exit 2 ;;
    *) W=$1 ;;
  esac
  shift
done
die() { echo "setup.sh: $*" >&2; exit 1; }
[ -n "$W" ] || die "usage: setup.sh <worktree> [--check] [--unlink] [--no-ui] [--no-build]"
[ -d "$W" ] || die "no folder $W"
W=$(cd "$W" && pwd -P)
[ "$W" != "$MAIN" ] || die "$W is the main checkout; its node_modules are shared with older worktrees by link, set it up by hand when no session uses it"
top=$(git -C "$W" rev-parse --show-toplevel 2>/dev/null) || die "$W is not a git worktree"
[ "$(cd "$top" && pwd -P)" = "$W" ] || die "$W is not the top of a worktree (that is $top)"

PKGS="clock-generator"; [ "$UI" = 1 ] && PKGS="$PKGS clock-generator-ui"

check() {
  local bad=0 pkg nm
  echo "== check of $W ($(git -C "$W" rev-parse --short HEAD) $(git -C "$W" rev-parse --abbrev-ref HEAD))"
  for pkg in $PKGS; do
    nm="$W/$pkg/node_modules"
    if [ -L "$nm" ]; then echo "   BAD  $pkg/node_modules is a symlink to $(readlink "$nm")"; bad=1
    elif [ ! -d "$nm" ]; then echo "   BAD  $pkg/node_modules is missing"; bad=1
    else
      case "$(cd "$nm" && pwd -P)/" in
        "$W/$pkg/node_modules/") echo "   ok   $pkg/node_modules is the worktree's own folder" ;;
        *) echo "   BAD  $pkg/node_modules resolves to $(cd "$nm" && pwd -P)"; bad=1 ;;
      esac
    fi
  done
  if [ -f "$W/clock-generator/node_modules/vitest/package.json" ]; then
    echo "   ok   vitest $(node -p "require('$W/clock-generator/node_modules/vitest/package.json').version")"
  else echo "   BAD  no vitest in clock-generator/node_modules"; bad=1; fi
  if [ "$BUILD" = 1 ]; then
    if [ -f "$W/clock-generator/dist/index.js" ]; then echo "   ok   clock-generator/dist is built"
    else echo "   BAD  clock-generator/dist/index.js is missing (npm run build)"; bad=1; fi
  fi
  if [ "$UI" = 1 ]; then
    local link="$W/clock-generator-ui/node_modules/clock-generator"
    if [ -e "$link" ] && [ "$(cd "$link" && pwd -P)" = "$W/clock-generator" ]; then
      echo "   ok   clock-generator-ui/node_modules/clock-generator -> this worktree's engine ($(readlink "$link"))"
    else echo "   BAD  clock-generator-ui/node_modules/clock-generator does not resolve to $W/clock-generator"; bad=1; fi
    if [ -d "$W/clock-generator-ui/node_modules/playwright" ]; then echo "   ok   playwright is installed (npm run test:browser also needs its browser: npx playwright install chromium)"
    else echo "   note playwright is not installed: npm run test:browser fails here; CI runs it"; fi
  fi
  local changed
  changed=$(git -C "$W" status --porcelain -- clock-generator/package-lock.json clock-generator-ui/package-lock.json clock-generator/package.json clock-generator-ui/package.json)
  if [ -n "$changed" ]; then echo "   BAD  package files changed: $changed"; bad=1; else echo "   ok   package.json and package-lock.json files unchanged"; fi
  echo "   node $(node --version), npm $(npm --version) (CI uses npm 11.19.0; npm ci writes no lockfile)"
  [ "$bad" = 0 ] && echo "== ready" || echo "== NOT ready"
  return $bad
}

if [ "$CHECK" = 1 ]; then check; exit $?; fi

for pkg in $PKGS; do
  [ -d "$W/$pkg" ] || die "no $pkg in $W"
  [ ! -L "$W/$pkg" ] || die "$W/$pkg is a symlink; refusing"
  [ "$(cd "$W/$pkg" && pwd -P)" = "$W/$pkg" ] || die "$W/$pkg resolves outside the worktree; refusing"
done
live=$(python3 "$HERE/procs.py" --worktree "$W")
if [ -n "$live" ]; then
  echo "$live"
  die "processes of this worktree are running (above); stop them first (scripts/worktree/orphans.sh $W --kill)"
fi
for pkg in $PKGS; do
  nm="$W/$pkg/node_modules"
  if [ -L "$nm" ]; then
    if [ "$UNLINK" = 1 ]; then
      echo "== $pkg/node_modules is a symlink to $(readlink "$nm"): removing the link only (unlink)"
      unlink "$nm" || die "could not unlink $nm"
    else
      die "$pkg/node_modules is a symlink to $(readlink "$nm"); npm ci through it would empty its target. Rerun with --unlink to replace the link with the worktree's own folder"
    fi
  fi
done

run() { echo "== ($1) $2"; (cd "$W/$1" && eval "$2") || die "$2 failed in $1"; }
# the last guard before an install: node_modules is absent or a real folder inside this worktree
own_modules() {
  local nm="$W/$1/node_modules"
  [ ! -L "$nm" ] || die "$1/node_modules is still a symlink; not installing"
  if [ -e "$nm" ]; then [ "$(cd "$nm" && pwd -P)" = "$nm" ] || die "$1/node_modules resolves outside the worktree; not installing"; fi
}
own_modules clock-generator
run clock-generator "npm ci --no-audit --no-fund"
[ "$BUILD" = 1 ] && run clock-generator "npm run build"
if [ "$UI" = 1 ]; then
  # never `npm run build:deps` (cd ../clock-generator && npm ci): the engine was installed above
  own_modules clock-generator-ui
  run clock-generator-ui "npm ci --no-audit --no-fund"
fi
check
