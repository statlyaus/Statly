import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';

import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { botManagerService } from '@/services/botManagerService';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1),
});

const bodySchema = z.object({
  season: z.number().int().optional(),
  maxActions: z.number().int().min(1).max(50).optional(),
});

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const [code, detail] = message.includes(':') ? message.split(/:(.+)/, 2) : [null, message];

  switch (code) {
    case 'forbidden':
      return commonErrors.forbidden(detail);
    case 'bad_request':
      return commonErrors.badRequest(detail);
    default:
      return commonErrors.internalServerError('Failed to run league bots');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actorUserId = await getAuthenticatedUserId(request);
  if (!actorUserId) {
    return commonErrors.unauthorized();
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return commonErrors.badRequest('League ID is required');
  }

  const parsedBody = bodySchema.safeParse(
    await request.json().catch(() => ({ season: getDefaultAflSeason() }))
  );
  if (!parsedBody.success) {
    return commonErrors.badRequest('Invalid bot run payload', {
      errors: parsedBody.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await botManagerService.runLeagueBots({
      leagueId: parsedParams.data.id,
      actorUserId,
      season: parsedBody.data.season ?? getDefaultAflSeason(),
      maxActions: parsedBody.data.maxActions,
    });

    try {
      const leagueId = parsedParams.data.id;
      await Promise.allSettled([
        revalidateTag(tags.league(leagueId)),
        revalidateTag(tags.trades(leagueId)),
        revalidateTag(tags.waivers(leagueId)),
      ]);
    } catch (error) {
      logger.warn('Bot run revalidation failed', { leagueId: parsedParams.data.id, error });
    }

    return successResponse(result);
  } catch (error) {
    return mapError(error);
  }
}
