# API Health Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local API health accurately report operational-but-degraded conditions without masking production-critical failures.

**Architecture:** Keep `/api/health` as a diagnostic endpoint and `PATCH /api/health` as readiness, but classify local optional Redis and development heap pressure as degraded instead of hard unhealthy. Production remains strict: missing Redis and high memory still fail readiness. The implementation is small and local to the health route with focused regression tests.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Vitest, Firebase Admin mocks, Redis client mock, existing request tracing utilities.

---

## Current Evidence

Observed against the running local app on `http://localhost:3000`:

- `GET /api/env-check` returned `200 OK`.
- `GET /api/leagues/user/test-user` returned `200 OK`.
- `GET /api/players?limit=2` timed out once, then returned `200 OK` on retry.
- `GET /api/players/search?q=saad` returned `200 OK`.
- `GET /api/health` returned `503 Service Unavailable` with:
  - database healthy
  - player read models healthy
  - memory unhealthy due heap percentage around 92.9%
  - Redis degraded/unhealthy

The clean branch no longer has the dirty worktree’s `/api/players` on-demand materialization path, so this plan does not add speculative player-route changes. It fixes the health classification issue that made an otherwise reachable local API look hard down.

## File Structure

- Modify `src/app/api/health/route.ts`
  - Add environment-aware helpers.
  - Add explicit memory details.
  - Downgrade local optional Redis failures to degraded.
  - Keep production Redis and production high memory strict.
- Modify `src/app/api/health/route.test.ts`
  - Add RED tests for local memory pressure and optional Redis behavior.
  - Add strict production Redis regression test.

---

### Task 1: Local High Memory Is Degraded, Not Unhealthy

**Files:**

- Modify: `src/app/api/health/route.test.ts`
- Modify: `src/app/api/health/route.ts`
- Test: `src/app/api/health/route.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe('GET /api/health', () => { ... })` after `should return proper status codes based on service health`:

```ts
it('reports development heap pressure as degraded without failing the API health endpoint', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: 850 * 1024 * 1024,
    heapTotal: 100 * 1024 * 1024,
    heapUsed: 93 * 1024 * 1024,
    external: 5 * 1024 * 1024,
    arrayBuffers: 1 * 1024 * 1024,
  });

  const response = await GET(mockRequest);
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.data.status).toBe('degraded');
  expect(data.data.services.memory.status).toBe('degraded');
  expect(data.data.services.memory.error).toContain('Development heap pressure');
  expect(data.data.services.memory.details.heapUsagePercent).toBe(93);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/app/api/health/route.test.ts
```

Expected: the new test fails because current `checkMemory()` returns `unhealthy` and `GET` returns `503`.

- [ ] **Step 3: Implement the minimal production code**

In `src/app/api/health/route.ts`, replace `checkMemory()` with:

```ts
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

function checkMemory(): ServiceStatus {
  const memUsage = process.memoryUsage();
  const heapTotalMb = memUsage.heapTotal / 1024 / 1024;
  const heapUsedMb = memUsage.heapUsed / 1024 / 1024;
  const rssMb = memUsage.rss / 1024 / 1024;
  const heapUsagePercent = heapTotalMb > 0 ? (heapUsedMb / heapTotalMb) * 100 : 0;

  let status: ServiceStatus['status'];
  let error: string | undefined;

  if (heapUsagePercent >= 90) {
    if (isProductionRuntime()) {
      status = 'unhealthy';
      error = 'High memory usage detected';
    } else {
      status = 'degraded';
      error = `Development heap pressure: ${heapUsagePercent.toFixed(1)}%`;
    }
  } else if (heapUsagePercent >= 75) {
    status = 'degraded';
    error = isProductionRuntime()
      ? 'Elevated memory usage'
      : `Elevated memory usage: ${heapUsagePercent.toFixed(1)}%`;
  } else {
    status = 'healthy';
  }

  return {
    status,
    lastChecked: new Date().toISOString(),
    error,
    details: {
      heapUsagePercent: Math.round(heapUsagePercent * 10) / 10,
      heapUsedMb: Math.round(heapUsedMb),
      heapTotalMb: Math.round(heapTotalMb),
      rssMb: Math.round(rssMb),
    },
  };
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run src/app/api/health/route.test.ts
```

