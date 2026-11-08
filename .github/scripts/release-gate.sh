#!/usr/bin/env bash
# release-gate.sh <repo> <sha> <branch>
#
# Tells whether a commit pushed to <branch> is a release or a hotfix merge, the only two merges that release.
#
# It looks up the pull requests of the commit (gh api repos/<repo>/commits/<sha>/pulls) and keeps the one that is
#   - merged, and whose merge commit is <sha>;
#   - from a branch of <repo> (a pull request from a fork never releases);
#   - into <branch>, the branch that was pushed. Without this, creating hotfix/0.28.2 from the tag v0.28.1 would push the
#     commit of the tag, whose pull request is the release pull request into master, and take the release path.
# The merge is a release when the pull request is into master, from a branch release/<slug>, titled `release: ...`.
# It is a hotfix when the pull request is into a branch hotfix/<version> and titled `hotfix: ...`.
#
# It prints one line, `release: ...`, `hotfix: ...` or `no release: <reason>`, and succeeds. When GITHUB_OUTPUT is set it
# also writes `release=true|false`, `kind=release|hotfix|none` and `pr=<number>`. It fails only when GitHub cannot be read.
# <sha> may be short. Needs gh, with GH_TOKEN or a gh login, and jq. Run it by hand, for example:
#
#   .github/scripts/release-gate.sh abucnasty/clock-generator 60cb513a master
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: release-gate.sh <repo> <sha> <branch>" >&2
  exit 2
fi
REPO=$1
BRANCH=$3
SHA=$(gh api "repos/$REPO/commits/$2" --jq .sha)

PR=$(gh api --paginate "repos/$REPO/commits/$SHA/pulls" | jq -s -c --arg sha "$SHA" --arg repo "$REPO" --arg branch "$BRANCH" '
  [ .[][]
    | select(.merged_at != null and .merge_commit_sha == $sha and .head.repo.full_name == $repo and .base.ref == $branch)
    | { number, base: .base.ref, head: .head.ref, title } ]
  | first // empty')

NUMBER=""
KIND=none
if [ -z "$PR" ]; then
  REASON="no merged pull request of $REPO into $BRANCH has the merge commit ${SHA:0:7}"
else
  NUMBER=$(jq -r .number <<< "$PR")
  BASE=$(jq -r .base <<< "$PR")
  HEAD=$(jq -r .head <<< "$PR")
  TITLE=$(jq -r .title <<< "$PR")
  if [[ $BASE == master && $HEAD == release/* && $TITLE =~ ^release: ]]; then
    KIND=release
  elif [[ $BASE == hotfix/* && $TITLE =~ ^hotfix: ]]; then
    KIND=hotfix
  else
    REASON="#$NUMBER \"$TITLE\" (into $BASE, from $HEAD) is neither a release nor a hotfix pull request"
  fi
fi

if [ "$KIND" = none ]; then
  echo "no release: $REASON"
  RELEASE=false
else
  echo "$KIND: #$NUMBER \"$TITLE\" (into $BASE, from $HEAD), merge commit ${SHA:0:7}"
  RELEASE=true
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "release=$RELEASE"
    echo "kind=$KIND"
    echo "pr=$NUMBER"
  } >> "$GITHUB_OUTPUT"
fi
