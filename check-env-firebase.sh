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

# 4) Server Admin SDK env (validate base64 JSON)
if [ -f "$SERVER_ENV_FILE" ]; then
  if grep -E "^[[:space:]]*FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=" "$SERVER_ENV_FILE" >/dev/null; then
    echo "✅ $SERVER_ENV_FILE contains FIREBASE_SERVICE_ACCOUNT_JSON_BASE64. Validating..."
    B64=$(grep -E "^[[:space:]]*FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=" "$SERVER_ENV_FILE" | head -n1 | cut -d'=' -f2-)
    # Trim possible quotes
    B64=${B64%"}
    B64=${B64#"}
    decoded="$(printf '%s' "$B64" | base64 --decode 2>/dev/null || \
           printf '%s' "$B64" | base64 -D 2>/dev/null || true)"
    if [ -z "$decoded" ]; then
      echo "❌ Failed to base64-decode FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"
      exit 1
    fi
    # Check required fields
    HAS_PROJECT=$(printf "%s" "$decoded" | grep -o '"project_id"' | wc -l | tr -d ' ')
    HAS_EMAIL=$(printf "%s" "$decoded" | grep -o '"client_email"' | wc -l | tr -d ' ')
    HAS_KEY=$(printf "%s" "$decoded" | grep -o '"private_key"' | wc -l | tr -d ' ')
    if [ "$HAS_PROJECT" -gt 0 ] && [ "$HAS_EMAIL" -gt 0 ] && [ "$HAS_KEY" -gt 0 ]; then
      echo "✅ Service account JSON structure looks OK (project_id, client_email, private_key present)."
    else
      echo "❌ Service account JSON missing required keys. Expect project_id, client_email, private_key."
      exit 1
    fi
  else
    echo "⚠️  $SERVER_ENV_FILE missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (Admin SDK)."
    echo "    Set it for local server tasks or rely on ADC (gcloud/GOOGLE_APPLICATION_CREDENTIALS)."
  fi
else
  echo "⚠️  $SERVER_ENV_FILE not found. Skipping server env check."
fi

# 5) Emulator config (public)
USE_EMU=$(grep -E "^[[:space:]]*NEXT_PUBLIC_USE_EMULATORS=" "$ENV_FILE" | head -n1 | cut -d'=' -f2-)
if [ "$USE_EMU" = "true" ]; then
  FS_HOST=$(grep -E "^[[:space:]]*NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=" "$ENV_FILE" | head -n1 | cut -d'=' -f2-)
  AUTH_HOST=$(grep -E "^[[:space:]]*NEXT_PUBLIC_AUTH_EMULATOR_HOST=" "$ENV_FILE" | head -n1 | cut -d'=' -f2-)
  [ -z "$FS_HOST" ] && FS_HOST="localhost:8080"
  [ -z "$AUTH_HOST" ] && AUTH_HOST="http://localhost:9099"
  echo "ℹ️  Emulators enabled. Firestore: $FS_HOST, Auth: $AUTH_HOST"
else
  echo "ℹ️  Emulators disabled (NEXT_PUBLIC_USE_EMULATORS != true)."
fi

exit 0
