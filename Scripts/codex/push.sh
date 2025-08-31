#!/usr/bin/env bash
set -euo pipefail
branch="$(git rev-parse --abbrev-ref HEAD)"
git push -u origin "$branch"
echo "$branch"
