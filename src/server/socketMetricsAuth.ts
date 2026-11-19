import { timingSafeEqual } from 'node:crypto';

/**
 * Who may read the Socket.IO server's Prometheus /metrics: the holder of METRICS_BEARER_TOKEN, the
 * same token /api/metrics accepts. In production with no token configured it is unavailable rather
 * than open; outside production it stays open for local work.
 */
export function socketMetricsAccess(
  authorization: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env
): 'allowed' | 'unauthorized' | 'unconfigured' {
  const expected = (env.METRICS_BEARER_TOKEN ?? '').trim();
  if (!expected) return env.NODE_ENV === 'production' ? 'unconfigured' : 'allowed';
  const supplied = /^Bearer\s+(.+)$/iu.exec((authorization ?? '').trim())?.[1]?.trim() ?? '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? 'allowed' : 'unauthorized';
}
