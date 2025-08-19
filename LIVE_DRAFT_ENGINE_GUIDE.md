# Live Draft Engine - Implementation Guide

## Overview

The Live Draft Engine is a comprehensive, scalable service designed to handle thousands of concurrent fantasy drafts with real-time updates, WebSocket communication, timer management, and enterprise-grade features.

## Key Features

✅ **Concurrent Draft Management**: Handle 1000s of simultaneous drafts
✅ **Real-time WebSocket Updates**: Instant draft state synchronization  
✅ **Persistent Timers**: Redis-backed timer persistence with pause/resume
✅ **Auto-pick System**: Queue-based automatic pick selection
✅ **Snake & Linear Drafts**: Support for both draft types
✅ **Horizontal Scaling**: Redis-based state management for multiple servers
✅ **Comprehensive API**: RESTful endpoints for all draft operations
✅ **Error Handling**: Robust error recovery and user guidance
✅ **Memory Efficient**: Automatic cleanup and archival of completed drafts
✅ **Monitoring & Metrics**: Built-in performance tracking and health checks

## Architecture Components

### Core Services

1. **LiveDraftEngine** (`/src/services/liveDraftEngine.ts`)
   - Central draft state management
   - Timer coordination and auto-pick logic
   - Snake/linear draft algorithms
   - Redis persistence layer

2. **LiveDraftWebSocketManager** (`/src/services/liveDraftWebSocketManager.ts`)
   - Socket.IO integration for real-time updates
   - Connection management and rate limiting
   - Event broadcasting and room management

3. **LiveDraftIntegration** (`/src/services/liveDraftIntegration.ts`)
   - Integration layer with existing systems
   - Event forwarding and health monitoring
   - Migration utilities for existing drafts

### API Endpoints

- `POST /api/drafts` - Create new draft (implement in existing route)
- `GET /api/drafts/[draftId]` - Get draft state
- `POST /api/drafts/[draftId]/start` - Start draft
- `POST /api/drafts/[draftId]/pick` - Make pick
- `POST /api/drafts/[draftId]/pause` - Pause draft
- `POST /api/drafts/[draftId]/resume` - Resume draft
- `PUT /api/drafts/[draftId]/queue` - Update pick queue
- `PUT /api/drafts/[draftId]/participants` - Update participant status

### Data Structure

```typescript
interface LiveDraftState {
  leagueId: string;
  draftId: string;
  status: 'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  currentPick: {
    userId: string;
    memberId: string;
    pickNumber: number;
    round: number;
    slot: number;
    expiresAt: Date;
    startedAt: Date;
  };
  picks: Array<{
    playerId: string;
    userId: string;
    memberId: string;
    pickNumber: number;
    round: number;
    slot: number;
    auto: boolean;
    timestamp: Date;
  }>;
  participants: Array<{
    userId: string;
    memberId: string;
    displayName: string;
    draftOrder: number;
    isOnline: boolean;
    queue: string[];
    autoPickEnabled: boolean;
    lastActivity: Date;
  }>;
  timerSettings: {
    durationSeconds: number;
    autopickAfterExpiry: boolean;
    pausedAt?: Date;
    pausedTimeRemaining?: number;
  };
  draftSettings: {
    totalRounds: number;
    totalTeams: number;
    draftType: 'SNAKE' | 'LINEAR';
    pickTimeLimit: number;
  };
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date;
}
```

## Setup Instructions

### 1. Environment Configuration

Add to your `.env.local`:

```bash
# Redis Configuration (for draft state persistence)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password_if_needed

# Draft Engine Configuration
DRAFT_ENGINE_CLEANUP_INTERVAL=1800000  # 30 minutes
DRAFT_ENGINE_MAX_CONCURRENT=2000       # Maximum concurrent drafts
DRAFT_ENGINE_MEMORY_LIMIT=1024         # Memory limit in MB
```

### 2. Install Dependencies

```bash
npm install ioredis zod
```

### 3. Socket.IO Server Integration

Update your `socketio-server.ts` to integrate the Live Draft Engine:

```typescript
import { liveDraftIntegration } from '@/services/liveDraftIntegration';

// After creating your Socket.IO server
const io = new Server(server, { /* your config */ });

// Initialize the live draft integration
liveDraftIntegration.initialize();
```

### 4. Database Schema Updates

The Live Draft Engine works with your existing database but adds Redis for real-time state. Ensure your draft tables support the following states:

```sql
-- Update your draft status enum to include new states
ALTER TYPE draft_status ADD VALUE IF NOT EXISTS 'LIVE';
ALTER TYPE draft_status ADD VALUE IF NOT EXISTS 'PAUSED';
```

### 5. React Client Integration

