// src/app/api/user/watchlists/route.ts
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { z } from 'zod';

import { middlewareConfigs, createResponse } from '@/lib/apiMiddleware';
import { logger } from '@/lib/logger';
import { userProfileService } from '@/services/userProfileService';

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
export const POST = middlewareConfigs.private(async ({ req, user }) => {
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = UpsertWatchlistSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid watchlist payload', issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { leagueId, watchlistId, name, playerIds, isDefault } = parsed.data;

  logger.info('API: upsert watchlist', {
    userId: user.id,
    leagueId: leagueId ?? null,
    hasWatchlistId: Boolean(watchlistId),
    playerCount: playerIds.length,
    isDefault: Boolean(isDefault),
  });

  const watchlist = await userProfileService.updateWatchlist({
    userId: user.id,
    leagueId,
    watchlistId,
    name,
    playerIds,
    isDefault,
  });

  // 201 when created, 200 when updated
  return createResponse({ watchlist }, watchlistId ? 200 : 201);
});

/**
 * GET /api/user/watchlists?leagueId=...
 * Returns all watchlists for the **authenticated** user, optionally filtered by leagueId
 */
export const GET = middlewareConfigs.private(async ({ req, user }) => {
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get('leagueId');

  logger.debug('API: get user watchlists', { userId: user.id, leagueId });

  const profile = await userProfileService.getUserProfile(user.id);
  if (!profile) {
    return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
  }

  const watchlists = leagueId
    ? profile.watchlists.filter((w) => w.leagueId === leagueId)
    : profile.watchlists;

  return createResponse({ watchlists });
});
