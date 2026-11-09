#!/usr/bin/env bash
# tested-tree.sh <repo> <sha>
#
# Tells whether the tree of a commit was already tested by test.yml on a pull request of <repo>, so that the push run of
# release.yml can skip its tests.
#
# On a pull request, the `changes` job of test.yml uploads an artifact named `tested-tree-<tree>`, where <tree> is the tree
# of the merge commit that the run tested. This script takes the tree of <sha> (gh api repos/<repo>/commits/<sha>, the
# same value as `git rev-parse <sha>^{tree}`) and looks for such an artifact. It accepts one only when
#   - it is not expired;
#   - its workflow run is .github/workflows/test.yml, on the event pull_request, with the conclusion success;
#   - the head repository of that run is <repo>. A run from a fork may have changed the workflow and uploaded an artifact
#     that is not true: it is never trusted.
# A run whose Gen summary or Rec summary was skipped for a change of documentation only is accepted: the pull request
# passed under that rule.
#
# It prints one line, `tested: ...` or `not tested: <reason>`, and succeeds. When GITHUB_OUTPUT is set it also writes
# `tested=true|false`, `run=<run id>` and `pr=<number>`; when GITHUB_STEP_SUMMARY is set it writes the line there.
# It fails only when GitHub cannot be read. <sha> may be a branch name or short. Needs gh, with GH_TOKEN or a gh login,
# and jq. Run it by hand, for example:
#
#   .github/scripts/tested-tree.sh abucnasty/clock-generator master
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: tested-tree.sh <repo> <sha>" >&2
  exit 2
fi
REPO=$1
read -r SHA TREE < <(gh api "repos/$REPO/commits/$2" --jq '[.sha, .commit.tree.sha] | @tsv')

RUN=""
PR=""
URL=""
REASON="no artifact tested-tree-$TREE: no pull request of $REPO tested the tree of ${SHA:0:7}"
SEEN=0
# read first, so that a failure to read stops the script (set -e does not see inside the loop's process substitution);
# newest first; an expired artifact is gone, whatever its run says
CANDIDATES=$(gh api "repos/$REPO/actions/artifacts?name=tested-tree-$TREE&per_page=100" \
  --jq '.artifacts | map(select(.expired == false)) | sort_by(.created_at) | reverse | .[] | [.name, .workflow_run.id] | @tsv')
while IFS=$'\t' read -r ARTIFACT RUN_ID; do
  [ -n "$ARTIFACT" ] || continue
  SEEN=$((SEEN + 1))
  INFO=$(gh api "repos/$REPO/actions/runs/$RUN_ID" --jq '{ path, event, conclusion, repo: .head_repository.full_name, number: (.pull_requests[0].number // ""), url: .html_url }')
  # the path may carry the ref the workflow was read at: .github/workflows/test.yml@refs/...
  WHY=$(jq -r --arg repo "$REPO" '
    if (.path | split("@")[0]) != ".github/workflows/test.yml" then "its workflow is \(.path), not test.yml"
    elif .event != "pull_request" then "its event is \(.event), not pull_request"
    elif .conclusion != "success" then "its conclusion is \(.conclusion // "not final"), not success"
    elif .repo != $repo then "its head repository is \(.repo), not \($repo)"
    else "" end' <<< "$INFO")
  if [ -z "$WHY" ]; then
    RUN=$RUN_ID
    PR=$(jq -r .number <<< "$INFO")
    URL=$(jq -r .url <<< "$INFO")
    break
  fi
  REASON="$ARTIFACT of run $RUN_ID is not trusted: $WHY"
done <<< "$CANDIDATES"

if [ -n "$RUN" ]; then
  TESTED=true
  LINE="tested: the tree ${TREE:0:7} of ${SHA:0:7} passed test.yml in run $RUN${PR:+ (pull request #$PR)}, $URL"
else
  TESTED=false
  if [ "$SEEN" -gt 1 ]; then REASON="$REASON ($SEEN artifacts looked at)"; fi
  LINE="not tested: $REASON"
fi
echo "$LINE"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "$LINE" >> "$GITHUB_STEP_SUMMARY"
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "tested=$TESTED"
    echo "run=$RUN"
    echo "pr=$PR"
  } >> "$GITHUB_OUTPUT"
fi
