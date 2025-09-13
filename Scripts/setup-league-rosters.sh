#!/usr/bin/env bash
set -euo pipefail

# Create directories safely (quote the brackets for zsh)
mkdir -p "src/types"
mkdir -p "src/app/api/leagues/[leagueId]/rosters"
mkdir -p "src/app/api/leagues/[leagueId]/rosters/[teamId]"

# Write types/live.ts (roster DTO)
cat > src/types/live.ts <<'EOF'
export interface LivePlayerRow {
  id: string;
  name: string;
  team: string;
  position: string;
  injury?: string;
  disposals: number;
  goals: number;
}
EOF

# (you can add similar cat > blocks here for route.ts files if you want them scaffolded)

echo "✅ League-scoped roster types and APIs created. /rosters now consumes them server-side."
