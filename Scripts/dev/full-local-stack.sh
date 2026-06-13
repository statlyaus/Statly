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
export NEXT_PUBLIC_FIREBASE_API_KEY="${NEXT_PUBLIC_FIREBASE_API_KEY:-local-emulator-key}"
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:-$STATLY_LOCAL_PROJECT_ID.firebaseapp.com}"
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-$STATLY_LOCAL_PROJECT_ID.appspot.com}"
export NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:-000000000000}"
export NEXT_PUBLIC_FIREBASE_APP_ID="${NEXT_PUBLIC_FIREBASE_APP_ID:-1:000000000000:web:local}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3000}"
export APP_BASE_URL="${APP_BASE_URL:-http://localhost:3000}"

FIREBASE_PID=""

cleanup() {
  if [[ -n "$FIREBASE_PID" ]] && kill -0 "$FIREBASE_PID" >/dev/null 2>&1; then
    kill "$FIREBASE_PID" >/dev/null 2>&1 || true
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

npm run dev:down >/dev/null 2>&1 || true

npx firebase emulators:start --only auth,firestore --project "$STATLY_LOCAL_PROJECT_ID" &
FIREBASE_PID="$!"

wait_for_port "Firestore emulator" "127.0.0.1" "8080"
wait_for_port "Firebase Auth emulator" "127.0.0.1" "9099"

npm run dev:seed:local

npx concurrently -k -n web,socket,worker -c blue,magenta,green \
  "npm:dev" \
  "npm:socket" \
  "npm:worker:dev"
