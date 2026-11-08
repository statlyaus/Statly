import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { canUseBasketball } from '@/server/basketball/basketballAccess';
import {
  BasketballLeagueError,
  toBasketballErrorResponse,
} from '@/server/basketball/leagues/basketballLeagueErrors';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

/**
 * Runs one basketball API handler. Each route resolves its caller itself with
 * `getAuthenticatedUserId(request)` and passes the pending result in, so the route authorization
 * contract sees the check in every handler; no user answers 401 before the handler runs, and a user
 * outside the basketball allow-list (`canUseBasketball`) answers the same 404 as a missing league.
 * The handler calls the owner-scoped server module, whose typed errors become 400/404/409 here; anything else is
 * logged and answers a generic 500.
 */
export async function basketballResponse<T>(
  request: NextRequest,
  pendingUserId: Promise<string | null>,
  handler: (userId: string) => Promise<T>,
  status = 200
): Promise<NextResponse> {
  try {
    const userId = await pendingUserId;
    if (!userId) {
      throw new BasketballLeagueError('UNAUTHORIZED', 'Sign in to use fantasy basketball');
    }
    if (!canUseBasketball(userId)) throw new BasketballLeagueError('NOT_FOUND', 'Not found');
    const data = await handler(userId);
    return NextResponse.json({ success: true, data }, { status, headers: privateHeaders });
  } catch (error) {
    const response = toBasketballErrorResponse(error);
    if (response.status === 500) logger.apiError(request.method, request.nextUrl.pathname, error);
    return NextResponse.json(response.body, { status: response.status, headers: privateHeaders });
  }
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BasketballLeagueError('VALIDATION', 'Send the request body as JSON');
  }
}
