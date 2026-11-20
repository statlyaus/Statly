#!/usr/bin/env bash
#
# Create or drop a throwaway PostgreSQL database on the local Homebrew postgresql@16 server.
#
# Usage:
#   Scripts/dev/scratch-db.sh up <name>     create statly_scratch_<name> and migrate it
#   Scripts/dev/scratch-db.sh down <name>   drop statly_scratch_<name>
#
# `up` prints both connection variables as export lines on stdout (progress goes to stderr), so
#   eval "$(Scripts/dev/scratch-db.sh up mytest)"
# points the current shell at the scratch database. DIRECT_DATABASE_URL is always set alongside
# DATABASE_URL: Prisma Migrate reads DIRECT_DATABASE_URL, and without it falls back to the value in
# .env and migrates the development database instead.
#
# Only names under statly_scratch_ are accepted. The script never reads .env files or prisma/dev.db.
# PGHOST, PGPORT and PGUSER override the defaults (127.0.0.1, 5432, the Mac user Homebrew trusts).

set -euo pipefail

usage() {
  echo "Usage: Scripts/dev/scratch-db.sh up|down <name>   (name: lowercase letters, digits, _)" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
action="$1"
name="${2#statly_scratch_}"

refuse() {
  echo "scratch-db: refusing '$1': only throwaway statly_scratch_<name> databases are handled" >&2
  exit 2
}

# A full database name such as statly_fantasy_dev is a real database, not a scratch name.
[[ "$name" == statly_* ]] && refuse "$2"
if [[ ! "$name" =~ ^[a-z0-9_]{1,48}$ ]]; then
  echo "scratch-db: name must be 1-48 lowercase letters, digits or underscores" >&2
  exit 2
fi
database="statly_scratch_${name}"
case "$database" in
  statly_fantasy_dev | statly_fantasy_test) refuse "$database" ;;
  statly_scratch_?*) ;;
  *) refuse "$database" ;;
esac

brew_bin="/opt/homebrew/opt/postgresql@16/bin"
[[ -d "$brew_bin" ]] && PATH="$brew_bin:$PATH"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-$USER}"

if ! pg_isready -q; then
  echo "scratch-db: no PostgreSQL on $PGHOST:$PGPORT; run: brew services start postgresql@16" >&2
  exit 1
fi

exists() {
  [[ "$(psql -d postgres -Atc "select 1 from pg_database where datname = '$database'")" == "1" ]]
}

case "$action" in
  up)
    if exists; then
      echo "scratch-db: reusing existing $database" >&2
    else
      createdb "$database"
      echo "scratch-db: created $database" >&2
    fi
    url="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${database}"
    cd "$(git rev-parse --show-toplevel)"
    # Prisma output goes to stderr so stdout stays eval-able.
    DATABASE_URL="$url" DIRECT_DATABASE_URL="$url" ./node_modules/.bin/prisma migrate deploy >&2
    echo "scratch-db: $database is migrated; drop it with: npm run db:scratch -- down $name" >&2
    printf "export DATABASE_URL='%s'\n" "$url"
    printf "export DIRECT_DATABASE_URL='%s'\n" "$url"
    ;;
  down)
    if exists; then
      dropdb --force "$database"
      echo "scratch-db: dropped $database" >&2
    else
      echo "scratch-db: $database does not exist" >&2
    fi
    ;;
  *) usage ;;
esac
