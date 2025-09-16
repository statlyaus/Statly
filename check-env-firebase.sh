#!/usr/bin/env bash

ENV_FILE=".env.local"
SERVER_ENV_FILE=".env"

strip_quotes() {
  local val="${1:-}"
  val="${val//$'\r'/}" # drop Windows carriage returns
  case "$val" in
    \"*\")
      val="${val#\"}"
      val="${val%\"}"
      ;;
    \'*\')
      val="${val#\'}"
      val="${val%\'}"
      ;;
  esac
  printf '%s' "$val"
}

read_env_var() {
  local file="$1"
  local var="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  local line
  line=$(grep -E "^[[:space:]]*${var}=" "$file" | tail -n1 || true)
  if [ -z "$line" ]; then
    printf ''
    return 0
  fi
  line="${line#*=}"
  line=$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  printf '%s' "$line"
}

DEFAULT_FIRESTORE="localhost:8080"
DEFAULT_AUTH_HOST="localhost:9099"
if command -v node >/dev/null 2>&1; then
  default_output=$(node -e "const fs=require('fs');let fsHost='localhost:8080';let authHost='localhost:9099';try{const data=JSON.parse(fs.readFileSync('firebase.json','utf8'));const emu=data.emulators||{};const pick=(name,fallbackHost,fallbackPort)=>{const cfg=emu[name]||{};const host=cfg.host||fallbackHost;const port=cfg.port||fallbackPort;return host+':' + port;};fsHost=pick('firestore','localhost',8080);authHost=pick('auth','localhost',9099);}catch(e){};console.log(fsHost);console.log(authHost);" 2>/dev/null)
  if [ -n "$default_output" ]; then
    DEFAULT_FIRESTORE=$(printf '%s\n' "$default_output" | head -n1 | tr -d '\r')
    DEFAULT_AUTH_HOST=$(printf '%s\n' "$default_output" | sed -n '2p' | tr -d '\r')
    [ -z "$DEFAULT_FIRESTORE" ] && DEFAULT_FIRESTORE="localhost:8080"
    [ -z "$DEFAULT_AUTH_HOST" ] && DEFAULT_AUTH_HOST="localhost:9099"
  fi
fi
DEFAULT_AUTH_CLIENT="http://${DEFAULT_AUTH_HOST}"
DEFAULT_FIRESTORE_PORT="${DEFAULT_FIRESTORE##*:}"
DEFAULT_AUTH_PORT="${DEFAULT_AUTH_HOST##*:}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found!"
  exit 1
else
  echo "OK: $ENV_FILE found."
fi

REQUIRED=(
  "NEXT_PUBLIC_FIREBASE_API_KEY"
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  "NEXT_PUBLIC_FIREBASE_APP_ID"
)
MISSING=()
PUBLIC_PROJECT_ID=""
for VAR in "${REQUIRED[@]}"; do
  value=$(strip_quotes "$(read_env_var "$ENV_FILE" "$VAR")")
  if [ -z "$value" ]; then
    MISSING+=("$VAR")
  else
    if [ "$VAR" = "NEXT_PUBLIC_FIREBASE_PROJECT_ID" ]; then
      PUBLIC_PROJECT_ID="$value"
    fi
  fi
 done

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "OK: All required NEXT_PUBLIC_FIREBASE_* vars are present in $ENV_FILE."
else
  echo "ERROR: Missing the following in $ENV_FILE:"
  for v in "${MISSING[@]}"; do
    echo "   - $v"
  done
  exit 1
fi

OPTIONAL=(
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID"
)
MISSING_OPT=()
for VAR in "${OPTIONAL[@]}"; do
  value=$(strip_quotes "$(read_env_var "$ENV_FILE" "$VAR")")
  if [ -z "$value" ]; then
    MISSING_OPT+=("$VAR")
  fi
 done

