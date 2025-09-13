#!/usr/bin/env bash
set -euo pipefail

# 1) config.ts — Zod .errors -> .issues, 'as env' -> 'as typeof env', type the map param
CFG="src/lib/config.ts"
if [ -f "$CFG" ]; then
  # Only touch if patterns exist
  grep -q "\.error\.errors" "$CFG" && sed -i '' "s/\.error\.errors/\.error\.issues/g" "$CFG" || true
  grep -q " as env \& " "$CFG" && sed -i '' "s/ as env \& / as typeof env \& /g" "$CFG" || true
  # Be tolerant to spacing variants
  grep -q " as env&" "$CFG" && sed -i '' "s/ as env\&/ as typeof env\&/g" "$CFG" || true
  grep -q "\.map((e) =>" "$CFG" && sed -i '' "s/\.map((e) =>/\.map((e: any) =>/g" "$CFG" || true
  grep -q "\.map((e)=>" "$CFG" && sed -i '' "s/\.map((e)=>/\.map((e: any)=>/g" "$CFG" || true
fi

# 2) Add missing `db` import from firebaseAdmin in files that reference db without import
add_db_import () {
  local file="$1"
  [ -f "$file" ] || return 0

  # If already has import, skip
  if grep -q "from '@/lib/firebaseAdmin'" "$file"; then
    return 0
  fi

  # If references 'db' symbol (heuristic), insert import at top
  if grep -q "[^a-zA-Z_]db[^a-zA-Z_]" "$file"; then
    ed -s "$file" <<'ED'
0i
import { db } from '@/lib/firebaseAdmin';

.
w
q
ED
    echo "Added db import to $file"
  fi
}

add_db_import "src/lib/etlIntegration.ts"
add_db_import "src/services/leagueDataService.ts"

# 3) Ensure react-window deps are present (safe to re-run)
npm i -D @types/react-window react-window >/dev/null 2>&1 || true

echo "✅ Patches applied. Now running a non-fatal typecheck..."
npm run -s typecheck || true
