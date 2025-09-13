#!/usr/bin/env bash
set -euo pipefail

# 1) Upgrade local react-window type shim to cover your usage
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

  /* Export both values and types so TS allows using them in JSX and as type params */
  export const FixedSizeList: React.ComponentType<any>;
  export const VariableSizeList: React.ComponentType<any>;

  export type FixedSizeList = any;
  export type VariableSizeList = any;
}
TS

# 2) Ensure TS sees src/types
ensure_include () {
  local file="$1"
  [ -f "$file" ] || return 0
  node -e "const fs=require('fs');const p='$file';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.include=Array.isArray(j.include)?j.include:[];if(!j.include.includes('src/types'))j.include.push('src/types');fs.writeFileSync(p,JSON.stringify(j,null,2));"
}
ensure_include tsconfig.json || true
ensure_include tsconfig.app.json || true

# 3) Patch InjuryListDisplay render-prop implicit anys
FILE_ILD="src/components/dashboard/InjuryListDisplay.client.tsx"
if [ -f "$FILE_ILD" ]; then
  # import CSSProperties if not present
  grep -q "CSSProperties" "$FILE_ILD" || sed -i '' "1,/^$/ s#^import \\{ \\(.*\\) \\} from 'react';#import { \\1, CSSProperties } from 'react';#;" "$FILE_ILD" || true
  # type the inline destructure
  sed -i '' "s/{({ index, style }) =>/<{({ index, style }: { index: number; style: CSSProperties }) =>/g" "$FILE_ILD" || true
  sed -i '' "s/{({ index, style }) => /{({ index, style }: { index: number; style: CSSProperties }) => /g" "$FILE_ILD" || true
  # remove duplicate '<' if previous sed added one
  sed -i '' "s/<<{/</g" "$FILE_ILD" || true
fi

# 4) Fix useRef<List> and ensure type import for FixedSizeList
FILE_PG="src/components/draft/PlayerGrid.tsx"
if [ -f "$FILE_PG" ]; then
  # add type import if missing
  grep -q "type { FixedSizeList } from 'react-window'" "$FILE_PG" || \
  sed -i '' "1,/^$/ s#import \\(\\{[^}]*\\}\\|[^']*\\) from 'react-window';#import \\1 from 'react-window';\\nimport type { FixedSizeList } from 'react-window';#" "$FILE_PG" || true
  # replace useRef<List>(null) with useRef<FixedSizeList | null>(null)
  sed -i '' "s/useRef<List>(null)/useRef<FixedSizeList | null>(null)/g" "$FILE_PG" || true
fi

# 5) Fix TeamAnalyticsDashboard ref type and itemKey data param typing
FILE_TEAM="src/components/team/TeamAnalyticsDashboard.tsx"
if [ -f "$FILE_TEAM" ]; then
  # ensure type import present for FixedSizeList
  grep -q "type { FixedSizeList" "$FILE_TEAM" || sed -i '' "1,/^$/ s#import \\(type \\)\\?\\{\\([^}]*\\)\\} from 'react-window';#import type { \\2, FixedSizeList } from 'react-window';#" "$FILE_TEAM" || true
  # replace useRef<FixedSizeList<...> | null> with useRef<FixedSizeList | null>
  sed -i '' "s/useRef<FixedSizeList<[^>]*> | null>/useRef<FixedSizeList | null>/g" "$FILE_TEAM" || true
  # type the itemKey data param
  sed -i '' "s/itemKey={(index: number, data) =>/itemKey={(index: number, data: unknown) =>/g" "$FILE_TEAM" || true
fi

# 6) Type itemKey in AvailablePlayersTable and DraftRoomClient
FILE_APT="src/components/AvailablePlayersTable.tsx"
[ -f "$FILE_APT" ] && sed -i '' "s/itemKey={(index: number) =>/itemKey={(index: number) =>/g" "$FILE_APT" || true
[ -f "$FILE_APT" ] && sed -i '' "s/itemKey={(index: number, data) =>/itemKey={(index: number, data: unknown) =>/g" "$FILE_APT" || true

FILE_DRC="src/app/drafts/[id]/DraftRoomClient.tsx"
[ -f "$FILE_DRC" ] && sed -i '' "s/itemKey={(index: number) =>/itemKey={(index: number) =>/g" "$FILE_DRC" || true
[ -f "$FILE_DRC" ] && sed -i '' "s/itemKey={(index: number, data) =>/itemKey={(index: number, data: unknown) =>/g" "$FILE_DRC" || true

# 7) Add missing db imports explicitly (prepend)
add_db_import () {
  local file="$1"
  [ -f "$file" ] || return 0
  grep -q "from '@/lib/firebaseAdmin'" "$file" && return 0
  # Prepend safe import
  tmp=$(mktemp)
  printf "import { db } from '@/lib/firebaseAdmin';\n" > "$tmp"
  cat "$file" >> "$tmp"
  mv "$tmp" "$file"
  echo "added db import -> $file"
}
add_db_import "src/lib/etlIntegration.ts"
add_db_import "src/services/leagueDataService.ts"

# 8) Ensure deps present (safe re-run)
npm i -D @types/react-window react-window >/dev/null 2>&1 || true

# 9) Typecheck (non-fatal)
npm run -s typecheck || true
echo "Done."
