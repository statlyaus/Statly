export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { getPlayer } from '@/lib/data';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import type { LeagueParams } from '@/types/api';

export async function GET(_request: NextRequest, { params }: LeagueParams) {
  try {
    const { id } = await params;
    const player = await getPlayer(id);
    if (!player) {
      return commonErrors.notFound('Player not found');
    }
    return successResponse(player);
  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player');
  }
}
