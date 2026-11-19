import { NextResponse, type NextRequest } from 'next/server';

import { rateLimitConfigs, withRateLimit } from '@/lib/rateLimit';

const checkPublicTradeRateLimit = withRateLimit(rateLimitConfigs.public);

/**
 * The public AFL trade API's rate limit (owner decision 2026-11-15): the same public budget as the
 * player routes. Returns the 429/503 answer to send, or null when the request may go ahead.
 */
export async function limitPublicTradeRequest(request: NextRequest): Promise<NextResponse | null> {
  const result = await checkPublicTradeRateLimit(request);
  if (result.success) return null;
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
