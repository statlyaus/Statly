import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { countRateLimitHit, getTrustedClientIp } from '@/lib/rateLimit';
import crypto from 'node:crypto';
import { Queue } from 'bullmq';
import type { Queue as BullQueue } from 'bullmq';
import { getPublisherClient } from '@/server/realtime/scalableConnection';
import type { Redis as IORedisClient, Cluster as IORedisCluster } from 'ioredis';

// Minimal ioredis-compatible type for BullMQ
type BullRedisConnection = IORedisClient | IORedisCluster;

// Minimal commands needed for distributed de-dup
interface RedisKV {
  set: (key: string, value: string, ...args: unknown[]) => Promise<string | null>;
  eval: (
    script: string,
    numKeys: number,
    ...keysAndArgs: Array<string | number>
  ) => Promise<number>;
}

// Runtime type guard for RedisKV
function isRedisKVClient(client: unknown): client is RedisKV {
  if (typeof client !== 'object' || client === null) return false;
  const c = client as { set?: unknown; eval?: unknown };
  return typeof c.set === 'function' && typeof c.eval === 'function';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;

// Allowed metric names and navigation types
const MetricNameEnum = z.enum(['CLS', 'FID', 'FCP', 'INP', 'LCP', 'TTFB']);
const NavigationTypeEnum = z.enum(['navigate', 'reload', 'back_forward', 'prerender']);

const performanceMetricSchema = z.object({
  name: MetricNameEnum,
  value: z.number().finite(),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  delta: z.number().finite().optional(),
  id: z.string().min(1).max(128),
  navigationType: NavigationTypeEnum.optional(),
  sessionId: z.string().min(1).max(128),
  timestamp: z
    .number()
    .int()
    .refine((ts) => Number.isFinite(ts), { message: 'timestamp must be finite' })
    .refine((ts) => Math.abs(Date.now() - ts) < 1000 * 60 * 60 * 24 * 7, {
      message: 'timestamp too far from current time',
    }),
  url: z.string().url(),
});

// Deduplication manager encapsulating local cache and sweeper lifecycle
class DeduplicationManager {
  private recentIds = new Map<string, number>();
  private ttlMs: number;
  private maxSize: number;
  private sweepMs: number;
  private redisPrefix: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    opts?: Partial<{ ttlMs: number; maxSize: number; sweepMs: number; redisPrefix: string }>
  ) {
    this.ttlMs = opts?.ttlMs ?? Number(process.env.METRICS_DEDUP_TTL_MS || 2 * 60 * 1000);
    this.maxSize = opts?.maxSize ?? Number(process.env.METRICS_DEDUP_MAX_SIZE || '10000');
    this.sweepMs = opts?.sweepMs ?? Number(process.env.METRICS_DEDUP_SWEEP_MS || '30000');
    this.redisPrefix =
      opts?.redisPrefix ?? (process.env.METRICS_DEDUP_REDIS_PREFIX || 'metrics:dedup:');
  }

  startSweeper(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.prune(), this.sweepMs);
    // Do not keep the process alive just for pruning
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.timer as any).unref?.();
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  prune(): void {
    const now = Date.now();
    for (const [k, exp] of this.recentIds) {
      if (exp <= now) this.recentIds.delete(k);
    }
    if (this.recentIds.size > this.maxSize) {
      let toRemove = this.recentIds.size - this.maxSize;
      for (const k of this.recentIds.keys()) {
        if (toRemove-- <= 0) break;
        this.recentIds.delete(k);
      }
    }
  }

  isDuplicateLocal(key: string): boolean {
    const now = Date.now();
    const exp = this.recentIds.get(key);
    if (exp && exp > now) return true;
    this.recentIds.set(key, now + this.ttlMs);
    if (this.recentIds.size > this.maxSize) this.prune();
    return false;
  }

  markLocal(key: string): void {
    const now = Date.now();
    this.recentIds.set(key, now + this.ttlMs);
  }

  releaseLocal(key: string): void {
    this.recentIds.delete(key);
  }

  getRedisKey(key: string): string {
    return `${this.redisPrefix}${key}`;
  }

  getTTLms(): number {
    return this.ttlMs;
  }
}

// Singleton and optional factory (kept internal to satisfy Next.js Route export rules)
const dedupManager = new DeduplicationManager();

dedupManager.startSweeper();

function _createDeduplicationManager(
  opts?: Partial<{ ttlMs: number; maxSize: number; sweepMs: number; redisPrefix: string }>
) {
  return new DeduplicationManager(opts);
}

// Cross-instance de-dup using Redis SET NX PX. Falls back to local cache on Redis issues.
type DuplicateClaim = { duplicate: true; token: null } | { duplicate: false; token: string | null };

const RELEASE_DUPLICATE_CLAIM_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

