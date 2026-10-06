/**
 * League Management API Routes
 * Next.js API endpoints for league-related user operations
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';

/**
 * POST /api/user/leagues
 * Join a league with specific settings as the authenticated user
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { leagueId, memberName, leagueSettings, inviteCode } = body;

    if (!leagueId || !memberName) {
      return NextResponse.json(
        { error: 'Missing required fields: leagueId, memberName' },
        { status: 400 }
      );
    }

    logger.info('API: User joining league', { userId, leagueId, memberName });

    const membership = await userProfileService.joinLeague({
      userId,
      leagueId,
      memberName,
      leagueSettings,
      inviteCode,
    });

    return NextResponse.json({ membership }, { status: 201 });
  } catch (error) {
    logger.error('API: Failed to join league', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/user/leagues?status=&format=&role=
 * Get the authenticated user's league memberships with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parse query parameters for filtering with proper type casting
    const filters: {
      status?: Array<'ACTIVE' | 'INVITED' | 'DECLINED' | 'REMOVED'>;
      format?: Array<'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY'>;
      role?: Array<'OWNER' | 'COMMISSIONER' | 'MEMBER'>;
    } = {};

    const status = searchParams.get('status');
    if (status) {
      filters.status = status.split(',') as Array<'ACTIVE' | 'INVITED' | 'DECLINED' | 'REMOVED'>;
    }

    const format = searchParams.get('format');
    if (format) {
      filters.format = format.split(',') as Array<'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY'>;
    }

    const role = searchParams.get('role');
    if (role) {
      filters.role = role.split(',') as Array<'OWNER' | 'COMMISSIONER' | 'MEMBER'>;
    }

    logger.debug('API: Getting user leagues', { userId, filters });

    const leagues = await userProfileService.getUserLeagues(userId, filters);

    return NextResponse.json({ leagues }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to get user leagues', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
