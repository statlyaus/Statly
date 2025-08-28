# Waiver System Firestore Schema and Integration

## Overview
Comprehensive waiver queue system with rolling priority, FAAB bidding, and scheduled batch processing using Firestore document structure.

## Firestore Document Structure

### 1. Waiver Requests Collection
**Path:** `/leagues/{leagueId}/waiverRequests/{requestId}`

```typescript
interface WaiverRequestDocument {
  id: string;
  leagueId: string;
  userId: string;
  requestType: 'CLAIM' | 'DROP' | 'TRADE';
  targetPlayerId: string;
  dropPlayerId?: string;
  bidAmount?: number; // For FAAB systems
  priority: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  submittedAt: Timestamp;
  processedAt?: Timestamp;
  expiresAt?: Timestamp;
  reason?: string;
  metadata: {
    originalPriority?: number;
    previousOwner?: string;
    claimReason?: string;
    automaticDrop?: boolean;
  };
  
  // Firestore indexes
  _indexes: {
    'status_priority_submittedAt': [string, number, Timestamp];
    'userId_submittedAt': [string, Timestamp];
    'leagueId_status_expiresAt': [string, string, Timestamp];
  }
}
```

### 2. Waiver Priorities Collection
**Path:** `/leagues/{leagueId}/waiverPriorities/{userId}`

```typescript
interface WaiverPriorityDocument {
  userId: string;
  leagueId: string;
  currentPriority: number;
  seasonPriority: number;
  lastClaimDate?: Timestamp;
  totalClaims: number;
  remainingFAAB?: number;
  
  // Firestore indexes
  _indexes: {
    'currentPriority': [number];
    'lastClaimDate': [Timestamp];
  }
}
```

### 3. League Waiver Configuration
**Path:** `/leagues/{leagueId}/settings/waiverConfig`

```typescript
interface WaiverConfigDocument {
  leagueId: string;
  system: 'ROLLING_LIST' | 'FAAB' | 'FREE_AGENCY';
  processTime: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY' | 'CONTINUOUS';
  waiverPeriod: number; // hours
  claimSettings: {
    claimDeadline: string; // HH:MM format
    retroactiveClaims: boolean;
    blindBidding: boolean;
    minimumBid?: number;
    bidIncrement?: number;
  };
  dropSettings: {
    cantDropList: string[];
    minimumOwnershipTime: number; // hours
    dropDeadline?: string;
  };
  prioritySettings: {
    resetFrequency: 'NEVER' | 'WEEKLY' | 'MONTHLY' | 'SEASON';
    tiebreaker: 'RANDOM' | 'DRAFT_ORDER' | 'STANDINGS';
    movesToBack: boolean;
  };
  lastProcessed?: Timestamp;
  nextProcessTime?: Timestamp;
}
```

### 4. Waiver Processing Log
**Path:** `/leagues/{leagueId}/waiverLogs/{processId}`

```typescript
interface WaiverProcessingLogDocument {
  id: string;
  leagueId: string;
  processedAt: Timestamp;
  requestsProcessed: number;
  requestsApproved: number;
  requestsRejected: number;
  processingTimeMs: number;
  errors: Array<{
    requestId: string;
    error: string;
  }>;
  approvedClaims: string[]; // request IDs
  rejectedClaims: string[]; // request IDs
}
```

## Required Firestore Indexes