Create a hook to connect to the Live Draft Engine:

```typescript
// src/hooks/useLiveDraft.ts
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export function useLiveDraft(draftId: string, userId: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [draftState, setDraftState] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('/draft', {
      auth: { userId, draftId },
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));
    newSocket.on('draft:state', setDraftState);

    setSocket(newSocket);

    return () => newSocket.close();
  }, [draftId, userId]);

  const makePick = (playerId: string) => {
    socket?.emit('draft:make-pick', { playerId });
  };

  const updateQueue = (queue: string[]) => {
    socket?.emit('draft:update-queue', { queue });
  };

  return {
    draftState,
    connected,
    makePick,
    updateQueue,
  };
}
```

## Performance Characteristics

### Scalability Targets
- **Concurrent Drafts**: 2,000+ simultaneous active drafts
- **WebSocket Connections**: 10,000+ concurrent connections  
- **Pick Throughput**: 100+ picks per second
- **Memory Usage**: <1GB for 1,000 active drafts
- **Response Time**: <100ms for draft operations

### Memory Management
- Automatic cleanup of completed drafts after 24 hours
- Redis archival for completed drafts (7-day retention)
- Efficient timer management with shared intervals
- Connection pooling and rate limiting

### Monitoring
- Built-in metrics collection every 5 minutes
- Health checks every 30 seconds
- Automatic alerts for high memory/connection usage
- Performance dashboards via `/api/drafts?metrics=true`

## Integration with Existing System

### Migration Strategy
1. **Gradual Rollout**: Start with new drafts only
2. **Feature Flagging**: Use flags to control which drafts use Live Engine
3. **Parallel Running**: Run both systems temporarily for comparison
4. **Data Validation**: Ensure state consistency between systems

### Existing Draft Migration
Use the migration utility to convert existing drafts:

```typescript
import { liveDraftIntegration } from '@/services/liveDraftIntegration';

await liveDraftIntegration.migrateDraftToLiveEngine({
  draftId: 'existing-draft-id',
  leagueId: 'league-id',
  currentState: existingDraftData,
  participants: participantList,
});
```

## Testing Strategy

### Unit Tests
- Timer accuracy and pause/resume functionality
- Snake draft pick order calculations
- Auto-pick queue processing
- Error handling and recovery

### Load Tests
- 1000+ concurrent draft simulation
- WebSocket connection stress testing
- Memory leak detection under load
- Redis persistence performance

### Integration Tests
- End-to-end draft flow testing
- Real-time synchronization validation
- Failure recovery scenarios
- Cross-browser WebSocket compatibility

## Deployment Considerations

### Infrastructure Requirements
- **Redis**: Clustered setup for high availability
- **Load Balancer**: WebSocket sticky sessions required
- **Monitoring**: Application Performance Monitoring (APM)
- **Scaling**: Horizontal scaling with Redis state sharing

### Security
- Authentication on WebSocket connections
- Rate limiting per connection and user
- Input validation on all API endpoints
- CORS configuration for WebSocket origins

### Backup & Recovery
- Redis data persistence enabled
- Draft state backup to primary database every hour
- Disaster recovery procedures for Redis cluster
- Automated failover for critical draft periods

## Production Readiness Checklist

- [ ] Redis cluster configured and tested
- [ ] Load balancer configured for WebSocket sticky sessions
- [ ] Monitoring and alerting configured
- [ ] Rate limiting and DDoS protection enabled
- [ ] Security review completed
- [ ] Load testing passed with target metrics
- [ ] Backup and recovery procedures tested
- [ ] Documentation and runbooks completed
- [ ] Team training on new system completed
- [ ] Rollback plan prepared and tested

## Support and Maintenance

### Monitoring Dashboard
Access real-time metrics at `/api/drafts?metrics=true` including:
- Active draft count
- Memory usage
- WebSocket connections
- Pick throughput
- Error rates

### Common Operations
```bash
# View engine metrics
curl http://localhost:3000/api/drafts?metrics=true

# Pause all drafts (emergency)
curl -X POST http://localhost:3000/api/admin/drafts/pause-all

# Force disconnect draft room
curl -X POST http://localhost:3000/api/admin/drafts/{draftId}/disconnect
```

### Troubleshooting
- **High Memory**: Check for draft cleanup, increase cleanup frequency
- **Slow Picks**: Verify Redis connectivity and timer performance  
- **Connection Issues**: Check load balancer WebSocket configuration
- **State Sync Issues**: Verify Firestore and Redis consistency

This Live Draft Engine provides enterprise-scale draft management with the flexibility to handle your current needs while scaling to support thousands of concurrent users. The modular architecture allows for gradual integration and testing while maintaining system reliability.
