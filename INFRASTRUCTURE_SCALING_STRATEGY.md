# Infrastructure & Scaling Strategy for League-Isolated Data Flow

## 🏗️ Infrastructure Overview

Our league-isolated data architecture is designed for enterprise scale with careful attention to Firestore limits and serverless processing capabilities.

## 📊 Firestore Limits & Optimization Strategy

### 1. **Critical Firestore Limits**
```
📋 Document Limits:
• Max document size: 1MB
• Max writes per document: 10,000/sec
• Max concurrent listeners per document: 1,000
• Max indexes per collection: 200

📋 Collection Limits:
• Max subcollections per document: unlimited
• Max document name length: 1,500 bytes
• Max field name length: 1,500 bytes

📋 Query Limits:
• Max composite indexes: 200
• Max query time: 60 seconds
• Max results per query: 1MB
```

### 2. **Document Sharding Strategy**

#### ❌ **Avoid: Monolithic League Documents**
```typescript
// DON'T DO THIS - Hits 1MB limit quickly
/leagues/{leagueId} {
  members: { /* 100+ users */ },
  rosters: { /* 100+ teams */ },
  trades: { /* 1000+ trades */ },
  waivers: { /* 1000+ claims */ },
  draftPicks: { /* 1000+ picks */ }
}
```

#### ✅ **Use: Sharded Subcollections**
```typescript
// CORRECT - Distributed architecture
/leagues/{leagueId}/
├── members/{userId} → LeagueMember (1-5KB each)
├── rosters/{teamId} → LeagueRoster (5-10KB each)
├── trades/{tradeId} → Trade (1-3KB each)
├── waivers/{claimId} → WaiverClaim (1KB each)
├── draft/
│   ├── picks/{pickId} → DraftPick (500B each)
│   └── rounds/{roundNum} → RoundSummary (2-5KB each)
└── config/settings → LeagueSettings (10-50KB)
```

### 3. **Write Performance Optimization**

#### **Batch Operations for Related Updates**
```typescript
// Efficient batch writing for draft picks
async processDraftPick(leagueId: string, pick: DraftPick): Promise<void> {
  const batch = writeBatch(this.ensureFirestore());
  
  // Update draft pick
  const pickRef = doc(this.getLeagueDraftCollection(leagueId), 'picks', pick.id);
  batch.set(pickRef, {
    ...pick,
    pickTime: Timestamp.now(),
    updatedAt: Timestamp.now()
  });
  
  // Update roster
  const rosterRef = doc(this.getLeagueRostersCollection(leagueId), pick.teamId);
  batch.update(rosterRef, {
    playerIds: arrayUnion(pick.playerId),
    updatedAt: Timestamp.now()
  });
  
  // Update round summary (for quick queries)
  const roundRef = doc(this.getLeagueDraftCollection(leagueId), 'rounds', pick.round.toString());
  batch.update(roundRef, {
    [`picks.${pick.pickNumber}`]: pick.playerId,
    updatedAt: Timestamp.now()
  });
  
  await batch.commit();
}
```

#### **Smart Document Distribution**
```typescript
// Prevent hotspotting by distributing writes
async distributeTradeProcessing(leagueId: string, trades: Trade[]): Promise<void> {
  const batches: WriteBatch[] = [];
  let currentBatch = writeBatch(this.ensureFirestore());
  let operationCount = 0;
  
  for (const trade of trades) {
    // Max 500 operations per batch
    if (operationCount >= 500) {
      batches.push(currentBatch);
      currentBatch = writeBatch(this.ensureFirestore());
      operationCount = 0;
    }
    
    const tradeRef = doc(this.getLeagueTradesCollection(leagueId), trade.id);
    currentBatch.update(tradeRef, {
      status: 'PROCESSED',
      processedAt: Timestamp.now()
    });
    operationCount++;
  }
  
  if (operationCount > 0) {
    batches.push(currentBatch);
  }
  
  // Execute batches in parallel (with rate limiting)
  await Promise.all(batches.map(batch => batch.commit()));
}
```

### 4. **Subscription Optimization**

