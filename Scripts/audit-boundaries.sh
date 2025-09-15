#!/usr/bin/env bash
# audits server/client boundaries, searchParams typing, and serialization hazards in a Next.js app
# Usage: bash scripts/audit-boundaries.sh
# Requires: ripgrep (rg) for best results; falls back to grep where possible.

set -euo pipefail

ROOT="${ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

echo "🔎 Statly Audit — server/client boundaries & params typing"
echo "repo: $ROOT"
echo

have_rg=1
command -v rg >/dev/null 2>&1 || have_rg=0

note() { echo "  • $*"; }
section() { echo; echo "================================================================"; echo "🧭 $*"; echo "================================================================"; }

# Helpers
rg_or_grep() {
  if [ "$have_rg" -eq 1 ]; then
    rg --no-heading -n "$@"
  else
    # Basic grep fallback (not as fast/accurate)
    local PATTERN="$1"; shift
    grep -RIn "$PATTERN" "$@"
  fi
}

# 1) Client files importing server-only modules
section "Client components importing server-only modules"
CLIENT_FILES=$(
  if [ "$have_rg" -eq 1 ]; then
    # Files explicitly marked as client entry points
    rg -l --glob 'src/**/*.{ts,tsx}' --pcre2 -- '^"use client"|^\x27use client\x27'
  else
    grep -RIl '^"use client"' src || true
  fi
)

if [ -z "${CLIENT_FILES}" ]; then
  echo "✅ No explicit client entry files found (or none detected)."
else
  echo "$CLIENT_FILES" | while read -r f; do
    BAD=$(rg_or_grep 'from\s+.\s*@/lib/firebaseAdmin|from\s+.\s*next/headers' "$f" || true)
    if [ -n "$BAD" ]; then
      echo "❌ $f"
      echo "$BAD" | sed 's/^/     • /'
      note "Fix: move server-only usage to a parent server page, and pass serializable props down."
    fi
  done
fi

# 2) Server pages using browser APIs or client hooks
section "Server pages using client-only APIs (window/document/hooks)"
TARGET_GLOB='src/app/**/page.tsx'
PATTERN_CLIENT_APIS='\b(window|document|navigator|localStorage|sessionStorage|WebSocket|Notification|matchMedia)\b'
PATTERN_CLIENT_HOOKS='\buse(State|Effect|LayoutEffect|Reducer|Ref|ImperativeHandle|Transition|DeferredValue|InsertionEffect|SyncExternalStore)\b'

if [ "$have_rg" -eq 1 ]; then
  SERVER_PAGES=$(rg -l -g "$TARGET_GLOB" -P '^(?:(?!"use client").)*$' || true)
else
  # very rough fallback: list pages and filter out those starting with "use client"
  SERVER_PAGES=$(find src/app -type f -path '*/page.tsx' -print0 \
    | xargs -0 awk 'FNR==1{if($0 ~ /use client/) skip=1; else skip=0} {if(FNR==1 && skip==0) print FILENAME}' | sort -u)
fi

ISSUES_FOUND=0
echo "$SERVER_PAGES" | while read -r f; do
  [ -z "$f" ] && continue
  BAD1=$(rg_or_grep "$PATTERN_CLIENT_APIS" "$f" || true)
  BAD2=$(rg_or_grep "$PATTERN_CLIENT_HOOKS" "$f" || true)
  if [ -n "$BAD1$BAD2" ]; then
    ISSUES_FOUND=1
    echo "❌ $f"
    [ -n "$BAD1" ] && echo "$BAD1" | sed 's/^/     • browser API: /'
    [ -n "$BAD2" ] && echo "$BAD2" | sed 's/^/     • hook usage:  /'
    note "Fix: split — keep data fetching & auth in this server page; create a child client component with 'use client' for interactivity."
  fi
done
[ "$ISSUES_FOUND" -eq 0 ] && echo "✅ No client-only usage detected in server pages."

# 3) Server pages with server-only imports (OK) + cookies/headers check (OK), but wrongly marked client
section "Client pages that import server-only modules (double-check)"
if [ -n "${CLIENT_FILES}" ]; then
  echo "$CLIENT_FILES" | while read -r f; do
    BAD=$(rg_or_grep '\bcookies\(|\bheaders\(' "$f" || true)
    if [ -n "$BAD" ]; then
      echo "❌ $f"
      echo "$BAD" | sed 's/^/     • server API in client file: /'
      note "Fix: move cookies()/headers() to a server parent or API route."
    fi
  done
