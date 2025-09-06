// src/app/api/user/watchlists/route.ts
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { adminAuth } from '@/lib/firebaseAdmin';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';

// ---------- Helpers ----------
async function requireUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('statly_session')?.value;
    if (!sessionCookie) return null;
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid ?? null;
  } catch (err) {
    logger.debug('watchlists: session verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------- Schemas ----------
const UpsertWatchlistSchema = z.object({
  leagueId: z.string().min(1).optional(),
  watchlistId: z.string().min(1).optional(),
  name: z.string().min(1, 'name is required'),
  playerIds: z.array(z.string().min(1)),
  isDefault: z.boolean().optional().default(false),
});

/**
 * POST /api/user/watchlists
 * Create or update a watchlist for the **authenticated** user
 * Body: { leagueId?, watchlistId?, name, playerIds[], isDefault? }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const json = await request.json().catch(() => ({}));
    const parsed = UpsertWatchlistSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid watchlist payload', issues: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const { leagueId, watchlistId, name, playerIds, isDefault } = parsed.data;

    logger.info('API: upsert watchlist', {
      userId,
      leagueId: leagueId ?? null,
      hasWatchlistId: Boolean(watchlistId),
      playerCount: playerIds.length,
      isDefault: Boolean(isDefault),
    });

    const watchlist = await userProfileService.updateWatchlist({
      userId,
      leagueId,
      watchlistId,
      name,
      playerIds,
      isDefault,
    });

    // 201 when created, 200 when updated
    return NextResponse.json({ watchlist }, { status: watchlistId ? 200 : 201 });
  } catch (error) {
    logger.error('API: upsert watchlist failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/user/watchlists?leagueId=...
 * Returns all watchlists for the **authenticated** user, optionally filtered by leagueId
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');

    logger.debug('API: get user watchlists', { userId, leagueId });

    const profile = await userProfileService.getUserProfile(userId);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    const watchlists = leagueId
      ? profile.watchlists.filter((w) => w.leagueId === leagueId)
      : profile.watchlists;

    return NextResponse.json({ watchlists }, { status: 200 });
  } catch (error) {
    logger.error('API: get watchlists failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
