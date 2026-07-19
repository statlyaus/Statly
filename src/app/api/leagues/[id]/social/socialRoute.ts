import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { SocialError, toSocialErrorResponse } from '@/server/leagues/social/socialErrors';

export interface LeagueSocialRouteContext {
  leagueId: string;
  userId: string;
  params: Record<string, string>;
}

export async function withLeagueSocialRoute<T>(
  request: NextRequest,
  paramsPromise: Promise<Record<string, string>>,
  handler: (context: LeagueSocialRouteContext) => Promise<T>,
  status = 200
): Promise<NextResponse> {
  let context: LeagueSocialRouteContext | null = null;
  try {
    const params = await paramsPromise;
    const leagueId = params.id;
    if (!leagueId) throw new SocialError('VALIDATION', 'League ID is required');

    const userId = await getAuthenticatedUserId(request);
    if (!userId) throw new SocialError('UNAUTHORIZED', 'Sign in to use league social features');
    context = { leagueId, userId, params };

    const data = await handler(context);
    return NextResponse.json(
      { success: true, data },
      {
        status,
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error) {
    const response = toSocialErrorResponse(error);
    if (!(error instanceof SocialError) || error.code === 'INTERNAL') {
      logger.error('League social route failed', {
        leagueId: context?.leagueId,
        userId: context?.userId,
        path: request.nextUrl.pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}

export async function readSocialJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SocialError('VALIDATION', 'Request body must be valid JSON');
  }
}
