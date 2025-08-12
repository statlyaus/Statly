export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { getPlayer } from '@/lib/data';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const player = await getPlayer(params.id);
    if (!player) {
      return commonErrors.notFound('Player not found');
    }
    return successResponse(player);
  } catch (error) {
    logger.error('Failed to fetch player', error, { playerId: params.id });
    return commonErrors.internalServerError('Failed to fetch player');
  }
}
