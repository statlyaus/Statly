/**
 * League Management API Routes
 * Next.js API endpoints for league-related user operations
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { userProfileService } from '@/services/userProfileService';

/**
 * POST /api/user/leagues/join
 * Join a league with specific settings
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, leagueId, memberName, leagueSettings, inviteCode } = body;

    if (!userId || !leagueId || !memberName) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, leagueId, memberName' },
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
 * GET /api/user/leagues?userId=xxx
 * Get user's league memberships with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

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