if [ ${#MISSING_OPT[@]} -gt 0 ]; then
  echo "WARNING: Optional client envs missing in $ENV_FILE (features may be limited):"
  for v in "${MISSING_OPT[@]}"; do
    echo "   - $v"
  done
fi

if [ -f "$SERVER_ENV_FILE" ]; then
  B64_RAW=$(read_env_var "$SERVER_ENV_FILE" "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64")
  B64=$(strip_quotes "$B64_RAW")
  if [ -n "$B64" ]; then
    echo "OK: $SERVER_ENV_FILE contains FIREBASE_SERVICE_ACCOUNT_JSON_BASE64. Validating..."
    decoded=$(printf '%s' "$B64" | base64 --decode 2>/dev/null || \
      printf '%s' "$B64" | base64 -D 2>/dev/null || true)
    if [ -z "$decoded" ]; then
      echo "ERROR: Failed to base64-decode FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"
      exit 1
    fi
    HAS_PROJECT=$(printf '%s' "$decoded" | grep -o '"project_id"' | wc -l | tr -d ' ')
    HAS_EMAIL=$(printf '%s' "$decoded" | grep -o '"client_email"' | wc -l | tr -d ' ')
    HAS_KEY=$(printf '%s' "$decoded" | grep -o '"private_key"' | wc -l | tr -d ' ')
    if [ "$HAS_PROJECT" -gt 0 ] && [ "$HAS_EMAIL" -gt 0 ] && [ "$HAS_KEY" -gt 0 ]; then
      echo "OK: Service account JSON structure looks OK (project_id, client_email, private_key present)."
      if command -v node >/dev/null 2>&1; then
        SA_PROJECT=$(printf '%s' "$decoded" | node -e "const fs=require('fs');const data=fs.readFileSync(0,'utf8');let out='';try{const parsed=JSON.parse(data);out=parsed.project_id||parsed.projectId||'';}catch(e){};process.stdout.write(out);")
        if [ -n "$SA_PROJECT" ] && [ -n "$PUBLIC_PROJECT_ID" ] && [ "$SA_PROJECT" != "$PUBLIC_PROJECT_ID" ]; then
          echo "WARNING: Service account project_id ($SA_PROJECT) differs from NEXT_PUBLIC_FIREBASE_PROJECT_ID ($PUBLIC_PROJECT_ID)."
        fi
      fi
    else
      echo "ERROR: Service account JSON missing required keys. Expect project_id, client_email, private_key."
      exit 1
    fi
  else
    echo "WARNING: $SERVER_ENV_FILE missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (Admin SDK)."
    echo "    Set it for local server tasks or rely on ADC (gcloud/GOOGLE_APPLICATION_CREDENTIALS)."
  fi
else
  echo "WARNING: $SERVER_ENV_FILE not found. Skipping server env check."
fi

if [ ! -f secrets/serviceAccountKey.json ]; then
  echo "WARNING: secrets/serviceAccountKey.json not found. Create it from your Firebase service account for local tooling."
fi

USE_EMU=$(strip_quotes "$(read_env_var "$ENV_FILE" "NEXT_PUBLIC_USE_EMULATORS")")
if [ "$USE_EMU" = "true" ]; then
  FS_HOST_RAW=$(strip_quotes "$(read_env_var "$ENV_FILE" "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST")")
  AUTH_HOST_RAW=$(strip_quotes "$(read_env_var "$ENV_FILE" "NEXT_PUBLIC_AUTH_EMULATOR_HOST")")
  FS_HOST="$FS_HOST_RAW"
  AUTH_HOST="$AUTH_HOST_RAW"
  [ -z "$FS_HOST" ] && FS_HOST="$DEFAULT_FIRESTORE"
  if [ -z "$FS_HOST_RAW" ]; then
    echo "WARNING: NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST missing in $ENV_FILE; using firebase.json default $FS_HOST."
  else
    if [[ $FS_HOST_RAW == *:* ]]; then
      FS_CLIENT_PORT="${FS_HOST_RAW##*:}"
      if [ -n "$FS_CLIENT_PORT" ] && [ "$FS_CLIENT_PORT" != "$DEFAULT_FIRESTORE_PORT" ]; then
        echo "WARNING: NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST port ($FS_CLIENT_PORT) differs from firebase.json port ($DEFAULT_FIRESTORE_PORT)."
      fi
    fi
  fi
  if [ -z "$AUTH_HOST" ]; then
    AUTH_HOST="$DEFAULT_AUTH_CLIENT"
  fi
  if [ -z "$AUTH_HOST_RAW" ]; then
    echo "WARNING: NEXT_PUBLIC_AUTH_EMULATOR_HOST missing in $ENV_FILE; using firebase.json default $AUTH_HOST."
  else
    AUTH_CHECK="$AUTH_HOST_RAW"
    AUTH_CHECK="${AUTH_CHECK#http://}"
    AUTH_CHECK="${AUTH_CHECK#https://}"
    if [[ $AUTH_CHECK == *:* ]]; then
      AUTH_CLIENT_PORT="${AUTH_CHECK##*:}"
      if [ -n "$AUTH_CLIENT_PORT" ] && [ "$AUTH_CLIENT_PORT" != "$DEFAULT_AUTH_PORT" ]; then
        echo "WARNING: NEXT_PUBLIC_AUTH_EMULATOR_HOST port ($AUTH_CLIENT_PORT) differs from firebase.json port ($DEFAULT_AUTH_PORT)."
      fi
    fi
  fi
  AUTH_SERVER_FALLBACK="$AUTH_HOST"
  if [[ $AUTH_SERVER_FALLBACK == http://* ]]; then
    AUTH_SERVER_FALLBACK="${AUTH_SERVER_FALLBACK#http://}"
  elif [[ $AUTH_SERVER_FALLBACK == https://* ]]; then
    AUTH_SERVER_FALLBACK="${AUTH_SERVER_FALLBACK#https://}"
  fi
  echo "INFO: Emulators enabled. Firestore: $FS_HOST, Auth: $AUTH_HOST"
  SERVER_FS=$(strip_quotes "$(read_env_var "$SERVER_ENV_FILE" "FIRESTORE_EMULATOR_HOST")")
  SERVER_AUTH=$(strip_quotes "$(read_env_var "$SERVER_ENV_FILE" "FIREBASE_AUTH_EMULATOR_HOST")")
  if [ -z "$SERVER_FS" ]; then
    echo "WARNING: FIRESTORE_EMULATOR_HOST missing in $SERVER_ENV_FILE; server will fall back to client host ($FS_HOST)."
  else
    SERVER_FS_PORT="${SERVER_FS##*:}"
    if [ -n "$SERVER_FS_PORT" ] && [ "$SERVER_FS_PORT" != "$DEFAULT_FIRESTORE_PORT" ]; then
      echo "WARNING: FIRESTORE_EMULATOR_HOST port ($SERVER_FS_PORT) differs from firebase.json port ($DEFAULT_FIRESTORE_PORT)."
    fi
  fi
  if [ -z "$SERVER_AUTH" ]; then
    echo "WARNING: FIREBASE_AUTH_EMULATOR_HOST missing in $SERVER_ENV_FILE; server will fall back to $AUTH_SERVER_FALLBACK."
  else
    SERVER_AUTH_PORT="${SERVER_AUTH##*:}"
    if [ -n "$SERVER_AUTH_PORT" ] && [ "$SERVER_AUTH_PORT" != "$DEFAULT_AUTH_PORT" ]; then
      echo "WARNING: FIREBASE_AUTH_EMULATOR_HOST port ($SERVER_AUTH_PORT) differs from firebase.json port ($DEFAULT_AUTH_PORT)."
    fi
  fi
else
  echo "INFO: Emulators disabled (NEXT_PUBLIC_USE_EMULATORS != true)."
fi

exit 0
