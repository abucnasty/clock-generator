#!/usr/bin/env bash
# portal-has-version.sh <mod> <version>
#
# Prints `true` when the Factorio mod portal has this version of the mod, `false` when it does not. A portal that cannot
# be read is an error (the script fails), not a version that is missing. Needs curl and jq.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: portal-has-version.sh <mod> <version>" >&2
  exit 2
fi
RELEASES=$(curl -fsS "https://mods.factorio.com/api/mods/$1/full")
if echo "$RELEASES" | jq -e --arg v "$2" '.releases[] | select(.version == $v)' > /dev/null; then
  echo true
else
  echo false
fi
