# Migration Helper: From Mock Data to Live Data

This document provides step-by-step guidance for migrating your existing components from mock data to live ETL data.

## Quick Migration Steps

### 1. Replace Basic Player Stats

**Before (Mock Data):**
```typescript
// Old mock data approach
const mockPlayers = [
  { id: '1', name: 'Player 1', fantasyScore: 85, team: 'Team A' },
  { id: '2', name: 'Player 2', fantasyScore: 92, team: 'Team B' }
];

function MyComponent() {
  const players = mockPlayers;
  return (
    <div>
      {players.map(player => (
        <div key={player.id}>{player.name}: {player.fantasyScore}</div>
      ))}
    </div>
  );
}
```

**After (Live Data):**
```typescript
import { useLiveData } from '@/hooks/useLiveData';

function MyComponent() {
  const { playerStats: players, isLoading, error } = useLiveData();
  
  if (isLoading) return <div>Loading live data...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div>
      {players.map(player => (
        <div key={player.id}>{player.name}: {player.fantasyScore}</div>
      ))}
    </div>
  );
}
```

### 2. Add Live Status Indicators

```typescript
import { useLiveData } from '@/hooks/useLiveData';

function ComponentWithLiveStatus() {
  const { playerStats, isLive, minutesSinceUpdate } = useLiveData();
  
  return (
    <div>
      <div className="flex items-center mb-4">
        <div className={`w-3 h-3 rounded-full mr-2 ${isLive ? 'bg-green-500' : 'bg-gray-400'}`} />
        <span className="text-sm">
          {isLive ? `Live (${minutesSinceUpdate}m ago)` : 'No live matches'}
        </span>
      </div>
      
      {/* Your existing component content */}
      {playerStats.map(player => (
        <div key={player.id}>{player.name}: {player.fantasyScore}</div>
      ))}
    </div>
  );
}
```

### 3. Player-Specific Components

**Before:**
```typescript
function PlayerCard({ playerId }: { playerId: string }) {
  const player = mockPlayers.find(p => p.id === playerId);
  return <div>{player?.name}: {player?.fantasyScore}</div>;
}
```

**After:**
```typescript
import { usePlayerData } from '@/hooks/useLiveData';

function PlayerCard({ playerUid }: { playerUid: string }) {
  const { profile, recentStats, isLoading } = usePlayerData(playerUid, 5);
  
  if (isLoading) return <div>Loading player...</div>;
  
  const avgScore = recentStats.length > 0 
    ? recentStats.reduce((sum, stat) => sum + calculateFantasyScore(stat.stats), 0) / recentStats.length 
    : 0;
    
  return (
    <div>
      <h3>{profile?.full_name}</h3>
      <p>Team: {profile?.current_team}</p>
      <p>Recent Average: {avgScore.toFixed(1)}</p>
      <p>Games Played: {recentStats.length}</p>
    </div>
  );
}
```

### 4. Match-Specific Data

```typescript
import { useMatchData } from '@/hooks/useLiveData';

function MatchStatsTable({ matchUid }: { matchUid: string }) {
  const { playerStats, isLoading, error } = useMatchData(matchUid);
  
  if (isLoading) return <div>Loading match data...</div>;
  if (error) return <div>Error loading match: {error}</div>;
  
  return (
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Team</th>
          <th>Disposals</th>
          <th>Goals</th>
        </tr>
      </thead>
      <tbody>
        {playerStats.map(stat => (
          <tr key={stat.player_uid}>
            <td>{stat.player_uid.replace('ply_', '').replace(/_/g, ' ')}</td>
            <td>{stat.team}</td>
            <td>{stat.stats.disposals || 0}</td>
            <td>{stat.stats.goals || 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### 5. Team-Based Components

```typescript
import { useTeamData } from '@/hooks/useLiveData';

