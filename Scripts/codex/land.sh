#!/usr/bin/env bash
set -euo pipefail
num="${1:?Usage: land.sh <PR_NUMBER>}"
method="${METHOD:-squash}" # squash|merge|rebase
gh pr merge "$num" --"$method" --delete-branch --auto