Expected: all health route tests pass.

---

### Task 2: Optional Local Redis Is Degraded, Production Redis Is Strict

**Files:**

- Modify: `src/app/api/health/route.test.ts`
- Modify: `src/app/api/health/route.ts`
- Test: `src/app/api/health/route.test.ts`

- [ ] **Step 1: Write failing GET and PATCH tests for local optional Redis**

Add these tests in `src/app/api/health/route.test.ts`.

Inside `describe('GET /api/health', () => { ... })`, add:

```ts
it('reports missing local Redis as degraded instead of unhealthy when Redis is optional', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('REDIS_URL', '');
  const { redisClient } = await import('@/lib/redis');
  vi.mocked(redisClient.isConnected).mockReturnValue(false);

  const response = await GET(mockRequest);
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.data.status).toBe('degraded');
  expect(data.data.services.redis.status).toBe('degraded');
  expect(data.data.services.redis.details.optional).toBe(true);
});
```

Inside `describe('PATCH /api/health', () => { ... })`, replace the existing Redis-not-ready test with two tests:

```ts
it('stays ready when local Redis is optional and unavailable', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('REDIS_URL', '');
  const { redisClient } = await import('@/lib/redis');
  vi.mocked(redisClient.isConnected).mockReturnValue(false);

  const response = await PATCH(mockRequest);
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.ready).toBe(true);
  expect(data.services.redis).toBe('degraded');
});

it('returns 503 when production Redis is not ready', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('REDIS_URL', 'redis://example.invalid:6379');
  const { redisClient } = await import('@/lib/redis');
  vi.mocked(redisClient.isConnected).mockReturnValue(false);

  const response = await PATCH(mockRequest);
  const data = await response.json();

  expect(response.status).toBe(503);
  expect(data.ready).toBe(false);
  expect(data.services.redis).toBe('unhealthy');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/app/api/health/route.test.ts
```

Expected: the new local Redis tests fail because `checkRedis()` currently returns `unhealthy` and `PATCH` requires Redis healthy.

- [ ] **Step 3: Implement optional Redis classification**

In `src/app/api/health/route.ts`, add this helper after `const startTime = Date.now();`:

```ts
function isLocalOptionalRedis(): boolean {
  if (process.env.HEALTH_REDIS_REQUIRED === 'true') {
    return false;
  }
  if (process.env.HEALTH_REDIS_OPTIONAL === 'true') {
    return true;
  }
  return !isProductionRuntime() && !process.env.REDIS_URL;
}
```

Then replace the disconnected branch in `checkRedis()`:

```ts
if (!redisClient.isConnected()) {
  return {
    status: 'unhealthy',
    responseTime: Date.now() - start,
    error: 'Redis not connected',
    lastChecked: new Date().toISOString(),
  };
}
```

with:

```ts
if (!redisClient.isConnected()) {
  const optional = isLocalOptionalRedis();
  return {
    status: optional ? 'degraded' : 'unhealthy',
    responseTime: Date.now() - start,
    error: optional ? 'Redis not connected; using local fallback paths' : 'Redis not connected',
    details: { optional },
    lastChecked: new Date().toISOString(),
  };
}
```

Replace the `catch` return in `checkRedis()` with:

```ts
const optional = isLocalOptionalRedis();
return {
  status: optional ? 'degraded' : 'unhealthy',
  responseTime: Date.now() - start,
  error: optional
    ? error instanceof Error
      ? `Redis optional fallback active: ${error.message}`
      : 'Redis optional fallback active'
    : process.env.NODE_ENV === 'production'
      ? 'Cache service error'
      : error instanceof Error
        ? error.message
        : 'Redis error',
  details: { optional },
  lastChecked: new Date().toISOString(),
};
```

In `PATCH`, replace:

```ts
const criticalServices = [database, redis, metricsCheck];
const isReady = criticalServices.every((service) => service.status === 'healthy');
```

with:

```ts
const redisReady =
  redis.status === 'healthy' || (redis.status === 'degraded' && redis.details?.optional === true);
const isReady = database.status === 'healthy' && metricsCheck.status === 'healthy' && redisReady;
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run src/app/api/health/route.test.ts
```

Expected: all health route tests pass.

---

