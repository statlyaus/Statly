#!/usr/bin/env bash
set -euo pipefail
title="${1:-Codex: proposed change}"
body="${2:-Automated PR from Codex. Please review.}"
labels="${3:-codex,automation}"
draft="${DRAFT:-true}"
# ensure we’re on a feature branch
branch="$(git rev-parse --abbrev-ref HEAD)"
base="${BASE:-main}"
gh pr create \
  --title "$title" \
  --body "$body" \
  --label "$labels" \
  --base "$base" \
  $( [ "$draft" = "true" ] && echo --draft )
gh pr view --web