### Composite Indexes
```javascript
// For waiver queue processing
{
  collectionGroup: 'waiverRequests',
  fields: [
    { fieldPath: 'leagueId', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'priority', order: 'ASCENDING' },
    { fieldPath: 'submittedAt', order: 'ASCENDING' }
  ]
}

// For FAAB bidding queries
{
  collectionGroup: 'waiverRequests',
  fields: [
    { fieldPath: 'leagueId', order: 'ASCENDING' },
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'bidAmount', order: 'DESCENDING' },
    { fieldPath: 'submittedAt', order: 'ASCENDING' }
  ]
}

// For user claim history
{
  collectionGroup: 'waiverRequests',
  fields: [
    { fieldPath: 'userId', order: 'ASCENDING' },
    { fieldPath: 'submittedAt', order: 'DESCENDING' }
  ]
}

// For expiration cleanup
{
  collectionGroup: 'waiverRequests',
  fields: [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'expiresAt', order: 'ASCENDING' }
  ]
}

// For priority management
{
  collectionGroup: 'waiverPriorities',
  fields: [
    { fieldPath: 'leagueId', order: 'ASCENDING' },
    { fieldPath: 'currentPriority', order: 'ASCENDING' }
  ]
}
```

## Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Waiver requests - users can read all, create own, update own pending
    match /leagues/{leagueId}/waiverRequests/{requestId} {
      allow read: if isLeagueMember(leagueId);
      allow create: if isLeagueMember(leagueId) && 
                      request.auth.uid == resource.data.userId;
      allow update: if isLeagueMember(leagueId) && 
                      request.auth.uid == resource.data.userId &&
                      resource.data.status == 'PENDING' &&
                      request.data.status == 'REJECTED'; // Cancel only
      allow delete: if false; // No deletions allowed
    }
    
    // Waiver priorities - read only for members, write for commissioners
    match /leagues/{leagueId}/waiverPriorities/{userId} {
      allow read: if isLeagueMember(leagueId);
      allow write: if isLeagueCommissioner(leagueId);
    }
    
    // Waiver config - read for members, write for commissioners
    match /leagues/{leagueId}/settings/waiverConfig {
      allow read: if isLeagueMember(leagueId);
      allow write: if isLeagueCommissioner(leagueId);
    }
    
    // Processing logs - read only for commissioners
    match /leagues/{leagueId}/waiverLogs/{processId} {
      allow read: if isLeagueCommissioner(leagueId);
      allow write: if false; // System only
    }
    
    // Helper functions
    function isLeagueMember(leagueId) {
      return request.auth != null && 
             exists(/databases/$(database)/documents/leagues/$(leagueId)/members/$(request.auth.uid));
    }
    
    function isLeagueCommissioner(leagueId) {
      return request.auth != null && 
             get(/databases/$(database)/documents/leagues/$(leagueId)/members/$(request.auth.uid)).data.role == 'COMMISSIONER';
    }
  }
}
```

## Cloud Functions for Automated Processing

### 1. Scheduled Waiver Processing
```typescript
// Cloud Function: Process waivers daily at configured times
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

