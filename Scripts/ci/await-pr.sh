#!/usr/bin/env bash
#
# Wait for a pull request to reach a state an agent must act on, then print exactly one line and exit:
#   MERGED <sha>             merged; <sha> is the merge commit on main            (exit 0)
#   FAILED <check>, <check>  a check failed and blocks the merge                 (exit 1)
#   CHANGES_REQUESTED        a reviewer requested changes                          (exit 1)
#   BEHIND                   behind main and auto-merge is off, so nobody updates it (exit 1)
#   DIRTY                    merge conflicts with main                            (exit 1)
#   CLOSED                   closed without merging                               (exit 1)
#   TIMEOUT                  none of the above within --timeout-min               (exit 2)
#
# A BEHIND pull request with auto-merge on is the PR queue workflow's job (docs/development/delivery.md),
# so the script keeps waiting. Failing checks that do not block the merge (GitHub's UNSTABLE state,
# such as an advisory bot) do not end the wait either.
#
# It polls once every 60 seconds: one GraphQL call per poll, or a few REST calls when the GraphQL
# limit is used up. A failed poll (network, rate limit) is retried at the next tick, never in a loop.
# Run it with Bash `run_in_background` (one notification when it exits), or with the Monitor tool
# and `--timeout-min` at or under the monitor's own deadline.
#
# Usage: Scripts/ci/await-pr.sh <pr-number> [--timeout-min N]   (default 60)
# Env: GH_REPO overrides the repository (default statlyaus/Statly).
set -uo pipefail

usage() { echo "usage: $0 <pr-number> [--timeout-min N]" >&2; exit 64; }

pr="${1:-}"
[[ "$pr" =~ ^[0-9]+$ ]] || usage
shift
timeout_min=60
while (($#)); do
  case "$1" in
    --timeout-min) [[ "${2:-}" =~ ^[0-9]+$ ]] || usage; timeout_min="$2"; shift 2 ;;
    *) usage ;;
  esac
done

repo="${GH_REPO:-statlyaus/Statly}"
interval=60
failing='["FAILURE","TIMED_OUT","CANCELLED","ACTION_REQUIRED","STARTUP_FAILURE","ERROR"]'

# Each poll prints "<state> <merge_state> <review> <auto_merge> <merge_sha>\t<failed checks>".
poll_graphql() {
  local json
  json="$(gh pr view "$pr" --repo "$repo" \
    --json state,mergeCommit,mergeStateStatus,reviewDecision,autoMergeRequest,statusCheckRollup 2>/dev/null)" || return 1
  jq -r --argjson f "$failing" '"\(.state) \(.mergeStateStatus) \(if (.reviewDecision // "") == "" then "NONE" else .reviewDecision end) \(if .autoMergeRequest then "on" else "off" end) \(.mergeCommit.oid // "-")\t\([.statusCheckRollup[] | select((.conclusion // .state) as $c | $f | index($c)) | .name // .context] | unique | join(", "))"' <<<"$json"
}

poll_rest() {
  local json sha state review failed
  json="$(gh api "repos/$repo/pulls/$pr" 2>/dev/null)" || return 1
  sha="$(jq -r '.head.sha' <<<"$json")"
  state="$(jq -r 'if .merged then "MERGED" else .state | ascii_upcase end' <<<"$json")"
  # Latest decisive review per reviewer; any CHANGES_REQUESTED among them is the decision.
  review="$(gh api "repos/$repo/pulls/$pr/reviews?per_page=100" --jq '
    [.[] | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED")]
    | group_by(.user.login) | map(last.state)
    | if index("CHANGES_REQUESTED") then "CHANGES_REQUESTED" else "NONE" end' 2>/dev/null)" || return 1
  failed="$(
    {
      # shellcheck disable=SC2016 # jq variables, not shell ones.
      gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --jq '.check_runs[] | select(.conclusion as $c
        | ["failure","timed_out","cancelled","action_required","startup_failure"] | index($c)) | .name'
      gh api "repos/$repo/commits/$sha/status" --jq '.statuses[] | select(.state == "failure" or .state == "error") | .context'
    } 2>/dev/null | sort -u | paste -sd, - | sed 's/,/, /g'
  )"
  jq -r --arg state "$state" --arg review "$review" --arg failed "$failed" \
    '"\($state) \(.mergeable_state | ascii_upcase) \($review) \(if .auto_merge then "on" else "off" end) \(.merge_commit_sha // "-")\t\($failed)"' <<<"$json"
}

deadline=$(($(date +%s) + timeout_min * 60))
while :; do
  if line="$(poll_graphql || poll_rest)" && [[ -n "$line" ]]; then
    read -r state merge_state review auto_merge merge_sha <<<"${line%%$'\t'*}"
    failed="${line#*$'\t'}"
    case "$state" in
      MERGED) echo "MERGED $merge_sha"; exit 0 ;;
      CLOSED) echo "CLOSED"; exit 1 ;;
    esac
    if [[ -n "$failed" && "$merge_state" != UNSTABLE ]]; then echo "FAILED $failed"; exit 1; fi
    if [[ "$review" == CHANGES_REQUESTED ]]; then echo "CHANGES_REQUESTED"; exit 1; fi
    if [[ "$merge_state" == DIRTY ]]; then echo "DIRTY"; exit 1; fi
    if [[ "$merge_state" == BEHIND && "$auto_merge" == off ]]; then echo "BEHIND"; exit 1; fi
  fi
  if (($(date +%s) + interval > deadline)); then echo "TIMEOUT"; exit 2; fi
  sleep "$interval"
done
