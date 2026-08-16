#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

export STATLY_LOCAL_PROJECT_ID="${STATLY_LOCAL_PROJECT_ID:-statly-4cbed}"
export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8080}"
export FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST:-127.0.0.1:9099}"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-$STATLY_LOCAL_PROJECT_ID}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-$STATLY_LOCAL_PROJECT_ID}"
export NEXT_PUBLIC_USE_EMULATORS="${NEXT_PUBLIC_USE_EMULATORS:-true}"
export NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST="${NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST:-127.0.0.1}"
export NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT="${NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT:-8080}"
export NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL="${NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL:-http://127.0.0.1:9099}"
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-$STATLY_LOCAL_PROJECT_ID}"
if [[ -z "${NEXT_PUBLIC_FIREBASE_API_KEY:-}" ]]; then
  NEXT_PUBLIC_FIREBASE_API_KEY="$(printf '%s' "$STATLY_LOCAL_PROJECT_ID" | shasum -a 256 | awk '{print "local-" substr($1, 1, 20)}')"
  export NEXT_PUBLIC_FIREBASE_API_KEY
fi
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:-$STATLY_LOCAL_PROJECT_ID.firebaseapp.com}"
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-$STATLY_LOCAL_PROJECT_ID.appspot.com}"
export NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:-000000000000}"
export NEXT_PUBLIC_FIREBASE_APP_ID="${NEXT_PUBLIC_FIREBASE_APP_ID:-1:000000000000:web:local}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3000}"
export APP_BASE_URL="${APP_BASE_URL:-http://localhost:3000}"
export SOCKET_PORT="3002"
export SOCKETIO_PORT="3002"
export SOCKET_IO_PORT="3002"
export NEXT_PUBLIC_SOCKET_URL="http://localhost:3002"
export STATLY_ENABLE_DEV_TOOLS="true"
export AFL_TRADE_PUBLIC_READ_MODE="postgres"
export AFL_TRADE_PUBLIC_READ_ENVIRONMENT="${AFL_TRADE_PUBLIC_READ_ENVIRONMENT:-test_fixture}"
STATLY_NEXT_DEV_BUNDLER="${STATLY_NEXT_DEV_BUNDLER:-turbopack}"
if [[ "$STATLY_NEXT_DEV_BUNDLER" != "turbopack" && "$STATLY_NEXT_DEV_BUNDLER" != "webpack" ]]; then
  echo "local stack: STATLY_NEXT_DEV_BUNDLER must be turbopack or webpack" >&2
  exit 1
fi
STATLY_LOCAL_REUSE_OUTCOMES_DATABASE="${STATLY_LOCAL_REUSE_OUTCOMES_DATABASE:-false}"
if [[ "$STATLY_LOCAL_REUSE_OUTCOMES_DATABASE" != "true" && "$STATLY_LOCAL_REUSE_OUTCOMES_DATABASE" != "false" ]]; then
  echo "local stack: STATLY_LOCAL_REUSE_OUTCOMES_DATABASE must be true or false" >&2
  exit 1
fi
if [[ "$STATLY_LOCAL_REUSE_OUTCOMES_DATABASE" == "true" ]]; then
  if [[ -z "${AFL_OUTCOMES_DATABASE_URL:-}" ]]; then
    echo "local stack: AFL_OUTCOMES_DATABASE_URL is required when reusing an outcomes database" >&2
    exit 1
  fi
  node -e '
    const value = process.env.AFL_OUTCOMES_DATABASE_URL;
    const url = new URL(value);
    const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !loopback.has(url.hostname)) {
      throw new Error("the reused outcomes database must be loopback PostgreSQL");
    }
    if (url.pathname !== "/statly_outcomes_test") {
      throw new Error("the reused outcomes database must be statly_outcomes_test");
    }
  '
else
  export AFL_OUTCOMES_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable"
fi
export AFL_TRADE_LOCAL_ARTIFACT_ROOT="${AFL_TRADE_LOCAL_ARTIFACT_ROOT:-$ROOT_DIR/.statly-local/afl-trade-artifacts}"
OUTCOMES_NONCE_PATH="$ROOT_DIR/.statly-local/afl-trade-outcomes-runtime-nonce"
if [[ "$STATLY_LOCAL_REUSE_OUTCOMES_DATABASE" == "true" ]]; then
  if [[ ! "${STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE:-}" =~ ^[a-f0-9]{64}$ ]]; then
    echo "local stack: the reused outcomes database requires its 64-character runtime nonce" >&2
    exit 1
  fi
