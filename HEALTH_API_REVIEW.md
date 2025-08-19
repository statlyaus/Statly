# Health API Review

## 📋 **API Overview**

**Endpoint**: `/api/health`  
**Methods**: `GET` (health check), `HEAD` (liveness probe)  
**Purpose**: Monitor application health and system status

## 🔍 **Current Implementation Analysis**

### **✅ Strengths**

#### 1. **Comprehensive Health Checks**
```typescript
// Database connectivity test
async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await adminDb.collection('_health').limit(1).get();
    return { status: 'healthy', responseTime: Date.now() - start, ... };
  } catch (error) {
    return { status: 'unhealthy', error: error.message, ... };
  }
}

// Memory usage monitoring  
function checkMemory(): ServiceStatus {
  const memUsage = process.memoryUsage();
  const memoryUsagePercent = (usedMemoryMB / totalMemoryMB) * 100;
  return {
    status: memoryUsagePercent < 90 ? 'healthy' : 'unhealthy',
    error: memoryUsagePercent >= 90 ? `High memory usage: ${memoryUsagePercent.toFixed(1)}%` : undefined,
  };
}
```

#### 2. **Proper HTTP Status Codes**
- ✅ **200** - All services healthy
- ✅ **503** - Service unavailable (degraded/unhealthy)

#### 3. **Request Tracing Integration**
```typescript
const tracer = withRequestTracing(req, { endpoint: 'health' });
// ... processing ...
tracer.complete(httpStatus, { healthStatus: status, servicesChecked: Object.keys(services).length });
```

#### 4. **Structured Response Format**
```typescript
interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: { database: ServiceStatus; memory: ServiceStatus; };
}
```

#### 5. **Liveness Probe Support**
```typescript
// HEAD endpoint for Kubernetes liveness probes
export async function HEAD(req: NextRequest) {
  // Simple 200 response for basic availability check
}
```

### **⚠️ Areas for Improvement**

#### 1. **Limited Service Coverage**
```typescript
// CURRENT: Only 2 services checked
const services = { database, memory };

// SUGGESTED: Add more critical services
const services = {
  database, 
  memory,
  redis,      // Cache layer
  auth,       // Authentication service
  external,   // External API dependencies
};
```

#### 2. **Missing Metrics Collection**
```typescript
// CURRENT: Metrics interface defined but not implemented
interface HealthCheck {
  metrics?: {
    totalRequests?: number;
    activeConnections?: number;
    averageResponseTime?: number;
  };
}

// SUGGESTED: Implement actual metrics
const metrics = {
  totalRequests: await getRequestCount(),
  activeConnections: getActiveConnections(),
  averageResponseTime: getAvgResponseTime(),
};
```

#### 3. **Database Health Check Too Simple**
```typescript
// CURRENT: Only tests connection
await adminDb.collection('_health').limit(1).get();

// SUGGESTED: More comprehensive checks
const dbChecks = await Promise.all([
  testConnection(),
  testWriteOperation(), 
  testReadLatency(),
  checkIndexHealth()
]);
```

#### 4. **No Circuit Breaker Pattern**
```typescript
// SUGGESTED: Add circuit breaker for external dependencies
class CircuitBreaker {
  private failures = 0;
  private lastFailTime = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000; // 1 minute

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error('Circuit breaker is open');
    }
    // ... implementation
  }
}
```

#### 5. **Missing Rate Limiting**
```typescript
// Health endpoint could be abused for DoS
// SUGGESTED: Add rate limiting
import rateLimit from 'express-rate-limit';

const healthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
```

## 🚨 **Security Considerations**

### **Information Disclosure Risks**

#### 1. **Version Exposure**
```typescript
// CURRENT: Exposes version information
version: process.env.npm_package_version || '1.0.0'

// RISK: Attackers can identify known vulnerabilities
// MITIGATION: Consider removing or obfuscating in production
```

#### 2. **Error Message Leakage**
```typescript
// CURRENT: Full error messages exposed
error: error instanceof Error ? error.message : String(error)

// RISK: Database errors might reveal internal structure
// SUGGESTED: Sanitize error messages in production
error: process.env.NODE_ENV === 'production' 
  ? 'Database connectivity issue' 
  : error.message
```

#### 3. **Memory Usage Details**
```typescript
// CURRENT: Detailed memory information
error: `High memory usage: ${memoryUsagePercent.toFixed(1)}%`

// RISK: Could help in memory-based attacks
// MITIGATION: Generic message in production
```

## 🛠️ **Recommended Enhancements**

