/**
 * League Settings API Routes
 * Next.js API endpoints for managing league-specific user settings
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';

/**
 * PUT /api/user/leagues/[id]/settings
 * Update league-specific settings for the authenticated user
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Settings object is required' }, { status: 400 });
    }

    const profile = await userProfileService.getUserProfile(userId);

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    const membership = profile.leagueMemberships.find((m) => m.leagueId === leagueId);

    if (!membership) {
      return NextResponse.json({ error: 'User is not a member of this league' }, { status: 404 });
    }

    logger.info('API: Updating league settings', {
      userId,
      leagueId,
      settingKeys: Object.keys(settings),
    });

    const updatedSettings = await userProfileService.updateLeagueSettings(
      userId,
      leagueId,
      settings
    );

    return NextResponse.json({ settings: updatedSettings }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to update league settings', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/user/leagues/[id]/settings
 * Get league-specific settings for the authenticated user
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('API: Getting league settings', { userId, leagueId });

    // Get user profile and extract league settings
    const profile = await userProfileService.getUserProfile(userId);

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    const membership = profile.leagueMemberships.find((m) => m.leagueId === leagueId);

    if (!membership) {
      return NextResponse.json({ error: 'User is not a member of this league' }, { status: 404 });
    }

    return NextResponse.json(
      {
        settings: membership.leagueSettings,
        membership: {
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('API: Failed to get league settings', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