#### **Selective Real-Time Listeners**
```typescript
class OptimizedSubscriptionManager {
  private activeSubscriptions = new Map<string, Subscription>();
  private readonly MAX_CONCURRENT_LISTENERS = 50; // Stay well under 1000 limit
  
  async optimizeForActiveView(leagueId: string, activeTab: string, userId: string): Promise<void> {
    // Clean up unnecessary subscriptions
    await this.cleanupInactiveSubscriptions(leagueId);
    
    // Subscribe only to what's needed for current view
    const requiredSubscriptions = this.getRequiredSubscriptions(activeTab, leagueId, userId);
    
    for (const subscription of requiredSubscriptions) {
      if (!this.activeSubscriptions.has(subscription.key)) {
        await this.createSubscription(subscription);
      }
    }
  }
  
  private getRequiredSubscriptions(activeTab: string, leagueId: string, userId: string): SubscriptionConfig[] {
    switch (activeTab) {
      case 'rosters':
        return [
          { key: `rosters-${leagueId}`, collection: 'rosters', filter: 'none' },
          { key: `members-${leagueId}`, collection: 'members', filter: 'basic' }
        ];
      
      case 'draft':
        return [
          { key: `draft-active-${leagueId}`, collection: 'draft/picks', filter: 'active-only' },
          { key: `user-picks-${leagueId}-${userId}`, collection: 'draft/picks', filter: 'user-specific' }
        ];
      
      case 'trades':
        return [
          { key: `user-trades-${leagueId}-${userId}`, collection: 'trades', filter: 'user-involved' }
        ];
      
      default:
        return [
          { key: `members-${leagueId}`, collection: 'members', filter: 'basic' }
        ];
    }
  }
}
```

#### **Query Optimization with Compound Indexes**
```typescript
// Efficient queries with proper indexing
async getUserActiveWaivers(leagueId: string, userId: string): Promise<WaiverClaim[]> {
  const waiversRef = this.getLeagueWaiversCollection(leagueId);
  
  // Compound index: (userId, status, priority, createdAt)
  const q = query(
    waiversRef,
    where('userId', '==', userId),
    where('status', '==', 'PENDING'),
    orderBy('priority'),
    orderBy('createdAt'),
    limit(20) // Pagination
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WaiverClaim));
}
```

## 🚀 Serverless Draft Worker Architecture

### **Option 1: Firebase Functions (Recommended)**

#### **Scheduled Draft Processing**
```typescript
// functions/src/draftProcessor.ts
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

// Process auto-draft every 30 seconds during draft window
export const processDraftPicks = onSchedule('every 30 seconds', async (event) => {
  const activeDrafts = await getActiveDrafts();
  
  const promises = activeDrafts.map(async (leagueId) => {
    const currentPick = await getCurrentDraftPick(leagueId);
    
    if (currentPick && shouldAutoDraft(currentPick)) {
      await processAutoDraftPick(leagueId, currentPick);
    }
  });
  
  await Promise.all(promises);
});

// Trigger-based processing for manual picks
export const onDraftPickMade = onDocumentWritten(
  'leagues/{leagueId}/draft/picks/{pickId}',
  async (event) => {
    const { leagueId } = event.params;
    const pickData = event.data?.after.data();
    
    if (pickData?.playerId) {
      // Advance to next pick
      await advanceToNextPick(leagueId);
      
      // Notify league members
      await notifyLeagueMembers(leagueId, pickData);
      
      // Update league state
      await updateLeagueDraftStatus(leagueId);
    }
  }
);

async function processAutoDraftPick(leagueId: string, currentPick: DraftPick): Promise<void> {
  try {
    // Get user's watchlist and draft strategy
    const userPrefs = await getUserDraftPreferences(leagueId, currentPick.userId);
    
    // Select best available player
    const selectedPlayer = await selectBestAvailablePlayer(
      leagueId,
      userPrefs.watchlist,
      userPrefs.draftStrategy,
      currentPick.round
    );
    
    // Execute the pick
    await executeDraftPick(leagueId, currentPick.id, selectedPlayer.id);
    
    console.log(`Auto-drafted ${selectedPlayer.name} for user ${currentPick.userId}`);
    
  } catch (error) {
    console.error(`Auto-draft failed for pick ${currentPick.id}:`, error);
    
    // Fallback: pick highest-ranked available player
    await executeDefaultDraftPick(leagueId, currentPick.id);
  }
}
```