function TeamRoster({ team }: { team: string }) {
  const { currentStats, isLoading } = useTeamData(team);
  
  if (isLoading) return <div>Loading team data...</div>;
  
  return (
    <div>
      <h2>{team} Current Stats</h2>
      {currentStats.map(stat => (
        <div key={stat.player_uid}>
          {stat.player_uid.replace('ply_', '').replace(/_/g, ' ')}: 
          {calculateFantasyScore(stat.stats)} points
        </div>
      ))}
    </div>
  );
}
```

## Data Structure Mapping

### Legacy Format (Backward Compatible)
```typescript
interface LegacyPlayerStat {
  id: string;           // player_uid
  name: string;         // derived from player_uid
  team: string;         // team
  position: string;     // default 'MID'
  kicks: number;        // stats.kicks
  handballs: number;    // stats.handballs
  disposals: number;    // stats.disposals
  marks: number;        // stats.marks
  tackles: number;      // stats.tackles
  goals: number;        // stats.goals
  behinds: number;      // stats.behinds
  fantasyScore: number; // calculated
  round: number;        // round_number
  season: number;       // season
  lastUpdated: string;  // last_seen_at
  source: string;       // source
}
```

### Raw ETL Format (Full Data)
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
    hitouts?: number;
    clearances?: number;
    // ... 20+ more stats
  };
}
```

## Common Patterns

### 1. Loading States
```typescript
const { playerStats, isLoading, error } = useLiveData();

if (isLoading) return <LoadingSkeleton />;
if (error) return <ErrorMessage error={error} />;
// Render component with data
```

### 2. Polling Control
```typescript
const { playerStats, refresh } = useLiveData({
  enablePolling: true,     // Enable automatic polling
  pollingInterval: 30000,  // 30 seconds
  transformToLegacy: true  // Use legacy format
});

// Manual refresh
<button onClick={refresh}>Refresh Data</button>
```

### 3. Error Boundaries
```typescript
function SafeComponent() {
  try {
    const { playerStats } = useLiveData();
    return <YourComponent data={playerStats} />;
  } catch (error) {
    console.error('Live data error:', error);
    return <FallbackComponent />;
  }
}
```

### 4. Performance Optimization
```typescript
// Only poll during live matches
const { isLive } = useLiveData({ enablePolling: false });
const { playerStats } = useLiveData({ 
  enablePolling: isLive, 
  pollingInterval: isLive ? 30000 : 0 
});
```

## Migration Checklist

- [ ] Replace mock data imports with `useLiveData` hook
- [ ] Add loading states for all data-dependent components
- [ ] Add error handling for network failures
- [ ] Update prop types to match live data structure
- [ ] Add live status indicators where appropriate
- [ ] Test components with empty data states
- [ ] Verify polling behavior during live matches
- [ ] Update tests to use live data mocks
- [ ] Document any breaking changes in component APIs

## Testing with Live Data

### Mock Live Data for Testing
```typescript
// For testing, you can mock the hook
jest.mock('@/hooks/useLiveData', () => ({
  useLiveData: () => ({
    playerStats: mockLegacyPlayerStats,
    isLive: true,
    isLoading: false,
    error: null,
    refresh: jest.fn()
  })
}));
```

### Integration Testing
```typescript
// Test with real Firebase emulator
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

beforeEach(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'test-project',
    hub: { host: 'localhost', port: 4400 }
  });
  
  // Seed test data
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('player_match_stats').add(mockPlayerStat);
  });
});
```

## Troubleshooting

### No Data Showing
1. Check Firebase connection: `console.log(db)` in browser
2. Verify collections exist: Check Firebase console
3. Check network tab for API calls
4. Verify hook is being called correctly

### Stale Data
1. Check polling interval settings
2. Verify ETL pipeline is running
3. Check `last_seen_at` timestamps
4. Manual refresh: `refresh()` function

### Performance Issues
1. Reduce polling frequency during non-live periods
2. Limit data with `limit` parameter
3. Use React.memo for expensive components
4. Consider data virtualization for large lists

For more detailed examples, see `src/components/examples/LiveDataExample.tsx`.
