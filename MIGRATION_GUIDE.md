# 🚀 **UNIFIED DRAFT SYSTEM MIGRATION GUIDE**

## **Overview**

This guide outlines the migration from the fragmented, legacy draft system to the new unified, scalable architecture. The new system provides:

- **Single source of truth** for all draft state
- **Optimized real-time communication** via WebSockets
- **Performance monitoring** and optimization
- **Type-safe interfaces** throughout the system
- **Scalable architecture** for production use

## **🔄 Migration Phases**

### **Phase 1: Foundation (COMPLETED)**

- ✅ Unified type system (`src/types/draft.ts`)
- ✅ Draft reducer (`src/lib/draftReducer.ts`)
- ✅ Draft context (`src/contexts/DraftContext.tsx`)

### **Phase 2: Real-time Engine (COMPLETED)**

- ✅ WebSocket connection hook (`src/hooks/useRealtimeConnection.ts`)
- ✅ Draft service hook (`src/hooks/useDraftService.ts`)
- ✅ WebSocket server (`src/app/api/draft/websocket/route.ts`)

### **Phase 3: Performance Optimization (COMPLETED)**

- ✅ Unified draft room (`src/components/draft/UnifiedDraftRoom.tsx`)
- ✅ Performance monitoring (`src/hooks/useDraftPerformance.ts`)

### **Phase 4: Integration (COMPLETED)**

- ✅ Updated main draft page (`src/app/drafts/[id]/page.tsx`)
- ✅ Legacy draft room client component removed in favor of `UnifiedDraftRoom.tsx`

## **📋 Pre-Migration Checklist**

### **Database Updates**

```sql
-- Add new fields to existing tables if needed
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "direction" TEXT DEFAULT 'FORWARD';
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "currentPick" INTEGER DEFAULT 1;
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "round" INTEGER DEFAULT 1;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS "idx_draft_status" ON "Draft"("status");
CREATE INDEX IF NOT EXISTS "idx_draft_league" ON "Draft"("leagueId");
CREATE INDEX IF NOT EXISTS "idx_pick_draft" ON "DraftPick"("draftId");
```

### **Environment Variables**

```bash
# Add to .env.local
NEXT_PUBLIC_WS_HOST=localhost:3000
NEXT_PUBLIC_ENABLE_PERFORMANCE_MONITORING=true
NEXT_PUBLIC_ENABLE_WEBSOCKET_LOGGING=true
```

### **Dependencies**

```bash
# Install required packages
npm install framer-motion react-window react-beautiful-dnd
npm install --save-dev @types/ws
```

## **🔄 Step-by-Step Migration**

### **Step 1: Backup Current System**

```bash
# Create backup of current draft components
mkdir -p backup/draft-system
cp -r src/components/draft/* backup/draft-system/
cp -r src/hooks/use*Draft*.ts backup/draft-system/
cp -r src/services/draft*.ts backup/draft-system/
```

### **Step 2: Deploy New Components**

```bash
# The new components are already created and ready
# Verify they exist:
ls -la src/components/draft/
ls -la src/contexts/
ls -la src/hooks/useDraft*.ts
```

### **Step 3: Update Import Statements**

#### **Old Imports (Remove)**

```typescript
// Remove these imports from all files
import { useRealtimeDraft } from '@/hooks/useRealtimeDraft';
import { useLiveDraft } from '@/hooks/useLiveDraft';
import { useDraftManager } from '@/hooks/useDraftManager';
```

#### **New Imports (Add)**

```typescript
// Add these imports
import { useDraft } from '@/contexts/DraftContext';
import { DraftProvider } from '@/contexts/DraftContext';
import { UnifiedDraftRoom } from '@/components/draft/UnifiedDraftRoom';
```

### **Step 4: Update Component Usage**

#### **Before (Old System)**

```typescript
export default function DraftPage() {
  return (
    /* Legacy draft room component (removed) */
    <LegacyDraftComponent
      draftId={draftId}
      memberId={memberId}
      players={players}
      draftData={draftData}
    />
  );
}
```

#### **After (New System)**

```typescript
export default function DraftPage() {
  const { user } = useAuth();

  return (
    <DraftProvider draftId={draftId} userId={user.uid}>
      <UnifiedDraftRoom draftId={draftId} userId={user.uid} />
    </DraftProvider>
  );
}
```

### **Step 5: Update Hook Usage**

#### **Before (Old System)**

```typescript
const { draft, picks, participants } = useRealtimeDraft(draftId);
const { makePick, updateQueue } = useDraftManager(draftId);
```

#### **After (New System)**

```typescript
const {
  draft,
  picks,
  participants,
  makePick,
  updateQueue,
  connection,
  timer,
  isLive,
  canMakePick,
} = useDraft();
```

