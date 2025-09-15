#!/usr/bin/env bash

ENV_FILE=".env.local"
SERVER_ENV_FILE=".env"

# 1) Check if .env.local file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found!"
  exit 1
else
  echo "✅ $ENV_FILE found."
fi

# 2) Check for required env vars inside the file
REQUIRED=(
  "NEXT_PUBLIC_FIREBASE_API_KEY"
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  "NEXT_PUBLIC_FIREBASE_APP_ID"
)

MISSING=()
for VAR in "${REQUIRED[@]}"; do
  # grep for the var name, ignoring commented lines
  if ! grep -E "^[[:space:]]*${VAR}=" "$ENV_FILE" >/dev/null; then
    MISSING+=("$VAR")
  fi
done

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "✅ All required NEXT_PUBLIC_FIREBASE_* vars are present in $ENV_FILE."
else
  echo "❌ Missing the following in $ENV_FILE:"
  for v in "${MISSING[@]}"; do
    echo "   • $v"
  done
  exit 1
fi

# 3) Optional client vars (warn only)
OPTIONAL=(
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
)

MISSING_OPT=()
for VAR in "${OPTIONAL[@]}"; do
  if ! grep -E "^[[:space:]]*${VAR}=" "$ENV_FILE" >/dev/null; then
    MISSING_OPT+=("$VAR")
  fi
done

if [ ${#MISSING_OPT[@]} -gt 0 ]; then
  echo "⚠️  Optional client envs missing in $ENV_FILE (features may be limited):"
  for v in "${MISSING_OPT[@]}"; do
    echo "   • $v"
  done
fi

# 4) Server Admin SDK env (warn only)
if [ -f "$SERVER_ENV_FILE" ]; then
  if ! grep -E "^[[:space:]]*FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=" "$SERVER_ENV_FILE" >/dev/null; then
    echo "⚠️  $SERVER_ENV_FILE missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (Admin SDK)."
    echo "    Set it for local server tasks or rely on ADC (gcloud/GOOGLE_APPLICATION_CREDENTIALS)."
  else
    echo "✅ $SERVER_ENV_FILE contains FIREBASE_SERVICE_ACCOUNT_JSON_BASE64."
  fi
else
  echo "⚠️  $SERVER_ENV_FILE not found. Skipping server env check."
fi

exit 0