export const processWaivers = onSchedule('0 3 * * *', async (event) => {
  // Run daily at 3 AM
  const leagues = await db.collection('leagues').get();
  
  for (const leagueDoc of leagues.docs) {
    const leagueId = leagueDoc.id;
    const config = await db.doc(\`leagues/\${leagueId}/settings/waiverConfig\`).get();
    
    if (!config.exists) continue;
    
    const waiverConfig = config.data();
    const now = new Date();
    
    // Check if it's time to process this league
    if (shouldProcessNow(waiverConfig, now)) {
      await processLeagueWaivers(leagueId);
    }
  }
});

async function processLeagueWaivers(leagueId: string) {
  const batch = db.batch();
  
  // Get pending requests
  const pendingQuery = await db
    .collection(\`leagues/\${leagueId}/waiverRequests\`)
    .where('status', '==', 'PENDING')
    .where('expiresAt', '>', new Date())
    .orderBy('priority')
    .orderBy('submittedAt')
    .get();
  
  // Process each request
  for (const requestDoc of pendingQuery.docs) {
    const request = requestDoc.data();
    
    // Validate and execute claim
    const result = await validateAndExecuteClaim(request);
    
    // Update request status
    batch.update(requestDoc.ref, {
      status: result.success ? 'APPROVED' : 'REJECTED',
      processedAt: new Date(),
      reason: result.reason
    });
    
    // Update priority if needed
    if (result.success && shouldMovePriorityToBack(leagueId)) {
      const priorityRef = db.doc(\`leagues/\${leagueId}/waiverPriorities/\${request.userId}\`);
      batch.update(priorityRef, {
        currentPriority: await getNewBackPriority(leagueId),
        lastClaimDate: new Date(),
        totalClaims: admin.firestore.FieldValue.increment(1)
      });
    }
  }
  
  await batch.commit();
}
```

### 2. Real-time Validation
```typescript
// Cloud Function: Validate waiver claims on creation
export const validateWaiverClaim = functions.firestore
  .document('leagues/{leagueId}/waiverRequests/{requestId}')
  .onCreate(async (snap, context) => {
    const request = snap.data();
    const { leagueId } = context.params;
    
    // Validate roster constraints
    const validationResult = await validateRosterConstraints(leagueId, request);
    
    if (!validationResult.valid) {
      await snap.ref.update({
        status: 'REJECTED',
        reason: validationResult.reason,
        processedAt: new Date()
      });
    }
  });
```

## Integration with UserProfileManager

Add waiver management to the existing UserProfileManager component:

```tsx
// In UserProfileManager.tsx
import { WaiverManager } from '@/components/WaiverManager';

// Add waiver tab to navigation
const tabs = [
  { id: 'profile', label: 'Profile', count: null },
  { id: 'leagues', label: 'Leagues', count: activeLeagues.length },
  { id: 'waivers', label: 'Waivers', count: null },
  { id: 'watchlists', label: 'Watchlists', count: watchlists.length },
];

// Add waiver content
{selectedTab === 'waivers' && (
  <WaiverManager
    leagueId={selectedLeague} // User-selected league
    userId={userId}
    isCommissioner={isCommissioner}
    systemType={waiverConfig.system} // pass from league waiver config
  />
)}
```

## Queue Processing Algorithms

### Rolling List Priority
```typescript
function processRollingList(requests: WaiverRequest[]): WaiverRequest[] {
  return requests.sort((a, b) => {
    // Primary: Priority (lower number = higher priority)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Tiebreaker: Submission time (earlier = higher priority)
    return a.submittedAt.getTime() - b.submittedAt.getTime();
  });
}
```

### FAAB Bidding
```typescript
function processFAAB(requests: WaiverRequest[]): WaiverRequest[] {
  return requests.sort((a, b) => {
    // Primary: Bid amount (higher = wins)
    if ((a.bidAmount || 0) !== (b.bidAmount || 0)) {
      return (b.bidAmount || 0) - (a.bidAmount || 0);
    }
    // Tiebreaker: Priority or submission time
    return a.priority - b.priority;
  });
}
```

## Performance Optimizations

1. **Batch Processing**: Process all league waivers in batches to reduce Firestore read/write costs
2. **Indexed Queries**: Use composite indexes for efficient sorting and filtering
3. **Pagination**: Implement cursor-based pagination for large waiver histories
4. **Caching**: Cache league configurations and user priorities
5. **Atomic Transactions**: Use Firestore transactions for critical updates

## Error Handling and Monitoring

1. **Retry Logic**: Implement exponential backoff for failed operations
2. **Dead Letter Queue**: Handle permanently failed requests
3. **Monitoring**: Track processing times, success rates, and error patterns
4. **Alerting**: Notify commissioners of processing failures
5. **Audit Logging**: Maintain detailed logs of all waiver actions

## Testing Strategy

1. **Unit Tests**: Test individual waiver processing functions
2. **Integration Tests**: Test Firestore operations and Cloud Functions
3. **Load Tests**: Simulate high-volume waiver processing
4. **E2E Tests**: Test complete user workflows
5. **Performance Tests**: Measure query performance and optimization

This comprehensive system provides enterprise-level waiver management with proper data modeling, security, and scalability considerations.
