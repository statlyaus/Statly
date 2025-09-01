#!/usr/bin/env bash
set -euo pipefail
num="${1:?Usage: checkout-pr.sh <PR_NUMBER>}"
gh pr checkout "$num"
