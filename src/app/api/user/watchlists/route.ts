/**
 * Watchlist API Routes
 * Next.js API endpoints for managing user watchlists
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';

/**
 * POST /api/user/watchlists
 * Create or update a watchlist
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, leagueId, watchlistId, name, playerIds, isDefault } = body;

    if (!userId || !name || !Array.isArray(playerIds)) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, name, playerIds' },
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
 * GET /api/user/watchlists?userId=xxx
 * Get all watchlists for a user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const leagueId = searchParams.get('leagueId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

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
