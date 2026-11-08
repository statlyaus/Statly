import { createHash, timingSafeEqual } from 'node:crypto';

import type { NextRequest } from 'next/server';

// Shared authorization for cron endpoints.
// Requires CRON_SECRET outside local development and fails closed when it is unset. The secret is
// accepted only as `Authorization: Bearer <CRON_SECRET>`: a query string lands in CDN and function
// access logs.

function presentedSecret(req: NextRequest): string | null {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  return bearer?.[1]?.trim() || null;
}

// Hash both sides so the comparison is constant-time regardless of input length.
function secretsMatch(presented: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

export function isCronRequestAuthorized(req: NextRequest): boolean {
  const configured = process.env.CRON_SECRET?.trim();
  if (!configured) {
    return process.env.NODE_ENV === 'development';
  }
  const presented = presentedSecret(req);
  return presented !== null && secretsMatch(presented, configured);
}
