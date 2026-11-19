#!/usr/bin/env bash
#
# Print everything an agent needs to act on a pull request, in one call:
#   - merge state (state, mergeable, mergeStateStatus, review decision, auto-merge)
#   - each failing check with its workflow/job name and the first error lines of its log
#   - unresolved review threads as path:line, author and the first line of the first comment
#
# Use it instead of hand-rolled `gh pr checks`, `gh run view` and grep. Output is compact plain text.
# When GitHub's GraphQL limit is used up it falls back to REST and says so; REST cannot tell
# resolved review threads from unresolved ones, so that section then lists every top-level comment.
# Prints no secrets: only PR metadata and CI log lines, which are already public on this repository.
#
# Usage: Scripts/ci/pr-failures.sh <pr-number> [--lines N]
#   --lines N   error lines kept per failing job (default 30)
# Env: GH_REPO overrides the repository (default statlyaus/Statly).
set -euo pipefail

usage() { echo "usage: $0 <pr-number> [--lines N]" >&2; exit 64; }

pr="${1:-}"
[[ "$pr" =~ ^[0-9]+$ ]] || usage
shift
lines=30
while (($#)); do
  case "$1" in
    --lines) [[ "${2:-}" =~ ^[0-9]+$ ]] || usage; lines="$2"; shift 2 ;;
    *) usage ;;
  esac
done

repo="${GH_REPO:-statlyaus/Statly}"
owner="${repo%%/*}"
name="${repo##*/}"
# Conclusions (check runs) and states (commit statuses) that mean "this check failed".
failing='["FAILURE","TIMED_OUT","CANCELLED","ACTION_REQUIRED","STARTUP_FAILURE","ERROR","failure","timed_out","cancelled","action_required","startup_failure","error"]'

# Lines that name a failure, and lines that look like one but are known noise in this repository's logs.
strong='^[[:space:]]*(FAIL([[:space:]]|$)|×|✗|✘|[0-9]+\) )|##\[error\]|[A-Za-z]*Error: |^[[:space:]]*(Expected|Received)( [a-z]+)*:|[0-9]+ failed|error TS[0-9]+|npm ERR!|exit code [1-9]|not ok '
noise='^[[:space:]]*✓|Error Context:|INTERNAL ASSERTION FAILED|UTC \[[0-9]+\] LOG:'

graphql_left="$(gh api rate_limit --jq '.resources.graphql.remaining' 2>/dev/null || echo 0)"
mode=graphql
if ((graphql_left < 20)); then
  mode=rest
  echo "NOTE: GraphQL rate limit exhausted ($graphql_left left); using REST. Review threads below include resolved ones."
fi

# Prints "<name>\t<details url>" for every failing check.
if [[ "$mode" == graphql ]]; then
  pr_json="$(gh pr view "$pr" --repo "$repo" \
    --json number,title,state,mergeable,mergeStateStatus,reviewDecision,autoMergeRequest,headRefOid,statusCheckRollup)"
  jq -r '"PR #\(.number) \(.state) mergeable=\(.mergeable) merge_state=\(.mergeStateStatus) review=\(if (.reviewDecision // "") == "" then "NONE" else .reviewDecision end) auto_merge=\(if .autoMergeRequest then "on" else "off" end) head=\(.headRefOid[0:9])\n  \(.title)"' <<<"$pr_json"
  failed="$(jq -r --argjson f "$failing" '.statusCheckRollup[]
      | select((.conclusion // .state) as $c | $f | index($c))
      | "\((.workflowName // "") as $w | if $w == "" then "" else $w + " / " end)\(.name // .context)\t\(.detailsUrl // .targetUrl // "")"' <<<"$pr_json")"
  pending="$(jq '[.statusCheckRollup[] | select((.status // "COMPLETED") != "COMPLETED" or .state == "PENDING")] | length' <<<"$pr_json")"
else
  pr_json="$(gh api "repos/$repo/pulls/$pr")"
  sha="$(jq -r '.head.sha' <<<"$pr_json")"
  jq -r '"PR #\(.number) \(if .merged then "MERGED" else .state | ascii_upcase end) mergeable=\(.mergeable) merge_state=\(.mergeable_state | ascii_upcase) review=(REST: see threads) auto_merge=\(if .auto_merge then "on" else "off" end) head=\(.head.sha[0:9])\n  \(.title)"' <<<"$pr_json"
  runs="$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100")"
  statuses="$(gh api "repos/$repo/commits/$sha/status")"
  failed="$(
    jq -r --argjson f "$failing" '.check_runs[] | select(.conclusion as $c | $f | index($c)) | "\(.name)\t\(.html_url // .details_url)"' <<<"$runs"
    jq -r --argjson f "$failing" '.statuses[] | select(.state as $c | $f | index($c)) | "\(.context)\t\(.target_url // "")"' <<<"$statuses"
  )"
  pending="$(jq '[.check_runs[] | select(.status != "completed")] | length' <<<"$runs")"
