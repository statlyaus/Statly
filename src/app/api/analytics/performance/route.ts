import crypto from 'node:crypto';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { Queue } from 'bullmq';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { getPublisherClient } from '@/server/realtime/scalableConnection';

import type { Queue as BullQueue } from 'bullmq';
import type { Redis as IORedisClient, Cluster as IORedisCluster } from 'ioredis';

// Minimal ioredis-compatible types for BullMQ and our rate limiter
type BullRedisConnection = IORedisClient | IORedisCluster;
interface RedisEvalCounter {
  eval: (
    script: string,
    numKeys: number,
    ...keysAndArgs: Array<string | number>
  ) => Promise<number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
}

interface RedisIncrExpire {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
}

// Minimal commands needed for distributed de-dup
interface RedisKV {
  set: (key: string, value: string, ...args: unknown[]) => Promise<string | null>;
}

// Runtime type guard for RedisKV
function isRedisKVClient(client: unknown): client is RedisKV {
  if (typeof client !== 'object' || client === null) return false;
  const c = client as { set?: unknown };
  return typeof c.set === 'function';
}

function isRedisIncrExpire(client: unknown): client is RedisIncrExpire {
  if (typeof client !== 'object' || client === null) return false;
  const c = client as { incr?: unknown; expire?: unknown };
  return typeof c.incr === 'function' && typeof c.expire === 'function';
}

function isRedisEvalCounter(client: unknown): client is RedisEvalCounter {
  if (typeof client !== 'object' || client === null) return false;
  const c = client as { eval?: unknown; incr?: unknown; expire?: unknown };
  return (
    typeof c.eval === 'function' && typeof c.incr === 'function' && typeof c.expire === 'function'
  );
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
type PerformanceMetric = z.infer<typeof performanceMetricSchema>;

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
async function isDuplicate(key: string): Promise<boolean> {
  // Fast-path: local cache hit
  if (dedupManager.isDuplicateLocal(key)) return true;

  try {
    const rawClient = getPublisherClient();
    if (!isRedisKVClient(rawClient)) {
      // No compatible Redis client; rely on local only
      logger.warn('Distributed de-dup Redis client missing SET; using local-only de-dup');
      return false;
    }

    const resp = await rawClient.set(
      dedupManager.getRedisKey(key),
      '1',
      'PX',
      dedupManager.getTTLms(),
      'NX'
    );
    if (resp === null) {
      // Already exists globally; mark local to avoid repeated remote checks during TTL
      dedupManager.markLocal(key);
      return true;
    }

    // Newly recorded globally; ensure local cache contains it too
    dedupManager.markLocal(key);
    return false;
  } catch (e) {
    logger.warn('Distributed de-dup unavailable; falling back to local', {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
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

async function rateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<{ allowed: boolean; remaining?: number; reset?: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowId = Math.floor(nowSec / windowSec);
  const windowKey = `${key}:${windowId}`;
  const reset = (windowId + 1) * windowSec; // epoch seconds of window reset

  try {
    const client = getPublisherClient();
    if (!client) {
      logger.warn('Rate limiter Redis client is not available; allowing request');
      return { allowed: true, reset };
    }

    const lua =
      "local c=redis.call('INCR', KEYS[1]); if c==1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end; return c";

    let countRaw: unknown;

    if (isRedisEvalCounter(client)) {
      try {
        countRaw = await client.eval(lua, 1, windowKey, String(windowSec));
      } catch (luaErr: unknown) {
        // Fallback: best-effort non-atomic path (still guarded) if Lua unavailable
        logger.warn('Rate limiter Lua EVAL failed; falling back to INCR/EXPIRE', {
          error: luaErr instanceof Error ? luaErr.message : String(luaErr),
          stack: luaErr instanceof Error ? luaErr.stack : undefined,
        });
        const tempCount = await client.incr(windowKey);
        if (tempCount === 1) {
          await client.expire(windowKey, windowSec);
        }
        countRaw = tempCount;
      }
    } else if (isRedisIncrExpire(client)) {
      // Client lacks eval, use non-atomic fallback
      const tempCount = await client.incr(windowKey);
      if (tempCount === 1) {
        await client.expire(windowKey, windowSec);
      }
      countRaw = tempCount;
    } else {
      logger.warn('Rate limiter Redis client missing required commands; allowing request');
      return { allowed: true, reset };
    }

    const countNum = typeof countRaw === 'number' ? countRaw : Number(countRaw);
    const safeCount = Number.isFinite(countNum) && countNum > 0 ? countNum : 1;

    const remaining = Math.max(0, limit - safeCount);
    return { allowed: safeCount <= limit, remaining, reset };
  } catch (err: unknown) {
    // On Redis failure, fail open but log full error and keep a sensible reset
    logger.warn('Rate limiter unavailable; allowing request', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { allowed: true, reset };
  }
}

function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`; // strip query/hash
  } catch {
    return 'invalid-url';
  }
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
  return new NextResponse(null, { status: 204 });
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return noStore({ success: false, error: 'Unsupported Media Type' }, { status: 415 });
    }

    if (!isOriginAllowed(request)) {
      return noStore({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = performanceMetricSchema.safeParse(body);
    if (parsed.success === false) {
      const issues = parsed.error?.issues ?? [];
      const fieldErrors = parsed.error?.flatten().fieldErrors ?? {};
      logger.warn('Invalid performance metric payload', { issues });
      return noStore(
        {
          success: false,
          error: {
            message: 'Invalid metric data',
            code: 'VALIDATION_ERROR',
            details: { issues: fieldErrors },
          },
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }
    const metric = parsed.data as PerformanceMetric;

    // Compute hashed session id for logs (privacy-friendly)
    const sessionIdHash = crypto
      .createHash('sha256')
      .update(metric.sessionId)
      .digest('hex')
      .slice(0, 12);

    // Apply rate limiting per session (fallback to UA/IP hash if needed)
    const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ua = request.headers.get('user-agent') ?? 'unknown';
    const identifier = metric.sessionId || xff || ua;
    const idHash = crypto.createHash('sha1').update(identifier).digest('hex').slice(0, 16);
    const rl = await rateLimit(`metrics:rl:${idHash}`, 60, 60); // 60 req/min
    if (!rl.allowed) {
      return noStore({ success: false, error: 'Too Many Requests' }, { status: 429 });
    }

    // De-dup by (sessionId, id)
    const dedupKey = `${metric.sessionId}:${metric.id}`;
    if (await isDuplicate(dedupKey)) {
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

    // Enqueue to BullMQ for async processing/storage
    await getMetricsQueue().add(
      'metric',
      {
        ...metric,
        url: sanitizedUrl,
        sessionIdHash,
        userAgent: ua,
      },
      {
        jobId: dedupKey, // deterministic for idempotency
      }
    );

    return noStore({ success: true, message: 'Performance metric recorded' });
  } catch (error) {
    const err = error as Error | null;
    const message = err?.message ?? String(error);
    logger.error('Failed to process performance metric', {
      error: message,
    });

    return noStore({ success: false, error: 'Invalid metric data' }, { status: 400 });
  }
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
