#!/usr/bin/env bash
set -euo pipefail

# --- Config ------------------------------------------------------------------
CLIENT_IMPORT='@/lib/firebaseClient'
ADMIN_IMPORT='@/lib/firebaseAdmin'
OLD_ADMIN_PATH='src/lib/firebase.ts'
ADMIN_FILE='src/lib/firebaseAdmin.ts'

# --- 1) Safety: create a branch ----------------------------------------------
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Not a git repo"; exit 1; }
BR="chore/harden-firebase-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BR"

# --- 2) Replace imports: '@/lib/firebase' -> '@/lib/firebaseAdmin' ------------
echo "Replacing imports of '@/lib/firebase' -> '${ADMIN_IMPORT}' ..."
# Only touch TS/TSX files
rg -l "from ['\"]@/lib/firebase['\"]" --glob '!node_modules' --glob '!dist' --glob '!build' --glob '!out' --glob '!coverage' --glob '!**/*.d.ts' || true \
| while read -r f; do
  # macOS sed inline
  sed -i '' "s#from ['\"]@/lib/firebase['\"]#from '${ADMIN_IMPORT}'#g" "$f"
  sed -i '' "s#import ['\"]@/lib/firebase['\"]#import '${ADMIN_IMPORT}'#g" "$f"
  echo "  updated: $f"
done

# --- 3) Delete old admin file if present -------------------------------------
if [[ -f "${OLD_ADMIN_PATH}" ]]; then
  echo "Deleting ${OLD_ADMIN_PATH} ..."
  git rm -f "${OLD_ADMIN_PATH}"
else
  echo "No ${OLD_ADMIN_PATH} found (good)."
fi

# --- 4) Ensure 'server-only' import in firebaseAdmin.ts -----------------------
if [[ ! -f "${ADMIN_FILE}" ]]; then
  echo "ERROR: ${ADMIN_FILE} not found. Aborting."
  exit 1
fi

if ! grep -q '^import "server-only";' "${ADMIN_FILE}"; then
  echo 'Adding `import "server-only";` to firebaseAdmin.ts ...'
  # Insert at file top
  tmpfile="$(mktemp)"
  {
    echo 'import "server-only";'
    cat "${ADMIN_FILE}"
  } > "${tmpfile}"
  mv "${tmpfile}" "${ADMIN_FILE}"
else
  echo "firebaseAdmin.ts already has 'server-only' (ok)."
fi

# --- 5) Add `export const runtime = 'nodejs'` to route handlers using Admin ---
echo "Scanning for route handlers that import '${ADMIN_IMPORT}' ..."
# Find route.ts that import the Admin entrypoint
ROUTES=$(rg -l "from ['\"]${ADMIN_IMPORT}['\"]" --glob 'src/**/route.ts' || true)

add_runtime_decl () {
  local file="$1"
  # Skip if file already declares runtime/export const runtime
  if rg -q "export const runtime\s*=\s*'nodejs'" "$file"; then
    echo "  runtime already set in $file"
    return
  fi

  # Insert `export const runtime = 'nodejs';` after last import block
  # Get the line of the last 'import ' occurrence
  last_import_line=$(rg -n '^\s*import ' "$file" | tail -n1 | cut -d: -f1)
  if [[ -z "$last_import_line" ]]; then
    # No imports; inject at top
    sed -i '' "1s#^#export const runtime = 'nodejs';\n\n#" "$file"
  else
    line=$((last_import_line + 1))
    ed -s "$file" <<ED
${line}i
export const runtime = 'nodejs';

.
w
q
ED
  fi
  echo "  added runtime to $file"
}

for rf in $ROUTES; do
  add_runtime_decl "$rf"
done

# --- 6) Lint/Typecheck smoke (non-fatal) -------------------------------------
echo "Running a quick, non-fatal lint/typecheck (if available) ..."
npm run -s lint || true
npm run -s typecheck || true

echo
echo "✅ Done. Review changes, run the app, and commit:"
echo "   git add -A && git commit -m 'chore(firebase): standardize admin init, add server-only, enforce node runtime'"
echo "   # Current branch: $BR"
