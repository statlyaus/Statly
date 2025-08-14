# ETL System Integration Guide

## Overview
The ETL (Extract, Transform, Load) system provides real-time AFL player statistics and match data for the Statly fantasy platform. This guide explains how to integrate live data into your existing components.

## System Architecture

```
Python Scraper → TypeScript Ingestor → Firebase Firestore → Next.js API → React Components
```

### Components:
- **Python Scraper** (`etl/fetch_fw_round.py`): Fetches data from Footywire
- **TypeScript Ingestor** (`etl/ingestFootywire.ts`): Processes and stores data
- **Firebase Integration** (`etl/liveGuard.ts`): Database helpers
- **React Hooks** (`src/hooks/useLiveData.ts`): Component integration layer
- **API Routes** (`src/app/api/live-data/route.ts`): REST endpoints

## Quick Start

### 1. Deploy the ETL Pipeline

```bash
# Build and deploy to Google Cloud Run
cd etl
chmod +x deploy.sh
./deploy.sh
```

### 2. Use Live Data in Components

```typescript
import { useLiveData } from '@/hooks/useLiveData';

function MyComponent() {
  const { playerStats, isLive, isLoading, error } = useLiveData();
  
  if (isLoading) return <div>Loading live data...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div>
      {isLive && <span className="text-green-600">🔴 Live</span>}
      {playerStats.map(player => (
        <div key={player.id}>
          {player.name}: {player.fantasyScore} points
        </div>
      ))}
    </div>
  );
}
```

### 3. Access API Endpoints

```bash
# Get live data
curl "https://your-domain.com/api/live-data?format=legacy&limit=50"

# Get player data
curl "https://your-domain.com/api/etl?type=player&playerUid=ply_clayton_oliver"

# Get match data
curl "https://your-domain.com/api/etl?type=match&matchUid=match_2025_1_melbourne_richmond"
```

## Integration Patterns

### Pattern 1: Replace Mock Data

**Before:**
```typescript
const mockPlayers = [
  { id: '1', name: 'Player 1', fantasyScore: 85 },
  // ... mock data
];
```

**After:**
```typescript
const { playerStats, isLoading } = useLiveData();
const players = playerStats; // Real live data
```

### Pattern 2: Live Status Indicator

```typescript
function LiveIndicator() {
  const { isLive, minutesSinceUpdate } = useLiveData({ enablePolling: true });
  
  return (
    <div className={`flex items-center ${isLive ? 'text-green-600' : 'text-gray-500'}`}>
      <div className={`w-2 h-2 rounded-full mr-2 ${isLive ? 'bg-green-500' : 'bg-gray-400'}`} />
      {isLive ? `Live (${minutesSinceUpdate}m ago)` : 'No live matches'}
    </div>
  );
}
```

### Pattern 3: Player-Specific Components

```typescript
function PlayerCard({ playerUid }: { playerUid: string }) {
  const { profile, recentStats, isLoading } = usePlayerData(playerUid, 5);
  
  if (isLoading) return <PlayerCardSkeleton />;
  
  return (
    <div className="border rounded-lg p-4">
      <h3>{profile?.full_name}</h3>
      <p>{profile?.current_team}</p>
      <div>Last 5 games average: {calculateAverage(recentStats)}</div>
    </div>
  );
}
```

## Data Structures

### ETL Player Stats
```typescript
interface ETLPlayerStats {
  match_uid: string;
  player_uid: string;
  team: string;
  season: number;
  round_number: number;
  source: string;
  last_seen_at: string;
  stats: {
    kicks?: number;
    handballs?: number;
    disposals?: number;
    marks?: number;
    tackles?: number;
    goals?: number;
    behinds?: number;
    // ... more stats
  };
}
```

### Legacy Player Stats (Transformed)
```typescript
interface LegacyPlayerStat {
  id: string;
  name: string;
  team: string;
  position: string;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  goals: number;
  behinds: number;
  fantasyScore: number; // Calculated
  round: number;
  season: number;
  lastUpdated: string;
  source: string;
}
```