async function claimDuplicateKey(key: string): Promise<DuplicateClaim> {
  // Fast-path: local cache hit
  if (dedupManager.isDuplicateLocal(key)) return { duplicate: true, token: null };

  try {
    const rawClient = getPublisherClient();
    if (!isRedisKVClient(rawClient)) {
      // No compatible Redis client; rely on local only
      logger.warn('Distributed de-dup Redis client missing SET; using local-only de-dup');
      return { duplicate: false, token: null };
    }

    const token = crypto.randomUUID();
    const resp = await rawClient.set(
      dedupManager.getRedisKey(key),
      token,
      'PX',
      dedupManager.getTTLms(),
      'NX'
    );
    if (resp === null) {
      // Already exists globally; mark local to avoid repeated remote checks during TTL
      dedupManager.markLocal(key);
      return { duplicate: true, token: null };
    }

    // Newly recorded globally; ensure local cache contains it too
    dedupManager.markLocal(key);
    return { duplicate: false, token };
  } catch (e) {
    logger.warn('Distributed de-dup unavailable; falling back to local', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { duplicate: false, token: null };
  }
}

async function releaseDuplicateClaim(key: string, token: string | null): Promise<void> {
  dedupManager.releaseLocal(key);
  if (!token) return;

  try {
    const rawClient = getPublisherClient();
    if (!isRedisKVClient(rawClient)) return;
    await rawClient.eval(RELEASE_DUPLICATE_CLAIM_SCRIPT, 1, dedupManager.getRedisKey(key), token);
  } catch (error) {
    logger.warn('Failed to release performance metric de-duplication claim', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Lazy singletons for Redis-backed features
let metricsQueue: BullQueue | undefined;
function getMetricsQueue(): BullQueue {
  if (!metricsQueue) {
    metricsQueue = new Queue('web-vitals', {
      // Use the shared publisher client from our Redis manager
      connection: getPublisherClient() as unknown as BullRedisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    });
  }
  return metricsQueue;
}

function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`; // strip query/hash
  } catch {
    return 'invalid-url';
  }
}

function createMetricsJobId(dedupKey: string): string {
  return crypto.createHash('sha256').update(dedupKey).digest('hex');
}

function noStore(json: unknown, init?: ResponseInit) {
  return NextResponse.json(json, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

function getRequestOrigin(req: NextRequest): string | undefined {
  const o = req.headers.get('origin') ?? req.headers.get('referer');
  if (!o) return undefined;
  try {
    return new URL(o).origin;
  } catch {
    return undefined;
  }
}

function isOriginAllowed(req: NextRequest): boolean {
  const declared = process.env.METRICS_ALLOWED_ORIGINS || process.env.NEXT_PUBLIC_APP_ORIGIN || '';
  if (!declared) return true; // nothing configured -> allow
  const allowed = declared
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const incoming = getRequestOrigin(req);
  if (!incoming) return false;
  return allowed.includes(incoming);
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return noStore({ success: false, error: 'Unsupported Media Type' }, { status: 415 });
  }

  if (!isOriginAllowed(request)) {
    return noStore({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = performanceMetricSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn('Invalid performance metric payload', { issues: parsed.error.issues });
    return noStore(
      { success: false, error: 'Invalid metric data', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const metric = parsed.data;

  // Compute hashed session id for logs (privacy-friendly)
  const sessionIdHash = crypto
    .createHash('sha256')
    .update(metric.sessionId)
    .digest('hex')
    .slice(0, 12);

  // Rate limit per trusted client IP (UA when no trusted IP): 60 per minute on the shared Redis
  // counter, counted in this process while Redis is unavailable. Not per sessionId: the client
  // writes that, so a fresh one would buy a fresh budget.
  const ua = request.headers.get('user-agent') ?? 'unknown';
  const identifier = getTrustedClientIp(request.headers) ?? ua;
  const idHash = crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 16);
  const { count } = await countRateLimitHit({
    key: `rate-limit:web-vitals:${idHash}`,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    whenRedisUnavailable: 'memory',
  });
  if (count > RATE_LIMIT_MAX_REQUESTS) {
    return noStore({ success: false, error: 'Too Many Requests' }, { status: 429 });
  }

  // De-dup by (sessionId, id)
  const dedupKey = `${metric.sessionId}:${metric.id}`;
  const duplicateClaim = await claimDuplicateKey(dedupKey);
  if (duplicateClaim.duplicate) {
    logger.info('Duplicate performance metric ignored', {
      metric: metric.name,
      id: metric.id,
      sessionIdHash,
    });
    return noStore({ success: true, message: 'Duplicate metric ignored' }, { status: 202 });
  }

  const sanitizedUrl = cleanUrl(metric.url);

  // Log the performance metric (sanitized)
  logger.info('Performance metric received', {
    metric: metric.name,
    value: metric.value,
    rating: metric.rating,
    navigationType: metric.navigationType,
    url: sanitizedUrl,
    sessionIdHash,
    userAgent: ua,
    timestamp: new Date(metric.timestamp).toISOString(),
  });

  try {
    // BullMQ reserves colons in custom job IDs, so hash the semantic de-duplication key.
    await getMetricsQueue().add(
      'metric',
      {
        ...metric,
        url: sanitizedUrl,
        sessionIdHash,
        userAgent: ua,
      },
      {
        jobId: createMetricsJobId(dedupKey),
      }
    );
  } catch (error) {
    await releaseDuplicateClaim(dedupKey, duplicateClaim.token);
    logger.error('Failed to enqueue performance metric', error, {
      metric: metric.name,
      sessionIdHash,
    });
    return noStore(
      { success: false, error: 'Performance metric service unavailable' },
      { status: 503 }
    );
  }

  return noStore({ success: true, message: 'Performance metric recorded' });
}

// Optional: GET endpoint to retrieve performance metrics summary
export async function GET(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return noStore({ success: false, error: 'Not Found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const timeRange = searchParams.get('timeRange') || '1h';

    const mockMetrics = {
      sessionId,
      timeRange,
      metrics: {
        CLS: { value: 0.1, rating: 'good' },
        FID: { value: 50, rating: 'good' },
        FCP: { value: 1200, rating: 'good' },
        LCP: { value: 2100, rating: 'good' },
        TTFB: { value: 200, rating: 'good' },
      },
      summary: {
        totalSessions: 150,
        averagePageLoadTime: 1800,
        performanceScore: 85,
      },
    };

    return noStore(mockMetrics);
  } catch (error) {
    logger.error('Failed to retrieve performance metrics', {
      error: error instanceof Error ? error.message : String(error),
    });

    return noStore({ success: false, error: 'Failed to retrieve metrics' }, { status: 500 });
  }
}
