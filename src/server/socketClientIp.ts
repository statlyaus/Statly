import type { IncomingMessage } from 'node:http';

import { getTrustedClientIp } from '@/lib/rateLimit';

/**
 * The handshake's client IP for rate limiting: only what a trusted proxy wrote (the same rule as the
 * HTTP rate limiter), else the socket's own address. The client-written left of X-Forwarded-For is
 * never used, so a client cannot pick its own rate-limit bucket.
 */
export function socketClientIp(
  req: Pick<IncomingMessage, 'headers' | 'socket'>,
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const headers = {
    get(name: string): string | null {
      const value = req.headers[name.toLowerCase()];
      return Array.isArray(value) ? value.join(',') : (value ?? null);
    },
  };
  return getTrustedClientIp(headers, env) || req.socket.remoteAddress || 'unknown';
}