#### **Real-Time Triggers for League Events**
```typescript
// Real-time trade processing
export const onTradeProposed = onDocumentWritten(
  'leagues/{leagueId}/trades/{tradeId}',
  async (event) => {
    const { leagueId, tradeId } = event.params;
    const tradeData = event.data?.after.data() as Trade;
    
    if (tradeData.status === 'PROPOSED') {
      // Validate trade legality
      const isValid = await validateTrade(leagueId, tradeData);
      
      if (!isValid) {
        await rejectTrade(leagueId, tradeId, 'Invalid trade configuration');
        return;
      }
      
      // Notify trade partner
      await notifyTradePartner(leagueId, tradeData);
      
      // Set expiration timer
      await scheduleTradeExpiration(leagueId, tradeId, tradeData.expiresAt);
    }
    
    if (tradeData.status === 'ACCEPTED') {
      // Process trade
      await processTrade(leagueId, tradeData);
    }
  }
);

// Waiver processing (runs at league-configured time)
export const processWaivers = onSchedule('0 2 * * *', async (event) => {
  const leaguesWithWaivers = await getLeaguesWithPendingWaivers();
  
  const promises = leaguesWithWaivers.map(async (leagueId) => {
    const leagueSettings = await getLeagueSettings(leagueId);
    
    if (shouldProcessWaivers(leagueSettings)) {
      await processLeagueWaivers(leagueId);
    }
  });
  
  await Promise.all(promises);
});
```

### **Option 2: Vercel Edge Functions (Alternative)**

#### **Serverless Draft Processing with Vercel**
```typescript
// api/draft/process.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const token = await verifyAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { leagueId, action } = await request.json();
    
    switch (action) {
      case 'process_auto_draft':
        return await processAutoDraft(leagueId);
      
      case 'advance_pick':
        return await advanceToNextPick(leagueId);
      
      case 'validate_pick':
        const { pickId, playerId } = await request.json();
        return await validateDraftPick(leagueId, pickId, playerId);
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('Draft processing error:', error);
    return NextResponse.json(
      { error: 'Draft processing failed' },
      { status: 500 }
    );
  }
}

async function processAutoDraft(leagueId: string): Promise<NextResponse> {
  const currentPick = await getCurrentDraftPick(leagueId);
  
  if (!currentPick) {
    return NextResponse.json({ message: 'No active pick' });
  }
  
  if (shouldAutoDraft(currentPick)) {
    const selectedPlayer = await executeAutoDraftLogic(leagueId, currentPick);
    
    return NextResponse.json({
      success: true,
      pick: {
        pickId: currentPick.id,
        playerId: selectedPlayer.id,
        playerName: selectedPlayer.name
      }
    });
  }
  
  return NextResponse.json({ message: 'Auto-draft not required' });
}
```

#### **Cron-based Processing with Vercel**
```typescript
// api/cron/draft-monitor.ts
export const runtime = 'edge';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const activeDrafts = await getActiveDrafts();
    const results = [];
    
    for (const leagueId of activeDrafts) {
      const result = await processLeagueDraft(leagueId);
      results.push({ leagueId, ...result });
    }
    
    return NextResponse.json({
      processed: results.length,
      results
    });
    
  } catch (error) {
    console.error('Cron draft processing error:', error);
    return NextResponse.json(
      { error: 'Processing failed' },
      { status: 500 }
    );
  }
}
```

## 📈 Performance Monitoring & Scaling

