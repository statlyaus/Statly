export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getPlayer } from '@/lib/data';
import { logger } from '@/lib/logger';

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { id } = params;
    const player = await getPlayer(id);
    if (!player) {
      return commonErrors.notFound('Player not found');
    }
    return successResponse(player);
  } catch (error) {
    const { id } = params;
    logger.error('Failed to fetch player', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player');
  }
}
