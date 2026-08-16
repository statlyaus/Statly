#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "workbook evaluation: production mode is prohibited" >&2
  exit 1
fi

if [[ -z "${AFL_OUTCOMES_DEV_WORKBOOK_PATH:-}" ]]; then
  echo "workbook evaluation: AFL_OUTCOMES_DEV_WORKBOOK_PATH is required" >&2
  exit 1
fi

if [[ ! -f "$AFL_OUTCOMES_DEV_WORKBOOK_PATH" ]]; then
  echo "workbook evaluation: the configured workbook is not a readable file" >&2
  exit 1
fi

if [[ ! "${AFL_OUTCOMES_DEV_WORKBOOK_SHA256:-}" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "workbook evaluation: AFL_OUTCOMES_DEV_WORKBOOK_SHA256 must be a 64-character digest" >&2
  exit 1
fi

if [[ -z "${AFL_OUTCOMES_DATABASE_URL:-}" ]]; then
  echo "workbook evaluation: AFL_OUTCOMES_DATABASE_URL is required" >&2
  exit 1
fi

if [[ -z "${STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE:-}" && -f "$ROOT_DIR/.statly-local/afl-trade-outcomes-runtime-nonce" ]]; then
  IFS= read -r STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE < "$ROOT_DIR/.statly-local/afl-trade-outcomes-runtime-nonce" || true
  export STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE
fi
if [[ ! "${STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE:-}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "workbook evaluation: STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE must authenticate the disposable database" >&2
  exit 1
fi

node -e '
  const url = new URL(process.env.AFL_OUTCOMES_DATABASE_URL);
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !loopback.has(url.hostname)) {
    throw new Error("workbook evaluation requires loopback PostgreSQL");
  }
  if (url.pathname !== "/statly_outcomes_test") {
    throw new Error("workbook evaluation requires the disposable statly_outcomes_test database");
  }
'

mkdir -p "$ROOT_DIR/.statly-local"
export AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED="true"
export DATABASE_URL="file:$ROOT_DIR/.statly-local/statly-app.db"
export STATLY_LOCAL_REUSE_OUTCOMES_DATABASE="true"
export AFL_TRADE_PUBLIC_READ_ENVIRONMENT="test_fixture"
export STATLY_NEXT_DEV_BUNDLER="webpack"

echo "workbook evaluation: authenticating and migrating the disposable outcomes database"
npx tsx Scripts/dev/verify-local-afl-trade-outcomes-db.ts
npm run outcomes:prisma:migrate:deploy

echo "workbook evaluation: retaining exact local player identity reviews"
npx tsx Scripts/dev/review-local-workbook-player-identities.ts

echo "workbook evaluation: verifying the pinned private input"
npm run outcomes:workbook:inspect

echo "workbook evaluation: verifying private synthetic valuation coverage"
npx tsx Scripts/dev/verify-local-workbook-synthetic-valuations.ts

echo "workbook evaluation: starting the disposable local stack"
exec npm run dev:full:all
