/**
 * Watchlist API Routes
 * Next.js API endpoints for managing user watchlists
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';

/**
 * POST /api/user/watchlists
 * Create or update a watchlist for the authenticated user
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { leagueId, watchlistId, name, playerIds, isDefault } = body;

    if (!name || !Array.isArray(playerIds)) {
      return NextResponse.json(
        { error: 'Missing required fields: name, playerIds' },
        { status: 400 }
      );
    }

    logger.info('API: Creating/updating watchlist', {
      userId,
      leagueId,
      watchlistId,
      playerCount: playerIds.length,
    });

    const watchlist = await userProfileService.updateWatchlist({
      userId,
      leagueId,
      watchlistId,
      name,
      playerIds,
      isDefault: isDefault || false,
    });

    return NextResponse.json({ watchlist }, { status: watchlistId ? 200 : 201 });
  } catch (error) {
    logger.error('API: Failed to create/update watchlist', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/user/watchlists?leagueId=xxx
 * Get all watchlists for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');

    logger.debug('API: Getting user watchlists', { userId, leagueId });

    const profile = await userProfileService.getUserProfile(userId);

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Filter watchlists by league if specified
    let watchlists = profile.watchlists;
    if (leagueId !== null) {
      watchlists = watchlists.filter((w) => w.leagueId === leagueId);
    }

    return NextResponse.json({ watchlists }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to get user watchlists', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
