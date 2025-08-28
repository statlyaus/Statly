import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { metricsCollector } from '@/lib/metrics';
import { timingSafeEqual, createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Get metrics secrets - validation deferred to runtime
const METRICS_API_KEY = (process.env.METRICS_API_KEY || '').trim();
const METRICS_BEARER_TOKEN = (process.env.METRICS_BEARER_TOKEN || '').trim();

// Simple in-process rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute

// Simple in-process cache
type CollectedMetrics = Awaited<ReturnType<typeof metricsCollector.collectAllMetrics>>;
let metricsCache: { data: CollectedMetrics; timestamp: number } | null = null;
const CACHE_TTL = 30 * 1000; // 30 seconds

// Lazily initialize on first request to avoid capturing module import time
let startedAtTimestamp: number | null = null;
function getStartedAt(): number {
  if (startedAtTimestamp === null) {
    startedAtTimestamp = Date.now();
  }
  return startedAtTimestamp;
}

function getClientIdentifier(req: NextRequest): string {
  // First check for provided credentials and create a fingerprint
  const authHeader = (req.headers.get('authorization') || '').trim();
  const apiKeyHeader = (req.headers.get('x-api-key') || '').trim();
  
  // If we have a credential, create a SHA-256 fingerprint
  if (authHeader) {
    try {
      const hash = createHash('sha256').update(authHeader).digest('hex');
      return `auth:${hash.substring(0, 16)}`; // Use first 16 chars for reasonable length
    } catch {
      // Fall through to IP-based identification
    }
  }
  
  if (apiKeyHeader) {
    try {
      const hash = createHash('sha256').update(apiKeyHeader).digest('hex');
      return `apikey:${hash.substring(0, 16)}`; // Use first 16 chars for reasonable length
    } catch {
      // Fall through to IP-based identification
    }
  }
  
  // Fallback to IP-based identification if no credentials present
  const reqAny = req as unknown as { ip?: string | null | undefined };
  const directIp = (reqAny.ip ?? '').toString().trim();

  if (directIp) return `ip:${directIp}`;

  const forwardedRaw = req.headers.get('x-forwarded-for') || '';
  const realIpRaw = req.headers.get('x-real-ip') || '';
  const cfConnectingIpRaw = req.headers.get('cf-connecting-ip') || '';

  const forwarded = forwardedRaw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)[0];

  const realIp = realIpRaw.trim();
  const cfConnectingIp = cfConnectingIpRaw.trim();

  const ipIdentifier = forwarded || realIp || cfConnectingIp;
  return ipIdentifier ? `ip:${ipIdentifier}` : 'unknown';
}

function checkRateLimit(
  clientId: string
): { allowed: boolean; remaining: number; reset: number; limit: number } {
  const now = Date.now();

  // Opportunistically prune stale entries
  for (const [key, value] of rateLimitMap) {
    if (value.resetTime < now) {
      rateLimitMap.delete(key);
    }
  }

  let clientData = rateLimitMap.get(clientId);
  if (!clientData || now > clientData.resetTime) {
    clientData = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  }

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - clientData.count);
  const allowed = remaining > 0;

  if (allowed) {
    clientData.count += 1;
  }

  rateLimitMap.set(clientId, clientData);

  return {
    allowed,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - clientData.count),
    reset: clientData.resetTime,
    limit: RATE_LIMIT_MAX_REQUESTS,
  };
}

function safeEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function authenticateRequest(req: NextRequest): boolean {
  const headerApiKey = (req.headers.get('x-api-key') || '').trim();
  const authHeader = (req.headers.get('authorization') || '').trim();
  const bearerMatch = /^Bearer\s+(.*)$/i.exec(authHeader);
  const headerBearer = bearerMatch ? bearerMatch[1].trim() : '';

  const apiKeyValid = METRICS_API_KEY ? safeEqual(headerApiKey, METRICS_API_KEY) : false;
  const bearerValid = METRICS_BEARER_TOKEN
    ? safeEqual(headerBearer, METRICS_BEARER_TOKEN)
    : false;

  return apiKeyValid || bearerValid;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Runtime validation of metrics secrets
    if (process.env.NODE_ENV === 'production' && !METRICS_API_KEY && !METRICS_BEARER_TOKEN) {
      console.error('GET /api/metrics failed: Metrics secrets are missing');
      return NextResponse.json(
        { error: 'Metrics service not configured' },
        { 
          status: 503,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': '60'
          }
        }
      );
    }
    
    // Authentication check
    if (!authenticateRequest(req)) {
      console.error('GET /api/metrics failed: Unauthorized request');
      return NextResponse.json(
        { error: 'Unauthorized' },
        {
          status: 401,
          headers: {
            'Cache-Control': 'no-store',
            'WWW-Authenticate': 'Bearer realm="api"',
            Vary: 'Authorization, Cookie',
          },
        }
      );
    }
    
    // Rate limiting check
    const clientId = getClientIdentifier(req);
    const rate = checkRateLimit(clientId);
    if (!rate.allowed) {
      console.error('GET /api/metrics failed: Rate limit exceeded for client:', clientId);
      // Compute a safe Retry-After value in whole seconds (minimum 1)
      let retryAfterSeconds = Math.ceil((rate.reset - Date.now()) / 1000);
      if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
        retryAfterSeconds = 1;
      }

      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': `${retryAfterSeconds}`,
            'X-RateLimit-Limit': `${rate.limit}`,
            'X-RateLimit-Remaining': `${rate.remaining}`,
            'X-RateLimit-Reset': `${Math.ceil(rate.reset / 1000)}`,
          },
        }
      );
    }
    
    // Check cache first
    if (metricsCache && Date.now() - metricsCache.timestamp < CACHE_TTL) {
      const remainingTtlSeconds = Math.max(
        0,
        Math.floor((CACHE_TTL - (Date.now() - metricsCache.timestamp)) / 1000)
      );
      return NextResponse.json(metricsCache.data, {
        headers: {
          'Cache-Control': `private, max-age=${remainingTtlSeconds}`,
          Vary: 'Authorization, Cookie',
          'X-Cache': 'HIT',
          'X-RateLimit-Limit': `${rate.limit}`,
          'X-RateLimit-Remaining': `${rate.remaining}`,
          'X-RateLimit-Reset': `${Math.ceil(rate.reset / 1000)}`,
        },
      });
    }
    
    // Collect fresh metrics
    const metrics = await metricsCollector.collectAllMetrics(getStartedAt());
    
    // Update cache
    metricsCache = { data: metrics, timestamp: Date.now() };
    
    const ttlSeconds = Math.floor(CACHE_TTL / 1000);
    return NextResponse.json(metrics, {
      headers: {
        'Cache-Control': `private, max-age=${ttlSeconds}`,
        Vary: 'Authorization, Cookie',
        'X-Cache': 'MISS',
        'X-RateLimit-Limit': `${rate.limit}`,
        'X-RateLimit-Remaining': `${rate.remaining}`,
        'X-RateLimit-Reset': `${Math.ceil(rate.reset / 1000)}`,
      },
    });
  } catch (error) {
    console.error('GET /api/metrics failed:', error);
    return NextResponse.json(
      { error: 'Failed to collect metrics' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}


