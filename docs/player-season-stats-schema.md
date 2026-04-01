# Player Season Stats Collection Schema

## Collection: `player_season_stats`

Pre-computed season aggregates for fast player stat lookups.

### Document ID Format
```
{playerId}_{season}
```

Examples:
- `anthony-caminiti-st-kilda_2025`
- `josh_daicos_2024`

### Document Structure

```typescript
{
  // Identity
  playerId: string;           // Matches Player.id from Prisma
  playerName: string;         // For debugging/verification
  season: number;             // 2023, 2024, 2025, etc.
  
  // Metadata
  gamesPlayed: number;        // Number of games included in aggregation
  lastUpdated: Timestamp;     // When this doc was last computed
  
  // Per-game averages (what most UIs display)
  stats: {
    goals: number;
    behinds: number;
    kicks: number;
    handballs: number;
    disposals: number;
    marks: number;
    tackles: number;
    hitouts: number;
    clearances: number;
    inside50s: number;
    rebound50s: number;
    contestedPossessions: number;
    uncontestedPossessions: number;
    goalAssists: number;
    scoreInvolvements: number;
    effectiveDisposals: number;
    disposalEffPct: number;
    timeOnGroundPct: number;
    contestedMarks: number;
    intercepts: number;
    metresGained: number;
    turnovers: number;
    freesFor: number;
    freesAgainst: number;
    onePercenters: number;
    clangers: number;
  };
  
  // Season totals (for cumulative views)
  totals: {
    // Same structure as stats, but with totals instead of averages
    goals: number;
    kicks: number;
    // ... all other canonical stats
  };
}
```

### Firestore Indexes Required

```
Collection: player_season_stats
- playerId (ASC), season (DESC)
- season (ASC), playerId (ASC)
```

### Query Patterns

**Get player stats for multiple seasons:**
```typescript
const seasons = [2025, 2024, 2023];
const playerIds = ['player1', 'player2'];

// Build doc IDs for batch get (most efficient)
const docIds = playerIds.flatMap(id => 
  seasons.map(s => `${id}_${s}`)
);

const docs = await db.getAll(
  ...docIds.map(id => db.collection('player_season_stats').doc(id))
);
```

**Get all players for a season (for rankings):**
```typescript
const snapshot = await db
  .collection('player_season_stats')
  .where('season', '==', 2025)
  .get();
```

### ETL Strategy

**Initial Population:**
- Run once to backfill 2023-2025
- ~642 players × 3 seasons = ~1,926 documents
- Estimated time: 30-60 minutes (one-time cost)

**Incremental Updates:**
- Daily cron: update current season only
- After each round: update affected players only
- Manual trigger: re-aggregate specific player or season

### Migration Notes

- Old code paths remain unchanged during rollout
- New collection coexists with `player_match_stats`
- Fallback to on-demand aggregation if pre-computed data missing
- Can validate pre-computed vs on-demand for accuracy
