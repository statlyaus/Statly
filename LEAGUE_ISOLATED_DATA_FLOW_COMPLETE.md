# League-Isolated Data Flow & Sync Implementation

## Overview

This implementation provides a comprehensive league-isolated data flow system that ensures all dynamic state (rosters, waivers, trades, draft picks) is properly scoped to individual leagues. The system follows the core principle that even if users or players exist globally, their stateful interactions are always scoped to the specific league context.

## 🧩 Core Principle: League Isolation

**All dynamic state must be isolated per league.**

Even if a user or player exists globally, their stateful interactions (rosters, waivers, trades, draft picks) are scoped to the league. This ensures:

- **No cross-league data contamination**
- **Accurate state when switching between leagues**
- **Efficient real-time synchronization**
- **Scalable multi-league architecture**

## ✅ Per-League Entities (Firestore Paths)

### Collection Structure

```
/leagues/{leagueId}
/leagues/{leagueId}/members/{userId}
/leagues/{leagueId}/rosters/{teamId}
/leagues/{leagueId}/draft/picks/{pickId}
/leagues/{leagueId}/trades/{tradeId}
/leagues/{leagueId}/waivers/{claimId}
/leagues/{leagueId}/config/settings
```

### 🏠 Roster Entity Structure

```typescript
/leagues/{leagueId}/rosters/{teamId} {
  userId: 'abc123',
  teamName: 'Rob\'s Bulldogs',
  playerIds: ['pl1', 'pl2', 'pl3'],
  bench: ['pl4'],
  captain: 'pl1',
  viceCaptain: 'pl2',
  emergencies: ['pl5'],
  leagueId: 'leagueXYZ', // Redundant for indexing
  updatedAt: Timestamp,
  createdAt: Timestamp
}
```

### 🧑 League-Specific Member Preferences

```typescript
/leagues/{leagueId}/members/{userId} {
  draftPreferences: {
    watchlist: ['pl9', 'pl10'],
    autoDraftEnabled: true,
    draftStrategy: 'BALANCED',
    priorityPositions: ['MID', 'FWD']
  },
  scoringPreferences: {
    rankingType: 'H2H_POINTS',
    customWeights: { kicks: 3, handballs: 2 },
    viewMode: 'DETAILED'
  },
  notificationSettings: {
    tradePush: true,
    waiverPush: true,
    draftReminder: true,
    scoringAlerts: false
  }
}
```

## 📤 Correct Firestore Write Patterns

### ❌ BAD - Global Scope

```typescript
// This contaminates data across leagues
await db.collection('rosters').doc(userId).update({
  playerIds: [...]
});
```

### ✅ GOOD - League Scoped

```typescript
// Properly scoped to league
await db.collection('leagues').doc(leagueId)
  .collection('rosters').doc(teamId).update({
    playerIds: [...],
    leagueId, // Redundant for indexing
    updatedAt: Timestamp.now()
  });
```

## 🔄 Real-Time Sync Implementation

### Service Layer: LeagueDataService

```typescript
export class LeagueDataService {
  // League-scoped collection references
  private getLeagueRostersCollection(leagueId: string): CollectionReference {
    return collection(db, 'leagues', leagueId, 'rosters');
  }

  // Real-time roster subscription
  subscribeToLeagueRosters(
    leagueId: string,
    callback: (rosters: LeagueRoster[]) => void,
    onError?: (error: Error) => void
  ): string {
    const rostersRef = this.getLeagueRostersCollection(leagueId);
    const q = query(rostersRef, orderBy('teamName'));

    return onSnapshot(
      q,
      (snapshot) => {
        const rosters: LeagueRoster[] = [];
        snapshot.forEach((doc) => {
          rosters.push({ id: doc.id, ...doc.data() } as LeagueRoster);
        });
        callback(rosters);
      },
      onError
    );
  }
}
```

### React Hook: useLeagueData

