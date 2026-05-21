# Socket.IO Setup Guide for Statly

## Overview

This document provides comprehensive guidance for setting up and maintaining the enhanced Socket.IO infrastructure for Statly's real-time draft functionality.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Next.js App  │    │   Socket.IO      │    │   Database      │
│   (Port 3000)  │◄──►│   Server         │◄──►│   (Prisma)      │
│                 │    │   (Port 3002)    │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client        │    │   Real-time      │    │   Data          │
│   Components    │    │   Events         │    │   Persistence   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Features

- **Real-time Draft Updates**: Live pick notifications, timer updates, and participant status
- **Automatic Reconnection**: Robust connection handling with exponential backoff
- **Room Management**: Isolated draft rooms with participant tracking
- **Health Monitoring**: Built-in health checks and performance monitoring
- **Production Ready**: Comprehensive error handling and graceful shutdown
- **Scalable**: Support for multiple concurrent draft rooms

## Quick Start

### 1. Development Setup

```bash
# Install dependencies
npm install

# Start Next.js development server
npm run dev

# Start Socket.IO server (in separate terminal)
npm run socket

# Or start both together
npm run dev:full
```

### 2. Production Setup

```bash
# Build the application
npm run build

# Build Socket.IO server
npm run worker:build

# Deploy with production script
chmod +x scripts/deploy-production.sh
./scripts/deploy-production.sh
```

## Configuration

### Environment Variables

Create a `.env.local` file with the following variables:

```bash
# Socket.IO Configuration
SOCKET_PORT=3002
NEXT_PUBLIC_SOCKET_URL=http://localhost:3002
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002

# Production Configuration
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
NEXT_PUBLIC_SOCKET_URL=https://yourdomain.com

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/statly"

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com

# Security
JWT_SECRET=your-super-secret-jwt-key
```

### Socket.IO Server Configuration

The server configuration is centralized in `src/lib/socketioConfig.ts`:

```typescript
export const socketIOConfig: SocketIOConfig = {
  server: {
    port: 3002,
    cors: {
      origin: ['http://localhost:3000', 'https://yourdomain.com'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  },
  client: {
    url: 'http://localhost:3002',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
  },
};
```

## Usage

### Client-Side Integration

```typescript
import { socketIOClient } from '@/lib/socketioClient';

// Connect to Socket.IO server
await socketIOClient.connect();

// Join a draft room
socketIOClient.joinDraft('draft-123', 'user-456');

// Set up event handlers
socketIOClient.setDraftRoomHandlers({
  onDraftUpdate: (data) => {
    console.log('Draft updated:', data);
  },
  onParticipantJoin: (data) => {
    console.log('Participant joined:', data);
  },
  onDraftPick: (data) => {
    console.log('Pick made:', data);
  },
});

// Mutations such as picks, pause/resume, and timer starts must use the
// Prisma-backed draft API. Direct socket mutations are rejected by the server.

// Leave draft room
socketIOClient.leaveDraft('draft-123');

// Disconnect
socketIOClient.disconnect();
```

### Server-Side Events

The Socket.IO server handles the following events:

#### Connection Events

- `connect`: Client connected
- `disconnect`: Client disconnected
- `reconnect`: Client reconnected

#### Draft Room Events

- `join:draft`: Join a draft room
- `leave:draft`: Leave a draft room
- `draft:pick`: Rejected mutation; use the Prisma-backed draft API
- `draft:timer:start`: Rejected mutation; draft timers are owned by the server pick-deadline contract
- `draft:pause`: Rejected mutation; use the Prisma-backed draft API
- `draft:resume`: Rejected mutation; use the Prisma-backed draft API

#### Broadcast Events

- `draft:update`: Draft state update
- `participant:join`: Participant joined
- `participant:leave`: Participant left
- `participant:disconnect`: Participant disconnected
- `draft:pick`: Pick made
- `draft:timer`: Timer update
- `draft:timer:expired`: Timer expired
- `draft:paused`: Draft paused
- `draft:resumed`: Draft resumed
- `draft:error`: Draft error

