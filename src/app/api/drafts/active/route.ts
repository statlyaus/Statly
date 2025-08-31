import type { NextRequest } from 'next/server';
import { scalableLeagueDraftPersistence } from '@/services/scalableLeagueDraftPersistence';
import { successResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';

export const runtime = 'edge';
export const revalidate = 60; // Cache for 60 seconds at the edge

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get('leagueId');
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 10;

  if (!leagueId) {
    return commonErrors.badRequest('leagueId query parameter is required');
  }

  try {
    const drafts = await scalableLeagueDraftPersistence.getActiveLeagueDrafts(leagueId, limit);
    const res = successResponse({ count: drafts.length, drafts });
    res.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    return res;
  } catch (error) {
    logger.error('Failed to fetch active drafts', error);
    return commonErrors.internalServerError('Failed to fetch active drafts');
  }
}

