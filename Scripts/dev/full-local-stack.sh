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
export AFL_TRADE_PUBLIC_READ_ENVIRONMENT="test_fixture"
export AFL_OUTCOMES_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable"
if [[ -z "${AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64:-}" ]]; then
  AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")"
fi
export AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64
export AFL_TRADE_OBJECT_BUCKET="statly-local-afl-trade-projections"
export AFL_TRADE_OBJECT_PREFIX="test-fixture"
export AFL_TRADE_OBJECT_KMS_KEY_ID="statly-local-only-no-production-authority"
export AFL_TRADE_OBJECT_REPOSITORY_ID="statly-local-afl-trade-projections"
export AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID="artifact:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
export AWS_REGION="ap-southeast-2"
export AWS_EC2_METADATA_DISABLED="true"

FIREBASE_PID=""
OUTCOMES_PID=""

cleanup() {
  if [[ -n "$FIREBASE_PID" ]] && kill -0 "$FIREBASE_PID" >/dev/null 2>&1; then
    kill "$FIREBASE_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$OUTCOMES_PID" ]] && kill -0 "$OUTCOMES_PID" >/dev/null 2>&1; then
    kill "$OUTCOMES_PID" >/dev/null 2>&1 || true
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

if port_is_open "127.0.0.1" "55432"; then
  echo "local stack: reusing the local AFL outcomes database on 127.0.0.1:55432"
else
  npm run dev:outcomes-db &
  OUTCOMES_PID="$!"
fi

wait_for_port "AFL outcomes database" "127.0.0.1" "55432"

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
npm run outcomes:prisma:generate
npm run outcomes:prisma:migrate:deploy
npm run dev:outcomes:seed

npx concurrently -k -n web,socket,draft-worker -c blue,magenta,green \
  "npm:dev" \
  "npm:socket" \
  "npm:draft-worker:dev"