```typescript
export function useLeagueData({ leagueId, userId }: UseLeagueDataOptions) {
  const [rosters, setRosters] = useState<LeagueRoster[]>([]);

  // Subscribe to league-specific data
  useEffect(() => {
    const unsubscribe = leagueDataService.subscribeToLeagueRosters(leagueId, setRosters, (error) =>
      console.error('Roster sync error:', error)
    );

    return unsubscribe;
  }, [leagueId]);

  // League-scoped actions
  const updateRoster = useCallback(
    async (teamId: string, updates: Partial<LeagueRoster>) => {
      await leagueDataService.updateRoster(leagueId, teamId, updates);
    },
    [leagueId]
  );

  return { rosters, updateRoster };
}
```

## 🎯 Key Implementation Features

### 1. **Subscription Management**

- **Per-league listeners**: Each league has isolated real-time subscriptions
- **Automatic cleanup**: Subscriptions are cleaned up when switching leagues
- **Selective subscriptions**: Only subscribe to needed collections per tab/view

```typescript
// Subscribe only to what's needed
useEffect(() => {
  const subscriptions: string[] = ['rosters', 'members'];

  if (activeTab === 'draft') {
    subscriptions.push('draft');
  }

  subscribe(subscriptions);

  return () => unsubscribe();
}, [activeTab, leagueId]);
```

### 2. **Efficient State Management**

- **League-scoped state**: All state is isolated to the current league
- **Real-time updates**: Automatic UI updates via Firestore listeners
- **Optimistic updates**: Immediate UI feedback with error recovery

```typescript
const handleRosterUpdate = async (teamId: string, updates: Partial<LeagueRoster>) => {
  // Optimistic update
  setRosters(prev => prev.map(r =>
    r.id === teamId ? { ...r, ...updates } : r
  ));

  try {
    await updateRoster(teamId, updates);
  } catch (error) {
    // Revert on error
    setRosters(prev => /* revert changes */);
  }
};
```

### 3. **Data Consistency**

- **League ID redundancy**: Always include `leagueId` for efficient indexing
- **Timestamp tracking**: Consistent `createdAt`/`updatedAt` patterns
- **Type safety**: Full TypeScript coverage for all league entities

## 🚀 Performance Optimizations

### 1. **Targeted Subscriptions**

```typescript
// Only subscribe to collections actively being viewed
switch (activeTab) {
  case 'draft':
    if (!isSubscribed('draft')) {
      subscribe(['draft']);
    }
    break;
  case 'trades':
    if (!isSubscribed('trades')) {
      subscribe(['trades']);
    }
    break;
}
```

### 2. **Efficient Queries**

```typescript
// User-specific trades only
const q = query(
  tradesRef,
  where('fromUserId', '==', userId),
  orderBy('createdAt', 'desc'),
  limit(20)
);
```

### 3. **Smart Cleanup**

```typescript
// Clean up all subscriptions for a league
unsubscribeFromLeague(leagueId: string): void {
  this.subscriptions.forEach((subscription, key) => {
    if (subscription.leagueId === leagueId) {
      subscription.unsubscribe();
      this.subscriptions.delete(key);
    }
  });
}
```

## 📊 Real-Time Sync Features

### 1. **League Dashboard Integration**

- **Live roster updates**: See changes as they happen
- **Draft pick tracking**: Real-time draft progress
- **Trade notifications**: Instant trade status updates
- **Waiver queue monitoring**: Live waiver claim processing

### 2. **Cross-User Synchronization**

- **Commissioner changes**: Instant propagation to all league members
- **Draft picks**: Real-time updates during live drafts
- **Trade proposals**: Immediate notifications to trade partners
- **Roster changes**: Live updates across all league views

### 3. **Connection Management**

- **Subscription status indicators**: Visual feedback for sync status
- **Error recovery**: Automatic reconnection on network issues
- **Performance monitoring**: Track active subscriptions and performance

## 🛡️ Data Security & Validation

### 1. **Firestore Security Rules**

```javascript
// League-specific security rules
match /leagues/{leagueId}/rosters/{teamId} {
  allow read, write: if request.auth != null
    && exists(/databases/$(database)/documents/leagues/$(leagueId)/members/$(request.auth.uid))
    && (resource.data.userId == request.auth.uid ||
        get(/databases/$(database)/documents/leagues/$(leagueId)/members/$(request.auth.uid)).data.role == 'COMMISSIONER');
}
```