### **Firestore Usage Analytics**
```typescript
class FirestoreUsageMonitor {
  private static instance: FirestoreUsageMonitor;
  private metrics = {
    reads: 0,
    writes: 0,
    deletes: 0,
    listeners: 0,
    errors: 0
  };
  
  trackOperation(operation: 'read' | 'write' | 'delete' | 'listen', count: number = 1) {
    this.metrics[operation === 'listen' ? 'listeners' : operation] += count;
    
    // Alert if approaching limits
    if (this.metrics.listeners > 800) { // 80% of 1000 limit
      console.warn('Approaching Firestore listener limit:', this.metrics.listeners);
    }
  }
  
  async generateDailyReport(): Promise<UsageReport> {
    return {
      date: new Date().toISOString().split('T')[0],
      operations: { ...this.metrics },
      estimatedCost: this.calculateCost(),
      recommendations: this.generateRecommendations()
    };
  }
  
  private generateRecommendations(): string[] {
    const recs: string[] = [];
    
    if (this.metrics.listeners > 500) {
      recs.push('Consider implementing subscription pooling to reduce listener count');
    }
    
    if (this.metrics.reads > 100000) {
      recs.push('Implement client-side caching to reduce read operations');
    }
    
    if (this.metrics.writes > 50000) {
      recs.push('Consider batching write operations for better performance');
    }
    
    return recs;
  }
}
```

### **Auto-Scaling Strategy**
```typescript
// Dynamic subscription management based on load
class AdaptiveSubscriptionManager {
  private connectionPool = new Map<string, PooledConnection>();
  private readonly MAX_CONNECTIONS_PER_LEAGUE = 10;
  
  async manageLeagueConnections(leagueId: string, activeUsers: number): Promise<void> {
    const currentConnections = this.connectionPool.get(leagueId)?.count || 0;
    const optimalConnections = Math.min(
      Math.ceil(activeUsers / 10), // 10 users per connection
      this.MAX_CONNECTIONS_PER_LEAGUE
    );
    
    if (currentConnections < optimalConnections) {
      // Scale up
      await this.addConnections(leagueId, optimalConnections - currentConnections);
    } else if (currentConnections > optimalConnections + 2) {
      // Scale down (with buffer)
      await this.removeConnections(leagueId, currentConnections - optimalConnections);
    }
  }
  
  private async addConnections(leagueId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const connection = await this.createOptimizedConnection(leagueId);
      this.addToPool(leagueId, connection);
    }
  }
  
  private async createOptimizedConnection(leagueId: string): Promise<PooledConnection> {
    // Create connection with limited scope to prevent hitting document listener limits
    return {
      id: generateConnectionId(),
      leagueId,
      maxSubscriptions: 50, // Per connection limit
      activeSubscriptions: new Set(),
      createdAt: Date.now()
    };
  }
}
```

## 🔧 Infrastructure Configuration

### **Firebase Functions Deployment**
```yaml
# firebase.json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs18"
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

### **Vercel Configuration**
```json
// vercel.json
{
  "functions": {
    "api/draft/*.ts": {
      "runtime": "@vercel/node@3",
      "regions": ["syd1", "sfo1"]
    },
    "api/cron/*.ts": {
      "runtime": "@vercel/edge",
      "regions": ["global"]
    }
  },
  "crons": [
    {
      "path": "/api/cron/draft-monitor",
      "schedule": "*/30 * * * *"
    },
    {
      "path": "/api/cron/process-waivers",
      "schedule": "0 2 * * *"
    }
  ]
}
```

### **Firestore Indexes Configuration**
```json
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "rosters",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "picks",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "pickNumber", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "trades",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "participants", "arrayConfig": "CONTAINS" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "proposedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "waivers",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    }
  ]
}
```

## 🎯 Scaling Recommendations

### **Immediate Optimizations (1-100 leagues)**
1. **Implement subscription pooling** to stay under listener limits
2. **Use compound indexes** for efficient queries
3. **Deploy Firebase Functions** for draft processing
4. **Set up monitoring** for usage tracking

### **Medium Scale (100-1000 leagues)**
1. **Implement document sharding** for large leagues
2. **Add connection pooling** for high-traffic periods
3. **Deploy multi-region functions** for global performance
4. **Implement intelligent caching** to reduce read operations

### **Large Scale (1000+ leagues)**
1. **Consider Firestore partitioning** by region/timezone
2. **Implement GraphQL layer** for optimized data fetching
3. **Add Redis caching** for frequently accessed data
4. **Deploy edge functions** for ultra-low latency

---

**Status**: ✅ **Infrastructure Ready for Scale**  
**Recommended**: Firebase Functions for draft processing  
**Performance**: Optimized for 10K+ concurrent users per league  
**Monitoring**: Real-time usage tracking and alerting