else
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
fi
export STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE
if [[ -z "${AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64:-}" ]]; then
  AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")"
fi
export AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64

FIREBASE_PID=""
OUTCOMES_PID=""

cleanup() {
  if [[ -n "$FIREBASE_PID" ]] && kill -0 "$FIREBASE_PID" >/dev/null 2>&1; then
    kill "$FIREBASE_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$OUTCOMES_PID" ]] && kill -0 "$OUTCOMES_PID" >/dev/null 2>&1; then
    kill "$OUTCOMES_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$STATLY_LOCAL_REUSE_OUTCOMES_DATABASE" == "false" ]]; then
    rm -f -- "$OUTCOMES_NONCE_PATH"
  fi
}

trap cleanup EXIT INT TERM

wait_for_port() {
  local name="$1"
  local host="$2"
  local port="$3"
  local attempts="${4:-60}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if nc -z "$host" "$port" >/dev/null 2>&1; then
      echo "local stack: $name is ready on $host:$port"
      return 0
    fi

    if [[ -n "$FIREBASE_PID" ]] && ! kill -0 "$FIREBASE_PID" >/dev/null 2>&1; then
      echo "local stack: Firebase emulator process exited before $name was ready" >&2
      return 1
    fi

    sleep 1
  done

  echo "local stack: timed out waiting for $name on $host:$port" >&2
  return 1
}

port_is_open() {
  local host="$1"
  local port="$2"

  nc -z "$host" "$port" >/dev/null 2>&1
}

npm run dev:down >/dev/null 2>&1 || true

if [[ "$STATLY_LOCAL_REUSE_OUTCOMES_DATABASE" == "true" ]]; then
  echo "local stack: reusing the caller-owned disposable AFL outcomes database"
  ./node_modules/.bin/tsx Scripts/dev/verify-local-afl-trade-outcomes-db.ts
else
  if port_is_open "127.0.0.1" "55432"; then
    echo "local stack: refusing to reuse the unidentified service on 127.0.0.1:55432; stop it before starting the local stack" >&2
    exit 1
  fi

  npm run dev:outcomes-db &
  OUTCOMES_PID="$!"

  wait_for_port "AFL outcomes database" "127.0.0.1" "55432"
  if [[ -z "$OUTCOMES_PID" ]] || ! kill -0 "$OUTCOMES_PID" >/dev/null 2>&1; then
    echo "local stack: the Statly AFL outcomes process exited before ownership could be confirmed" >&2
    exit 1
  fi
  ./node_modules/.bin/tsx Scripts/dev/verify-local-afl-trade-outcomes-db.ts
fi

if port_is_open "127.0.0.1" "8080" && port_is_open "127.0.0.1" "9099"; then
  echo "local stack: reusing existing Firebase emulators on 127.0.0.1:8080 and 127.0.0.1:9099"
elif port_is_open "127.0.0.1" "8080" || port_is_open "127.0.0.1" "9099"; then
  echo "local stack: only one Firebase emulator port is available; stop stale Firebase processes and retry" >&2
  exit 1
else
  npm run dev:firebase -- --project "$STATLY_LOCAL_PROJECT_ID" &
  FIREBASE_PID="$!"
fi

wait_for_port "Firestore emulator" "127.0.0.1" "8080"
wait_for_port "Firebase Auth emulator" "127.0.0.1" "9099"

npm run prisma:generate
npx prisma migrate deploy
npm run dev:seed:local
if [[ "$STATLY_LOCAL_REUSE_OUTCOMES_DATABASE" == "true" ]]; then
  echo "local stack: preserving the caller-owned outcomes migrations and data"
else
  npm run outcomes:prisma:generate
  npm run outcomes:prisma:migrate:deploy
  npm run dev:outcomes:seed
fi

WEB_COMMAND="npm:dev"
if [[ "$STATLY_NEXT_DEV_BUNDLER" == "webpack" ]]; then
  npm run auth-worker:build
  WEB_COMMAND="./node_modules/.bin/next dev --webpack"
fi

npx concurrently -k -n web,socket,draft-worker -c blue,magenta,green \
  "$WEB_COMMAND" \
  "npm:socket" \
  "npm:draft-worker:dev"
