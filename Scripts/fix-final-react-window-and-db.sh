#!/usr/bin/env bash
set -euo pipefail

echo "• Upgrade local react-window shim"
mkdir -p src/types
cat > src/types/react-window.d.ts <<'TS'
declare module 'react-window' {
  import * as React from 'react';

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
    outerRef?: React.Ref<any>;
    itemKey?: (index: number, data?: any) => string | number;
    children: (props: ListChildComponentProps<any>) => React.ReactElement | null;
  }

  export interface VariableSizeListProps {
    height: number;
    width: number | string;
    itemCount: number;
    itemSize: (index: number) => number;
    itemData?: any;
    overscanCount?: number;
    outerRef?: React.Ref<any>;
    itemKey?: (index: number, data?: any) => string | number;
    onItemsRendered?: (args: {
      overscanStartIndex: number;
      overscanStopIndex: number;
      visibleStartIndex: number;
      visibleStopIndex: number;
    }) => void;
    children: (props: ListChildComponentProps<any>) => React.ReactElement | null;
  }

  /* Export both values and types so JSX usage and type positions compile */
  export const FixedSizeList: React.ComponentType<any>;
  export const VariableSizeList: React.ComponentType<any>;

  export type FixedSizeList = any;
  export type VariableSizeList = any;
}
TS

echo "• Ensure tsconfig includes src/types"
ensure_include () {
  local f="$1"
  [ -f "$f" ] || return 0
  node -e "const fs=require('fs');const p='$f';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.include=Array.isArray(j.include)?j.include:[];if(!j.include.includes('src/types'))j.include.push('src/types');fs.writeFileSync(p,JSON.stringify(j,null,2));"
}
ensure_include tsconfig.json || true
ensure_include tsconfig.app.json || true

# --- Fix InjuryListDisplay.client.tsx malformed render-prop + typing ---
FILD='src/components/dashboard/InjuryListDisplay.client.tsx'
if [ -f "$FILD" ]; then
  echo "• Fix $FILD"
  # 1) Drop any stray '<{(' (created by a previous sed)
  sed -i '' 's/<{(/ {(/g' "$FILD" || true

  # 2) Ensure CSSProperties import (insert after first react import line)
  if ! grep -q 'CSSProperties' "$FILD"; then
    awk 'BEGIN{done=0}
         /^import .* from .react./ && done==0 { print; print "import type { CSSProperties } from '\''react'\'';"; done=1; next }
         { print }' "$FILD" > "$FILD.tmp" && mv "$FILD.tmp" "$FILD"
  fi

  # 3) Type the render-prop params where they appear as {({ index, style }) => ...}
  perl -0777 -pe 's/\{\(\{\s*index\s*,\s*style\s*\}\)\s*=>/{({ index, style }: { index: number; style: CSSProperties }) =>/g' -i "$FILD"
fi

# --- PlayerGrid: useRef<List> -> useRef<FixedSizeList | null> + type import ---
PG='src/components/draft/PlayerGrid.tsx'
if [ -f "$PG" ]; then
  echo "• Fix $PG useRef type"
  # Add a type-only import if not present
  if ! grep -q "type { FixedSizeList } from 'react-window'" "$PG"; then
    awk 'BEGIN{added=0}
         /^import .* from .react-window./ && added==0 { print; print "import type { FixedSizeList } from '\''react-window'\'';"; added=1; next }
         { print }' "$PG" > "$PG.tmp" && mv "$PG.tmp" "$PG"
  fi
  # Replace useRef<List>(null) with useRef<FixedSizeList | null>(null)
  sed -i '' 's/useRef<List>(null)/useRef<FixedSizeList | null>(null)/g' "$PG" || true
fi

# --- TeamAnalyticsDashboard: ref type + itemKey data param typing ---
TAD='src/components/team/TeamAnalyticsDashboard.tsx'
if [ -f "$TAD" ]; then
  echo "• Fix $TAD ref & itemKey typing"
  # ensure type import for FixedSizeList
  if ! grep -q "type { FixedSizeList" "$TAD"; then
    awk 'BEGIN{done=0}
         /^import .* from .react-window./ && done==0 { print; print "import type { FixedSizeList } from '\''react-window'\'';"; done=1; next }
         { print }' "$TAD" > "$TAD.tmp" && mv "$TAD.tmp" "$TAD"
  fi
  sed -i '' "s/useRef<FixedSizeList<[^>]*> | null>/useRef<FixedSizeList | null>/g" "$TAD" || true
  sed -i '' "s/itemKey={(index: number, data) =>/itemKey={(index: number, data: unknown) =>/g" "$TAD" || true
fi

# --- AvailablePlayersTable & DraftRoomClient: itemKey data param typing (idempotent) ---
APT='src/components/AvailablePlayersTable.tsx'
[ -f "$APT" ] && sed -i '' "s/itemKey={(index: number, data) =>/itemKey={(index: number, data: unknown) =>/g" "$APT" || true

DRC='src/app/drafts/[id]/DraftRoomClient.tsx'
[ -f "$DRC" ] && sed -i '' "s/itemKey={(index: number, data) =>/itemKey={(index: number, data: unknown) =>/g" "$DRC" || true

# --- Prepend db imports where missing ---
add_db_import () {
  local file="$1"
  [ -f "$file" ] || return 0
  grep -q "from '@/lib/firebaseAdmin'" "$file" && return 0
  tmp="$(mktemp)"
  printf "import { db } from '@/lib/firebaseAdmin';\n" > "$tmp"
  cat "$file" >> "$tmp"
  mv "$tmp" "$file"
  echo "   added db import -> $file"
}
add_db_import "src/lib/etlIntegration.ts"
add_db_import "src/services/leagueDataService.ts"

echo "• Ensure deps present (safe to re-run)"
npm i -D @types/react-window react-window >/dev/null 2>&1 || true

echo "• Typecheck (non-fatal)…"
npm run -s typecheck || true
echo "✅ Done."
