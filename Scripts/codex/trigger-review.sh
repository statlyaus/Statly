#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Find the current branch PR and comment a trigger Codex understands
# Common triggers are: "codex: review", "/review", "@codex review"
TRIGGER="${1:-codex: review}"

# Get PR number for current branch
PR_NUMBER=$(gh pr view --json number -q .number || true)
if [ -z "${PR_NUMBER:-}" ]; then
  echo "No PR found for this branch. Create one first (npm run codex:pr)."
  exit 1
fi

gh pr comment "$PR_NUMBER" --body "$TRIGGER"
echo "Triggered Codex with: $TRIGGER on PR #$PR_NUMBER"