## API Reference

### SocketIOClientManager

#### Methods

##### `connect(): Promise<Socket>`

Establishes connection to Socket.IO server.

##### `disconnect(): void`

Disconnects from server and cleans up resources.

##### `joinDraft(draftId: string, userId?: string, authToken?: string): void`

Joins a draft room.

##### `leaveDraft(draftId: string): void`

Leaves a draft room.

##### `makeDraftPick(draftId: string, playerId: string, userId: string): void`

Legacy client method. The server rejects direct socket picks; use the Prisma-backed draft API so pick state remains authoritative.

##### `startDraftTimer(draftId: string, duration: number): void`

Legacy client method. The server rejects direct socket timer starts; use the Prisma-backed draft API so timer authority remains the server pick-deadline contract.

##### `pauseDraft(draftId: string): void`

Legacy client method. The server rejects direct socket pause calls; use the Prisma-backed draft API.

##### `resumeDraft(draftId: string): void`

Legacy client method. The server rejects direct socket resume calls; use the Prisma-backed draft API.

##### `setEventHandlers(handlers: SocketIOEventHandlers): void`

Sets connection event handlers.

##### `setDraftRoomHandlers(handlers: DraftRoomHandlers): void`

Sets draft room event handlers.

##### `getConnectionStatus(): ConnectionStatus`

Gets current connection status.

#### Properties

##### `socket: Socket | null`

The underlying Socket.IO instance.

## Deployment

### Development

1. **Start Next.js server**: `npm run dev`
2. **Start Socket.IO server**: `npm run socket`
3. **Or start both**: `npm run dev:full`

### Production

1. **Build application**: `npm run build`
2. **Build Socket.IO server**: `npm run worker:build`
3. **Deploy with PM2**: Use the production deployment script

### Docker

```dockerfile
# Dockerfile for Socket.IO server
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 3002

CMD ["node", "dist/server/socketioServer.js"]
```

### Kubernetes

```yaml
# socketio-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: statly-socketio
spec:
  replicas: 2
  selector:
    matchLabels:
      app: statly-socketio
  template:
    metadata:
      labels:
        app: statly-socketio
    spec:
      containers:
        - name: socketio
          image: statly-socketio:latest
          ports:
            - containerPort: 3002
          env:
            - name: NODE_ENV
              value: 'production'
            - name: SOCKET_PORT
              value: '3002'
---
apiVersion: v1
kind: Service
metadata:
  name: statly-socketio-service
spec:
  selector:
    app: statly-socketio
  ports:
    - port: 3002
      targetPort: 3002
  type: ClusterIP
```

## Monitoring & Health Checks

### Health Check Endpoint

The Socket.IO server provides a health check endpoint:

```bash
curl http://localhost:3002/health
```

Response:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "activeConnections": 5,
  "draftRooms": 2,
  "memory": {
    "rss": 123456789,
    "heapTotal": 987654321,
    "heapUsed": 123456789,
    "external": 12345
  }
}
```

### PM2 Monitoring

```bash
# View logs
pm2 logs statly-socketio

# Monitor processes
pm2 monit

# View status
pm2 status

# Restart services
pm2 restart statly-socketio
```

### Logging

The server uses structured logging with different levels:

- **INFO**: Connection events, room management
- **DEBUG**: Detailed event data
- **WARN**: Non-critical issues
- **ERROR**: Critical errors

## Troubleshooting

### Common Issues

#### 1. Connection Refused

**Symptoms**: Client can't connect to Socket.IO server

**Solutions**:

- Check if Socket.IO server is running: `npm run socket`
- Verify port configuration: Check `SOCKET_PORT` environment variable
- Check firewall settings
- Verify CORS configuration

#### 2. WebSocket Upgrade Failed

**Symptoms**: WebSocket connection fails, falls back to polling

**Solutions**:

- Check proxy configuration (Nginx, Apache)
- Verify WebSocket headers are properly forwarded
- Check for SSL/TLS issues in production

#### 3. Memory Leaks

**Symptoms**: Server memory usage increases over time

**Solutions**:

- Check for uncleaned timers and intervals
- Verify proper cleanup in disconnect handlers
- Monitor with PM2: `pm2 monit`

#### 4. High Latency

**Symptoms**: Delayed real-time updates

**Solutions**:

- Check network latency between client and server
- Verify server performance with health checks
- Consider using Redis for horizontal scaling

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
export ENABLE_DEBUG_LOGGING=true

# Or in .env.local
ENABLE_DEBUG_LOGGING=true
```

