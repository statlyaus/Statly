#!/usr/bin/env bash
set -euo pipefail
msg="${1:-chore(codex): automated changes}"
git add -A
# prevent empty commits
if git diff --cached --quiet; then
  echo "Nothing to commit."
  exit 0
fi
git commit -m "$msg"
