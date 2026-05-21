type SocketAllowRequest = (
  req: {
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress?: string | null };
  },
  callback: (error: string | null, allowed: boolean) => void
) => Promise<void>;

type RedisRateLimitClient = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  mget(keys: string[]): Promise<Array<string | null | undefined>>;
};

type SocketAllowRequestLimiterOptions = {
  getRedisClient: () => RedisRateLimitClient | null | undefined;
  env?: Record<string, string | undefined>;
  now?: () => number;
  store?: Map<string, number[]>;
  onRedisFallback?: (error: unknown) => void;
  onRateLimited?: () => void;
  onOutcome?: (outcome: 'ok' | 'ratelimited' | 'error', durationSeconds: number) => void;
  onError?: () => void;
};

function readPositiveNumber(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number
) {
  const parsed = Number(env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRequestIp(req: Parameters<SocketAllowRequest>[0]) {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return firstForwarded?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

export function createSocketAllowRequestLimiter(
  options: SocketAllowRequestLimiterOptions
): SocketAllowRequest {
  const env = options.env ?? process.env;
  const store = options.store ?? new Map<string, number[]>();
  const now = options.now ?? Date.now;

  return async (req, callback) => {
    const startedAt = Date.now();
    const requestTime = now();
    const observeOutcome = (outcome: 'ok' | 'ratelimited' | 'error') => {
      options.onOutcome?.(outcome, Math.max(0, (Date.now() - startedAt) / 1000));
    };

    try {
      const ip = getRequestIp(req);
      const windowSec = readPositiveNumber(env, 'SOCKET_RATE_LIMIT_WINDOW_SEC', 60);
      const subBucketSec = readPositiveNumber(env, 'SOCKET_RATE_LIMIT_SUB_BUCKET_SEC', 10);
      const maxReq = readPositiveNumber(env, 'SOCKET_RATE_LIMIT_MAX', 100);
      const currentBucket = Math.floor(requestTime / (subBucketSec * 1000));
      const bucketsToCount = Math.ceil(windowSec / subBucketSec);

      try {
        const client = options.getRedisClient();
        if (!client) throw new Error('Redis not initialized');

        const currentKey = `ratelimit:socketio:${ip}:${currentBucket}`;
        const incremented = await client.incr(currentKey);
        if (incremented === 1) {
          await client.expire(currentKey, windowSec);
        }

        const keys = Array.from(
          { length: bucketsToCount },
          (_, index) => `ratelimit:socketio:${ip}:${currentBucket - index}`
        );
        const values = await client.mget(keys);
        const total = values.reduce((sum, value) => sum + (value ? parseInt(value, 10) : 0), 0);
        if (total > maxReq) {
          options.onRateLimited?.();
          observeOutcome('ratelimited');
          callback('Rate limit exceeded', false);
          return;
        }
      } catch (error) {
        options.onRedisFallback?.(error);

        const windowMs = windowSec * 1000;
        const recent = (store.get(ip) ?? []).filter(
          (timestamp) => requestTime - timestamp < windowMs
        );
        recent.push(requestTime);
        store.set(ip, recent);

        if (recent.length > maxReq) {
          options.onRateLimited?.();
          observeOutcome('ratelimited');
          callback('Rate limit exceeded', false);
          return;
        }
      }

      observeOutcome('ok');
      callback(null, true);
    } catch {
      options.onError?.();
      observeOutcome('error');
      callback('Authentication error', false);
    }
  };
}