### **1. Add Redis Health Check**
```typescript
async function checkRedis(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    if (!redisClient.isReady) {
      return { status: 'unhealthy', error: 'Redis not connected' };
    }
    
    await redisClient.ping();
    const responseTime = Date.now() - start;
    
    return {
      status: responseTime < 100 ? 'healthy' : 'degraded',
      responseTime,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: error instanceof Error ? error.message : 'Redis error',
      lastChecked: new Date().toISOString(),
    };
  }
}
```

### **2. Add External Dependencies Check**
```typescript
async function checkExternalServices(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    // Check critical external APIs
    const checks = await Promise.allSettled([
      fetch('https://api.afl.com.au/health', { timeout: 5000 }),
      // Add other external dependencies
    ]);
    
    const failures = checks.filter(result => result.status === 'rejected');
    
    return {
      status: failures.length === 0 ? 'healthy' : 'degraded',
      responseTime: Date.now() - start,
      error: failures.length > 0 ? `${failures.length} external services failing` : undefined,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: 'External services check failed',
      lastChecked: new Date().toISOString(),
    };
  }
}
```

### **3. Implement Readiness Probe**
```typescript
// Add readiness endpoint for Kubernetes
export async function PATCH(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'health-readiness' });
  
  try {
    // More comprehensive checks for readiness
    const [database, redis, auth] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkAuthService(),
    ]);
    
    const isReady = [database, redis, auth].every(
      service => service.status === 'healthy'
    );
    
    const status = isReady ? 200 : 503;
    tracer.complete(status);
    
    return new NextResponse(JSON.stringify({ ready: isReady }), {
      status,
      headers: { 'Content-Type': 'application/json', ...tracer.getTraceHeaders() },
    });
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return new NextResponse(JSON.stringify({ ready: false }), { status: 500 });
  }
}
```

### **4. Add Metrics Collection**
```typescript
interface HealthMetrics {
  totalRequests: number;
  errorRate: number;
  averageResponseTime: number;
  activeConnections: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  databaseConnections: {
    active: number;
    idle: number;
  };
}

async function collectMetrics(): Promise<HealthMetrics> {
  return {
    totalRequests: await redis.get('metrics:total_requests') || 0,
    errorRate: await calculateErrorRate(),
    averageResponseTime: await calculateAvgResponseTime(),
    activeConnections: getActiveConnections(),
    memoryUsage: process.memoryUsage(),
    databaseConnections: await getDatabaseConnectionStats(),
  };
}
```

## 📊 **Monitoring Integration**

### **Suggested Monitoring Setup**

#### 1. **Kubernetes Health Checks**
```yaml
# deployment.yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

#### 2. **Prometheus Metrics Export**
```typescript
// Add Prometheus metrics endpoint
export async function OPTIONS(req: NextRequest) {
  const metrics = await collectMetrics();
  
  const prometheusFormat = `
# HELP nodejs_heap_size_used_bytes Process heap space used
# TYPE nodejs_heap_size_used_bytes gauge
nodejs_heap_size_used_bytes ${metrics.memoryUsage.heapUsed}

# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total ${metrics.totalRequests}
  `.trim();
  
  return new NextResponse(prometheusFormat, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
```

## 🧪 **Testing Recommendations**

### **Unit Tests Needed**
```typescript
describe('Health API', () => {
  it('should return 200 when all services are healthy', async () => {
    // Mock healthy services
    // Test response format
  });
  
  it('should return 503 when any service is unhealthy', async () => {
    // Mock unhealthy database
    // Verify proper error response
  });
  
  it('should include proper trace headers', async () => {
    // Test request tracing integration
  });
});
```

### **Integration Tests**
```typescript
describe('Health API Integration', () => {
  it('should actually connect to database', async () => {
    // Real database connectivity test
  });
  
  it('should handle database timeouts gracefully', async () => {
    // Test timeout scenarios
  });
});
```

## 🏆 **Overall Assessment**

### **Current State: 7/10**

#### **Pros:**
- ✅ Solid foundation with proper HTTP codes
- ✅ Good request tracing integration
- ✅ Structured response format
- ✅ Both liveness and basic health checks
- ✅ Error handling and logging

#### **Improvement Areas:**
- ❌ Limited service coverage (only database + memory)
- ❌ No metrics collection implemented
- ❌ Missing external dependency checks
- ❌ No rate limiting or security hardening
- ❌ Database health check too basic
- ❌ No tests present

### **Priority Fixes:**
1. **High**: Add Redis health check
2. **High**: Implement metrics collection
3. **Medium**: Add external service checks
4. **Medium**: Enhance database health check
5. **Low**: Add rate limiting
6. **Low**: Security hardening for production

The health API provides a good foundation but needs enhancement for production-grade monitoring and observability.
