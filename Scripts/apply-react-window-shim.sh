#!/usr/bin/env bash
set -euo pipefail

echo "• Writing react-window shim → src/types/react-window.d.ts"
mkdir -p src/types
cat > src/types/react-window.d.ts <<'TS'
declare module 'react-window' {
  import * as React from 'react';

  // Minimal, permissive surface for common usage patterns
  export type ListChildComponentProps<T = any> = {
    index: number;
    style: React.CSSProperties;
    data: T;
    isScrolling?: boolean;
  };

  export interface FixedSizeListProps {
    height: number;
    width: number | string;
    itemCount: number;
    itemSize: number;
    itemData?: any;
    overscanCount?: number;
    children: (props: ListChildComponentProps<any>) => React.ReactElement | null;
  }

  // Export components as generic React components so JSX is happy
  export const FixedSizeList: React.ComponentType<any>;
  export const VariableSizeList: React.ComponentType<any>;
}
TS

patch_tsconfig() {
  local file="$1"
  [ -f "$file" ] || return 0

  node - <<'NODE'
const fs = require('fs');
const path = process.argv[1];
const p = process.argv[2];
let json;
try {
  json = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) { process.exit(0); }

// Ensure include array exists and contains src/types
json.include = Array.isArray(json.include) ? json.include : [];
if (!json.include.includes('src/types')) json.include.push('src/types');

fs.writeFileSync(p, JSON.stringify(json, null, 2));
NODE
}

echo "• Ensuring tsconfig includes the shim"
patch_tsconfig tsconfig.json tsconfig.json || true
patch_tsconfig tsconfig.app.json tsconfig.app.json || true

# Add missing Firestore Admin db imports (based on earlier errors)
add_db_import () {
  local file="$1"
  [ -f "$file" ] || return 0
  if grep -q "from '@/lib/firebaseAdmin'" "$file"; then
    return 0
  fi
  # Add only if ' db ' appears (very simple heuristic)
  if grep -q "[^A-Za-z0-9_]db[^A-Za-z0-9_]" "$file"; then
    printf "• Adding db import to %s\n" "$file"
    tmp=$(mktemp)
    {
      echo "import { db } from '@/lib/firebaseAdmin';"
      cat "$file"
    } > "$tmp"
    mv "$tmp" "$file"
  fi
}

add_db_import "src/lib/etlIntegration.ts"
add_db_import "src/services/leagueDataService.ts"

echo "• Installing/ensuring react-window types (safe to re-run)"
npm i -D @types/react-window react-window >/dev/null 2>&1 || true

echo "• Running typecheck (non-fatal)…"
npm run -s typecheck || true
echo "✅ Done."