## **🧪 Testing the Migration**

### **1. Test Draft Creation**

```bash
# Navigate to draft creation page
# Create a new draft
# Verify it appears in the draft list
```

### **2. Test Draft Room**

```bash
# Join an existing draft
# Verify real-time updates work
# Test making picks
# Test pause/resume functionality
```

### **3. Test Performance**

```bash
# Open browser dev tools
# Monitor performance tab
# Check for memory leaks
# Verify smooth 60fps rendering
```

### **4. Test Error Handling**

```bash
# Disconnect network
# Verify graceful degradation
# Test reconnection
# Check error boundaries
```

## **🚨 Rollback Plan**

If issues arise during migration:

### **Immediate Rollback**

```bash
# Restore backup components
cp -r backup/draft-system/* src/components/draft/
cp -r backup/draft-system/* src/hooks/
cp -r backup/draft-system/* src/services/

# Revert main draft page
git checkout HEAD -- src/app/drafts/[id]/page.tsx

# Restart development server
npm run dev
```

### **Database Rollback**

```sql
-- Remove new fields if needed
ALTER TABLE "Draft" DROP COLUMN IF EXISTS "direction";
ALTER TABLE "Draft" DROP COLUMN IF EXISTS "currentPick";
ALTER TABLE "Draft" DROP COLUMN IF EXISTS "round";

-- Remove new indexes
DROP INDEX IF EXISTS "idx_draft_status";
DROP INDEX IF EXISTS "idx_draft_league";
DROP INDEX IF EXISTS "idx_pick_draft";
```

## **📊 Performance Comparison**

### **Before (Legacy System)**

- ❌ Multiple real-time connections (Socket.IO + Firestore + API polling)
- ❌ Fragmented state management across multiple hooks
- ❌ No performance monitoring
- ❌ Memory leaks from unmanaged subscriptions
- ❌ Inconsistent error handling

### **After (New System)**

- ✅ Single WebSocket connection with automatic reconnection
- ✅ Unified state management via React Context + Reducer
- ✅ Real-time performance monitoring and optimization
- ✅ Proper cleanup and memory management
- ✅ Comprehensive error boundaries and retry logic

## **🔧 Troubleshooting**

### **Common Issues**

#### **1. WebSocket Connection Failed**

```bash
# Check environment variables
echo $NEXT_PUBLIC_WS_HOST

# Verify WebSocket server is running
curl -I http://localhost:3000/api/draft/websocket
```

#### **2. Draft Context Not Available**

```typescript
// Ensure DraftProvider wraps the component
<DraftProvider draftId={draftId} userId={userId}>
  <YourComponent />
</DraftProvider>
```

#### **3. Performance Issues**

```typescript
// Enable performance monitoring
const { measureRender, trackError } = useDraftPerformance({
  enableMonitoring: true,
  logMetrics: true,
});

// Use in components
useEffect(() => {
  const cleanup = measureRender();
  return cleanup;
}, [measureRender]);
```

### **Debug Mode**

```typescript
// Enable debug logging
const { connection, realtime } = useRealtimeConnection(draftId, userId, {
  enableLogging: true,
  logLevel: 'debug',
});
```

## **🚀 Post-Migration Optimization**

### **1. Enable Caching**

```typescript
const { draftService } = useDraftService(draftId, {
  enableCaching: true,
  cacheTimeout: 30000, // 30 seconds
});
```

### **2. Performance Monitoring**

```typescript
const { measureRender, getMetrics } = useDraftPerformance({
  enableMonitoring: true,
  logMetrics: process.env.NODE_ENV === 'development',
});
```

### **3. Error Tracking**

```typescript
const { trackError } = useDraftPerformance();

// Use in error handlers
try {
  await makePick(playerId);
} catch (error) {
  trackError(error, 'makePick');
}
```

## **📈 Monitoring & Analytics**

### **Performance Metrics**

- Render time (target: <16ms for 60fps)
- Memory usage (target: <50MB)
- Network latency (target: <100ms)
- Error rate (target: <5%)

### **Real-time Metrics**

- Active connections per draft
- Message throughput
- Reconnection frequency
- User engagement

## **🎯 Next Steps**

After successful migration:

1. **Remove Legacy Code**: Delete old draft components and hooks
2. **Update Documentation**: Update API docs and component documentation
3. **Performance Tuning**: Optimize based on monitoring data
4. **Feature Development**: Add new features using the unified system
5. **Production Deployment**: Deploy to production with monitoring enabled

## **📞 Support**

For migration support:

1. Check this guide first
2. Review the troubleshooting section
3. Check GitHub issues for known problems
4. Create a new issue with detailed error information

---

**Migration Status**: ✅ **COMPLETED**  
**Last Updated**: December 2024  
**Version**: 2.0.0
