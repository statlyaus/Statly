#!/usr/bin/env bash
set -euo pipefail
title="${1:-codex-change}"
date="$(date +%Y%m%d-%H%M%S)"
slug="$(echo "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g;s/^-+|-+$//g' | cut -c1-40)"
branch="codex/${date}-${slug}"
git fetch origin --quiet
git checkout -b "$branch"
echo "$branch"