### Performance Tuning

#### Server Configuration

```typescript
// Optimize for production
export const productionConfig: SocketIOConfig = {
  server: {
    transports: ['websocket', 'polling'], // Allow polling fallback in production
    pingTimeout: 30000, // Shorter timeout
    pingInterval: 15000, // More frequent pings
    maxHttpBufferSize: 1e6, // 1MB buffer
  },
  client: {
    transports: ['websocket', 'polling'], // Allow fallback if WebSocket fails
    reconnectionAttempts: 10, // More reconnection attempts
    timeout: 10000, // Shorter timeout
  },
};
```

#### Horizontal Scaling

For high-traffic scenarios, consider:

1. **Redis Adapter**: Share Socket.IO state across multiple instances
2. **Load Balancer**: Distribute connections across Socket.IO servers
3. **Sticky Sessions**: Ensure WebSocket connections stay on the same server

## Security Considerations

### Authentication

- Implement proper authentication middleware
- Validate user permissions for draft operations
- Use secure tokens (JWT, Firebase Auth)

### Rate Limiting

- Implement rate limiting for Socket.IO events
- Monitor for abuse patterns
- Set reasonable limits for draft operations

### CORS Configuration

- Restrict allowed origins in production
- Use HTTPS in production
- Implement proper CORS headers

### Input Validation

- Validate all incoming Socket.IO events
- Sanitize user inputs
- Implement proper error handling

## Testing

### Unit Tests

```bash
# Run Socket.IO tests
npm test -- --grep "Socket.IO"

# Run specific test file
npm test src/lib/socketioClient.test.ts
```

### Integration Tests

```bash
# Test Socket.IO server
npm run test:integration

# Test with real WebSocket connections
npm run test:websocket
```

### Load Testing

```bash
# Install artillery for load testing
npm install -g artillery

# Run load test
artillery run tests/socketio-load-test.yml
```

## Contributing

### Development Workflow

1. **Create feature branch**: `git checkout -b feature/socketio-enhancement`
2. **Make changes**: Implement new features or fixes
3. **Add tests**: Ensure comprehensive test coverage
4. **Update documentation**: Keep this guide current
5. **Submit PR**: Create pull request with detailed description

### Code Standards

- Follow TypeScript best practices
- Use proper error handling
- Add comprehensive logging
- Include JSDoc comments
- Follow existing code style

## Support

### Getting Help

- **Documentation**: Check this guide first
- **Issues**: Create GitHub issue with detailed description
- **Discussions**: Use GitHub Discussions for questions
- **Community**: Join our Discord/Slack for real-time help

### Reporting Bugs

When reporting bugs, include:

1. **Environment**: OS, Node.js version, npm version
2. **Steps to reproduce**: Detailed reproduction steps
3. **Expected behavior**: What should happen
4. **Actual behavior**: What actually happens
5. **Logs**: Relevant error logs and stack traces
6. **Configuration**: Relevant configuration files

### Feature Requests

For feature requests:

1. **Use case**: Describe the problem you're solving
2. **Proposed solution**: How you'd like it implemented
3. **Alternatives**: Other approaches you've considered
4. **Impact**: How this would benefit users

## Changelog

### v2.0.0 (Current)

- Enhanced Socket.IO server with production-ready features
- Comprehensive client manager with automatic reconnection
- Centralized configuration management
- Health monitoring and graceful shutdown
- Production deployment scripts

### v1.0.0 (Previous)

- Basic Socket.IO integration
- Simple draft room management
- Basic error handling

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
