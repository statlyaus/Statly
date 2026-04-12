/**
 * League Settings API Routes
 * Next.js API endpoints for managing league-specific user settings
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { userProfileService } from '@/services/userProfileService';

const paramsSchema = z.object({
  id: z.string().min(1, 'League ID is required'),
});

const putBodySchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  settings: z.record(z.string(), z.unknown()),
});

/**
 * PUT /api/user/leagues/[id]/settings
 * Update league-specific settings for a user
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }
    const { id: leagueId } = parsedParams.data;

    const rawBody = (await request.json().catch(() => null)) as unknown;
    const parsedBody = putBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { userId, settings } = parsedBody.data;

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
 * GET /api/user/leagues/[id]/settings?userId=xxx
 * Get league-specific settings for a user
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }
    const { id: leagueId } = parsedParams.data;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId || !leagueId) {
      return NextResponse.json(
        { error: 'Missing required parameters: userId, leagueId' },
        { status: 400 }
      );
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