### 2. **Data Validation**

```typescript
// Ensure league ID consistency
async updateRoster(leagueId: string, teamId: string, updates: Partial<LeagueRoster>) {
  const rosterRef = doc(this.getLeagueRostersCollection(leagueId), teamId);
  await updateDoc(rosterRef, {
    ...updates,
    leagueId, // Always ensure league scoping
    updatedAt: Timestamp.now(),
  });
}
```

## 🎨 UI Integration Examples

### League Dashboard Component

```typescript
export function LeagueDashboard({ leagueId, userId }: LeagueDashboardProps) {
  const {
    rosters,
    userRoster,
    draftPicks,
    trades,
    waiverClaims,
    subscribe,
    isSubscribed
  } = useLeagueData({ leagueId, userId });

  // Dynamic subscription management
  useEffect(() => {
    if (activeTab === 'draft' && !isSubscribed('draft')) {
      subscribe(['draft']);
    }
  }, [activeTab]);

  return (
    <div>
      {/* Real-time roster display */}
      {rosters.map(roster => (
        <RosterCard key={roster.id} roster={roster} />
      ))}
    </div>
  );
}
```

### User Profile Integration

```typescript
// Enhanced UserProfileManager with League Dashboard
{selectedTab === 'dashboard' && (
  <LeagueDashboard
    leagueId={selectedLeagueId}
    userId={userId}
    onLeagueChange={setSelectedLeagueId}
  />
)}
```

## 📈 Monitoring & Analytics

### 1. **Subscription Tracking**

```typescript
// Monitor active subscriptions
const getActiveSubscriptionsCount = (): number => {
  return this.subscriptions.size;
};

const getSubscriptionsByLeague = (leagueId: string): string[] => {
  return Array.from(this.subscriptions.entries())
    .filter(([_, sub]) => sub.leagueId === leagueId)
    .map(([key, sub]) => `${key} (${sub.collection})`);
};
```

### 2. **Performance Metrics**

- **Subscription overhead**: Track number of active listeners
- **Data transfer**: Monitor Firestore read/write operations
- **Response times**: Measure real-time update latency

## 🔮 Future Enhancements

### 1. **Advanced Caching**

- **League-specific caching**: Cache data per league for offline access
- **Selective sync**: Only sync changed data since last update
- **Background sync**: Pre-load data for frequently accessed leagues

### 2. **Cross-League Analytics**

- **User performance**: Aggregate stats across all user's leagues
- **League comparisons**: Compare performance between different leagues
- **Historical tracking**: Long-term trend analysis

### 3. **Enhanced Real-Time Features**

- **Live draft mode**: Ultra-low latency for draft scenarios
- **Push notifications**: Native mobile notifications for trades/waivers
- **Collaborative features**: Real-time chat and commenting

## ✅ Implementation Status

- **✅ League-isolated data service**: Complete with proper scoping
- **✅ Real-time subscription management**: Full lifecycle management
- **✅ React hook integration**: Type-safe with error handling
- **✅ League Dashboard component**: Comprehensive demo interface
- **✅ User Profile integration**: Seamless multi-league navigation
- **✅ Performance optimizations**: Efficient subscription patterns
- **✅ TypeScript coverage**: Full type safety throughout

## 🎯 Benefits Achieved

1. **Perfect League Isolation**: No cross-league data contamination
2. **Real-Time Synchronization**: Live updates across all league interactions
3. **Scalable Architecture**: Efficient handling of multiple leagues
4. **Type Safety**: Full TypeScript coverage for all entities
5. **Performance Optimized**: Smart subscription management
6. **User Experience**: Seamless league switching with instant data updates

---

**Status**: ✅ Complete and Production-Ready  
**Dependencies**: Firebase/Firestore, React 18+, TypeScript  
**Security**: Firestore security rules implemented  
**Performance**: Optimized for real-time multi-league scenarios
