#!/usr/bin/env bash
#
# Local development helper for Statly's authenticated endpoints.
#
# This does not bypass authorization. It loads the same credentials the server
# expects from the environment or from .env.local and forwards them as headers,
# so local testing exercises the real checks rather than a development bypass.
# Secrets are written to a temporary header file and are never echoed or passed
# on the command line.
#
# Usage:
#   Scripts/dev/curl-admin.sh admin <path> [extra curl arguments...]
#   Scripts/dev/curl-admin.sh cron  <path> [extra curl arguments...]
#   Scripts/dev/curl-admin.sh user  <path> [extra curl arguments...]
#
# Examples:
#   Scripts/dev/curl-admin.sh admin /api/admin/queue
#   Scripts/dev/curl-admin.sh cron /api/cron/daily
#   Scripts/dev/curl-admin.sh user /api/user/leagues
#
# Expected local values in .env.local (never committed):
#   ADMIN_SECRET=<local operator secret>
#   CRON_SECRET=<local scheduler secret>
# For the `user` mode, both STATLY_ENABLE_DEV_AUTH and
# NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH must be true in a non-production process.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  Scripts/dev/curl-admin.sh admin <path> [extra curl arguments...]
  Scripts/dev/curl-admin.sh cron  <path> [extra curl arguments...]
  Scripts/dev/curl-admin.sh user  <path> [extra curl arguments...]
USAGE
  exit 2
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
base_url="${STATLY_LOCAL_BASE_URL:-http://localhost:3000}"

if [[ $# -lt 2 ]]; then
  usage
fi

mode="$1"
path="$2"
shift 2

read_local_secret() {
  local name="$1"
  local configured="${!name:-}"
  local env_file="$repo_root/.env.local"
  local matched

  if [[ -z "$configured" && -f "$env_file" ]]; then
    matched="$(grep -E "^${name}=" "$env_file" | tail -n 1 | cut -d '=' -f 2- | tr -d '\r' || true)"
    configured="${matched:-}"
  fi

  configured="${configured#\"}"
  configured="${configured%\"}"

  printf '%s' "$configured"
}

header_file="$(mktemp)"
trap 'rm -f "$header_file"' EXIT

case "$mode" in
  admin)
    secret="$(read_local_secret ADMIN_SECRET)"
    if [[ -z "$secret" ]]; then
      echo "ADMIN_SECRET is not set. Add it to .env.local; never commit it." >&2
      exit 1
    fi
    printf 'x-admin-secret: %s\n' "$secret" > "$header_file"
    ;;
  cron)
    secret="$(read_local_secret CRON_SECRET)"
    if [[ -z "$secret" ]]; then
      echo "CRON_SECRET is not set. Add it to .env.local; never commit it." >&2
      exit 1
    fi
    printf 'Authorization: Bearer %s\n' "$secret" > "$header_file"
    ;;
  user)
    user_id="${STATLY_DEV_AUTH_USER_ID:-statly-dev-tester}"
    printf 'Authorization: Bearer dev:%s\n' "$user_id" > "$header_file"
    ;;
  *)
    usage
    ;;
esac

# Not `exec curl`: the EXIT trap must still run to remove the header file.
set +e
curl -sS -H "@${header_file}" "$@" "${base_url}${path}"
status=$?
set -e
exit "$status"