### Task 3: Make Health Aggregation Critical-Aware

**Files:**

- Modify: `src/app/api/health/route.test.ts`
- Modify: `src/app/api/health/route.ts`
- Test: `src/app/api/health/route.test.ts`

- [ ] **Step 1: Write a failing test for non-critical unhealthy diagnostics**

Add this test in `describe('GET /api/health', () => { ... })`:

```ts
it('keeps GET /api/health at 200 when only non-critical diagnostics are unhealthy', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  const { redisClient } = await import('@/lib/redis');
  vi.mocked(redisClient.isConnected).mockReturnValue(false);
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: 900 * 1024 * 1024,
    heapTotal: 100 * 1024 * 1024,
    heapUsed: 95 * 1024 * 1024,
    external: 5 * 1024 * 1024,
    arrayBuffers: 1 * 1024 * 1024,
  });

  const response = await GET(mockRequest);
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.data.status).toBe('degraded');
  expect(data.data.services.memory.status).toBe('degraded');
  expect(data.data.services.redis.status).toBe('degraded');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/app/api/health/route.test.ts
```

Expected: if Task 1 and Task 2 already made both services degraded, this may already pass. If it passes immediately, record that the behavior was covered by the prior two red/green cycles and continue.

- [ ] **Step 3: Extract status aggregation for clarity**

In `src/app/api/health/route.ts`, add this helper before `export async function GET`:

```ts
function deriveOverallStatus(services: Record<string, ServiceStatus>): HealthCheck['status'] {
  const serviceStatuses = Object.values(services);
  if (serviceStatuses.some((service) => service.status === 'unhealthy')) {
    return 'unhealthy';
  }
  if (serviceStatuses.some((service) => service.status === 'degraded')) {
    return 'degraded';
  }
  return 'healthy';
}
```

Then replace the inline `serviceStatuses`, `hasUnhealthyService`, `hasDegradedService`, and `status` block in `GET` with:

```ts
const status = deriveOverallStatus(services);
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run src/app/api/health/route.test.ts
```

Expected: all health route tests pass.

---

### Task 4: Verify API Health and Players Behavior

**Files:**

- Test-only verification

- [ ] **Step 1: Run focused route tests**

Run:

```bash
npm test -- src/app/api/health/route.test.ts src/app/api/players/route.test.ts
```

Expected:

```text
Test Files  2 passed (2)
Tests  17+ passed
```

- [ ] **Step 2: Run typecheck for touched code**

Run:

```bash
npm run typecheck:app
npm run typecheck:tests
```

Expected: both exit `0`.

- [ ] **Step 3: Run lint and formatting**

Run:

```bash
npm run lint
npx prettier --check --ignore-unknown src/app/api/health/route.ts src/app/api/health/route.test.ts docs/superpowers/plans/2026-05-08-api-health-resilience.md
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 4: Optional browser/API smoke if dev server is available**

If a dev server is running in this worktree or you intentionally start one, run:

```bash
curl -i --max-time 10 http://localhost:3000/api/health
curl -i --max-time 10 'http://localhost:3000/api/players?limit=2'
```

Expected local behavior:

- `/api/health` may return `200` with `status: "degraded"` when only Redis and development memory pressure are degraded.
- `/api/players?limit=2` returns JSON within the timeout.

Do not use the dirty root worktree server to prove this branch unless you have restarted that server from this branch.

---

## Self-Review

Spec coverage:

- API running but `/api/health` 503 due local memory and Redis: Tasks 1 and 2.
- Earlier players timeout likely cold/slow first request: Task 4 verifies players but avoids speculative production changes because clean branch route does not contain the dirty materialization path.
- Best long-term solution: keeps production strict, adds configurable Redis policy, exposes memory details, and tests behavior.

Placeholder scan:

- No `TBD`, `TODO`, “implement later”, or vague “add appropriate handling” language remains.
- Code-changing steps include exact code snippets.

Type consistency:

- `ServiceStatus.details` already supports `boolean`, so `optional: true` is valid.
- `deriveOverallStatus` accepts `Record<string, ServiceStatus>`, matching the `services` object shape.
- `isLocalOptionalRedis()` uses `isProductionRuntime()`, introduced in Task 1 before Task 2 uses it.
