#!/usr/bin/env bash
set -Eeuo pipefail

# Statly full dev environment starter
# - Ensures Node version (via nvm if available)
# - Installs dependencies when missing
# - Ensures .env.local exists
# - Validates environment
# - Starts Firebase emulators (Firestore + Auth), Next.js dev server, and Socket.IO sidecar
#
# Usage:
#   bash Scripts/start-dev.sh
#
# Notes:
# - If the Firebase CLI is not installed globally, this script will use `npx firebase-tools`.
# - It uses your existing npm scripts and local dev dependencies (concurrently, tsx, etc.).

# Resolve repo root (directory containing this script is Scripts/)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"
cd "$REPO_ROOT"

info() { echo "[statly:dev] $*"; }
warn() { echo "[statly:warn] $*" >&2; }
error() { echo "[statly:error] $*" >&2; }

# 1) Use nvm if available and .nvmrc exists
if [[ -f .nvmrc ]]; then
  if command -v nvm >/dev/null 2>&1; then
    info "Activating Node version from .nvmrc via nvm"
    nvm use || warn "nvm use failed; continuing with current Node version"
  else
    # Try to source nvm if it's installed but not in PATH
    if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
      # shellcheck disable=SC1090
      . "${NVM_DIR}/nvm.sh"
      nvm use || warn "nvm use failed after sourcing; continuing with current Node version"
    else
      warn "nvm not found. Consider installing nvm or ensuring you're on the Node version in .nvmrc"
    fi
  fi
fi

# 2) Install dependencies if node_modules missing
if [[ ! -d node_modules ]]; then
  info "Installing dependencies (node_modules not found)"
  if [[ -f package-lock.json ]]; then
    npm ci || { error "npm ci failed"; exit 1; }
  else
    npm install || { error "npm install failed"; exit 1; }
  fi
fi

# 3) Ensure local env file exists
if [[ ! -f .env.local && -f .env.example ]]; then
  info "Creating .env.local from .env.example"
  cp .env.example .env.local
fi

# 4) Validate environment (Firebase + general env checks)
info "Validating environment"
if ! npm run env:check; then
  error "Environment validation failed. Fix the messages above and re-run."
  exit 1
fi

# 5) Determine Firebase emulator command
EMU_CMD=("firebase" "emulators:start" "--only" "firestore,auth" "--import" "./.firebase-data" "--export-on-exit")
if ! command -v firebase >/dev/null 2>&1; then
  warn "Firebase CLI not found globally. Falling back to 'npx firebase-tools'"
  EMU_CMD=("npx" "firebase-tools" "emulators:start" "--only" "firestore,auth" "--import" "./.firebase-data" "--export-on-exit")
fi

# 6) Print a concise summary
info "Environment is ready. Starting services:"
info "- Firebase Emulators: Firestore + Auth"
info "- Next.js (Turbopack)"
info "- Socket.IO sidecar"

info "URLs:"
info "- Next.js:              http://localhost:3000"
info "- Firebase Emulator UI: http://127.0.0.1:4000"
info "- Socket.IO:            ws://localhost:${SOCKETIO_PORT:-4001}/socket.io"

# 7) Start everything with concurrently; keep process attached
#    We call concurrently via npx so it resolves local devDependency.
#    The Next.js and Socket server use existing npm scripts; emulators via EMU_CMD constructed above.

# shellcheck disable=SC2068
npx concurrently -k -n emu,next,socket \
  "${EMU_CMD[@]}" \
  "npm run dev" \
  "npm run socket"