fi

# 4) Next.js 15 params/searchParams typing — must be Promises in server pages
section "Next.js 15: searchParams/params typing in server pages"
# Look for default exports in page.tsx that accept props with searchParams/params not wrapped in Promise
if [ "$have_rg" -eq 1 ]; then
  CANDIDATES=$(rg -n -g "$TARGET_GLOB" -P 'export\s+default\s+async?\s*function\s+\w*\s*\(\s*\{[^}]*\}\s*:\s*\{[^}]*\}\s*\)' || true)
else
  CANDIDATES=$(grep -RIn 'export default async function' src/app/**/page.tsx || true)
fi

warned=0
echo "$CANDIDATES" | while read -r line; do
  file="${line%%:*}"
  # Skip client files
  if head -n1 "$file" | grep -q '^"use client"'; then
    continue
  fi
  # Check for searchParams/params with Promise types missing
  if rg_or_grep -q 'searchParams\s*:\s*(?!Promise<)' "$file"; then
    echo "❌ $file — 'searchParams' should be typed as Promise<...> in server pages"
    note "Ref: Next 15 made searchParams a Promise in server pages. Use \`{ searchParams }: { searchParams?: Promise<Record<string, string | string[]>> }\` and await/use() it." 
    warned=1
  fi
  if rg_or_grep -q 'params\s*:\s*(?!Promise<)' "$file"; then
    echo "❌ $file — 'params' should be typed as Promise<...> in server pages"
    warned=1
  fi
done
[ "$warned" -eq 0 ] && echo "✅ No obvious typing issues for params/searchParams."

# 5) Heuristic: non-serializable values in props from server → client
section "Heuristic: non-serializable props passed to client components"
# (Dates, Maps, Sets, Functions cannot be passed directly; Dates must be stringified)
# We’ll look for common pitfalls in server files that render known client children.
if [ "$have_rg" -eq 1 ]; then
  CLIENT_ENTRIES=$(rg -l --glob 'src/**/*.{ts,tsx}' --pcre2 -- '^"use client"|^\x27use client\x27')
else
  CLIENT_ENTRIES=$(grep -RIl '^"use client"' src || true)
fi

if [ -n "$CLIENT_ENTRIES" ]; then
  # Build a small list of client component basenames to look for usage
  TMP_CLIENTS=$(mktemp)
  echo "$CLIENT_ENTRIES" | sed -E 's#.*/(src/.*)#\1#' | xargs -I{} basename {} | sed 's/\.[tj]sx\?$//' | sort -u > "$TMP_CLIENTS"

  # Scan server files for passing Date/Map/Set directly (heuristic)
  SERVER_TS=$(rg -l -g 'src/**/*.{ts,tsx}' -P '^(?:(?!"use client").)*$' || true)
  HIT=0
  for s in $SERVER_TS; do
    # Dates in JSX props like someProp={new Date( ... )}
    if rg_or_grep -q '=\s*\{\s*new\s+Date\(' "$s"; then
      echo "⚠️  $s — possible Date passed as prop; prefer toString()/toISOString() before passing."
      HIT=1
    fi
    # Map/Set constructions near JSX (very rough)
    if rg_or_grep -q '=\s*\{\s*new\s+(Map|Set)\(' "$s"; then
      echo "⚠️  $s — possible Map/Set passed as prop; serialize/normalize first."
      HIT=1
    fi
  done
  [ "$HIT" -eq 0 ] && echo "✅ No obvious non-serializable props found (heuristic)."
else
  echo "ℹ️  No client entry files detected; skipping."
fi

echo
echo "✅ Audit complete."
echo "Next steps:"
echo "  1) For each ❌ above, apply the split pattern (server page fetch/auth → pass serializable props → client child for interactivity)."
echo "  2) Ensure 'searchParams'/'params' are Promise-typed in server pages and awaited or read via use()."
echo "  3) If you see Date/Map/Set/functions in props, convert to primitives (e.g., ISO strings) before passing."
echo
echo "Refs:"
echo "  • 'use client' boundary & usage: https://nextjs.org/docs/app/api-reference/directives/use-client"
echo "  • searchParams are Promises in Next 15: https://nextjs.org/docs/messages/next-prerender-sync-params"
echo "  • Serialization rules server → client: https://github.com/vercel/next.js/issues/54291"