fi

echo
if [[ -z "${failed//[[:space:]]/}" ]]; then
  echo "FAILING CHECKS: none ($pending still running)"
else
  failed="$(grep . <<<"$failed")"
  echo "FAILING CHECKS: $(wc -l <<<"$failed" | tr -d ' ') ($pending still running)"
  while IFS=$'\t' read -r check url; do
    echo "--- $check"
    echo "    $url"
    job="$(sed -nE 's#.*/actions/runs/[0-9]+/job/([0-9]+).*#\1#p' <<<"$url")"
    if [[ -z "$job" ]]; then
      echo "    (not a GitHub Actions job; open the URL)"
      continue
    fi
    # --log-failed lines are "<job>\t<step>\t<timestamp> <text>"; keep the text, drop ANSI and group markers.
    log="$(gh run view --repo "$repo" --job "$job" --log-failed 2>/dev/null |
      awk -F'\t' '{ t = $3; sub(/^[0-9-]+T[0-9:.]+Z ?/, "", t); print t }' |
      sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g' |
      grep -vE '^[[:space:]]*(##\[(group|endgroup)\].*)?$' || true)"
    if [[ -z "$log" ]]; then
      echo "    (no failed-step log yet: job still running, cancelled before a step ran, or logs expired)"
      continue
    fi
    # Test-runner and tool failure markers (Vitest, Playwright, tsc, npm, GitHub's ##[error]), deduplicated.
    errors="$(grep -E "$strong" <<<"$log" | grep -vE "$noise" | awk '!seen[$0]++' | head -n "$lines" || true)"
    # No recognisable error line: the end of the log is usually where the cause is.
    [[ -n "$errors" ]] || errors="$(tail -n "$lines" <<<"$log")"
    while IFS= read -r l; do echo "    ${l:0:240}"; done <<<"$errors"
  done < <(grep . <<<"$failed")
fi

echo
# A comment's summary is its first line that is not blank, an _emphasis-only_ badge line (CodeRabbit) or HTML.
if [[ "$mode" == graphql ]]; then
  # shellcheck disable=SC2016 # GraphQL variables, not shell ones.
  threads="$(gh api graphql -F owner="$owner" -F name="$name" -F pr="$pr" -f query='
    query($owner: String!, $name: String!, $pr: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes { isResolved isOutdated path line originalLine
              comments(first: 1) { nodes { author { login } body } } }
          }
        }
      }
    }' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)
      | "\(.path):\(.line // .originalLine)\(if .isOutdated then " (outdated)" else "" end) \(.comments.nodes[0].author.login // "?"): \(.comments.nodes[0].body | split("\n") | map(select(test("^\\s*$|^\\s*_.*_\\s*$|^\\s*<") | not)) | .[0] // "" | gsub("\\*\\*"; ""))"')"
  label="UNRESOLVED REVIEW THREADS"
else
  threads="$(gh api "repos/$repo/pulls/$pr/comments?per_page=100" --jq '.[] | select(.in_reply_to_id == null)
    | "\(.path):\(.line // .original_line) \(.user.login): \(.body | split("\n") | map(select(test("^\\s*$|^\\s*_.*_\\s*$|^\\s*<") | not)) | .[0] // "" | gsub("\\*\\*"; ""))"')"
  label="REVIEW COMMENTS (REST, resolved state unknown)"
fi
if [[ -z "$threads" ]]; then
  echo "$label: none"
else
  echo "$label: $(grep -c . <<<"$threads")"
  cut -c1-240 <<<"$threads" | sed 's/^/  /'
fi