### Match Data
```typescript
interface ETLMatch {
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: "scheduled" | "in_progress" | "final";
  provider_ids?: Record<string, any>;
}
```

## Available Hooks

### `useLiveData(options?)`
- **Purpose**: Get live player statistics and match data
- **Polling**: Automatic 30-second updates during live matches
- **Returns**: `{ playerStats, rawPlayerStats, liveMatches, isLive, lastUpdate, isLoading, error, refresh }`

### `useMatchData(matchUid)`
- **Purpose**: Get all player statistics for a specific match
- **Returns**: `{ playerStats, isLoading, error }`

### `usePlayerData(playerUid, recentGamesCount?)`
- **Purpose**: Get player profile and recent game statistics
- **Returns**: `{ profile, recentStats, isLoading, error }`

### `useTeamData(team, season?)`
- **Purpose**: Get current statistics for all players on a team
- **Returns**: `{ currentStats, isLoading, error }`

## API Endpoints

### Live Data: `/api/live-data`
- **GET**: Current live player stats and matches
- **Query Params**: `format` (legacy|raw), `limit`, `season`
- **POST**: Trigger manual refresh

### ETL Data: `/api/etl`
- **GET**: Specific data by type
- **Types**: `match`, `player`, `team`, `round`
- **Examples**:
  - `?type=player&playerUid=ply_clayton_oliver&limit=10`
  - `?type=match&matchUid=match_2025_1_melbourne_richmond`
  - `?type=team&team=Melbourne&season=2025`
  - `?type=round&season=2025&round=1`

## Fantasy Score Calculation

The system automatically calculates AFL fantasy scores using this formula:

```typescript
function calculateFantasyScore(stats) {
  return (
    (stats.kicks || 0) * 3 +
    (stats.handballs || 0) * 2 +
    (stats.marks || 0) * 3 +
    (stats.tackles || 0) * 4 +
    (stats.goals || 0) * 6 +
    (stats.behinds || 0) * 1 +
    (stats.hitouts || 0) * 1 +
    (stats.frees_against || 0) * -3 +
    (stats.clangers || 0) * -4
  );
}
```

## Error Handling

The system includes comprehensive error handling:

```typescript
function handleETLError(error: unknown) {
  if (error instanceof Error) {
    console.error('ETL Error:', error.message);
    // Log to monitoring service
  }
  
  // Fallback to mock data or cached data
  return fallbackData;
}
```

## Performance Considerations

1. **Polling**: Only polls during live matches to conserve resources
2. **Caching**: Firebase handles caching and indexing
3. **Rate Limiting**: Built-in deduplication prevents duplicate requests
4. **Lazy Loading**: Components only fetch data when needed

## Deployment Checklist

- [ ] Firebase service account configured
- [ ] Google Cloud Run service deployed
- [ ] ETL cron jobs scheduled
- [ ] API routes tested
- [ ] Components migrated from mock data
- [ ] Error monitoring configured
- [ ] Performance monitoring enabled

## Troubleshooting

### No Live Data Available
- Check if matches are currently in progress
- Verify ETL pipeline is running
- Check Firebase connection and permissions

### High Latency
- Monitor Google Cloud Run logs
- Check Firebase read/write usage
- Verify network connectivity

### Stale Data
- Check ETL polling interval
- Verify data source availability
- Review deduplication logic

## Next Steps

1. **Deploy ETL Pipeline**: Set up the complete data ingestion system
2. **Migrate Components**: Replace mock data with live data hooks
3. **Add Monitoring**: Implement error tracking and performance monitoring
4. **Optimize Queries**: Add indexes and caching for frequently accessed data
5. **Scale Infrastructure**: Configure auto-scaling for high-traffic periods

For detailed implementation examples, see `src/components/examples/LiveDataExample.tsx`.
