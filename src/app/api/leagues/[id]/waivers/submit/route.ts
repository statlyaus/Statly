import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { tags } from '@/lib/cacheTags';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.string().min(1, 'Missing leagueId'),
});

const bodySchema = z.object({
  teamId: z.string().min(1),
  playerId: z.string().min(1),
  dropPlayerId: z.string().min(1).optional(),
  priority: z.number().int().positive().optional().default(1),
  bidAmount: z.number().finite().optional(),
});

function mapServiceError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  const [code, detail] = message.includes(':') ? message.split(/:(.+)/, 2) : [null, message];

  switch (code) {
    case 'bad_request':
      return NextResponse.json({ error: detail }, { status: 400 });
    case 'conflict':
      return NextResponse.json({ error: detail }, { status: 409 });
    case 'forbidden':
      return NextResponse.json({ error: detail }, { status: 403 });
    case 'locked':
      return NextResponse.json({ error: detail }, { status: 423 });
    case 'not_found':
      return NextResponse.json({ error: detail }, { status: 404 });
    default:
      return null;
  }
}

export const POST = withMetrics(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const parsedParams = paramsSchema.safeParse(await context.params);
      if (!parsedParams.success) {
        return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });
      }
      const { id: leagueId } = parsedParams.data;

      const userId = await getAuthenticatedUserId(req);
      if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const body = (await req.json().catch(() => null)) as unknown;
      const parsedBody = bodySchema.safeParse(body);
      if (!parsedBody.success) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }

      const membership = await verifyLeagueMembership(leagueId, userId);
      if (!membership.isMember) {
        return NextResponse.json({ error: 'Not a league member' }, { status: 403 });
      }

      const { teamId, playerId, dropPlayerId, priority, bidAmount } = parsedBody.data;
      const claim = await leagueApplicationService.submitWaiverClaim({
        leagueId,
        userId,
        teamId,
        playerId,
        dropPlayerId,
        priority,
        bidAmount,
      });

      logger.info('waiver submitted', {
        leagueId,
        userId,
        teamId,
        playerId,
        claimId: claim.id,
      });

      try {
        const results = await Promise.allSettled([
          revalidateTag(tags.waivers(leagueId)),
          revalidateTag(tags.league(leagueId)),
        ]);
        const failed = results.filter((result) => result.status === 'rejected').length;
        if (failed) {
          logger.warn('Failed to revalidate tags after waiver submit', { leagueId, failed });
        }
      } catch (error) {
        logger.warn('Revalidation error after waiver submit', { leagueId, error });
      }

      return NextResponse.json({ id: claim.id }, { status: 201 });
    } catch (error) {
      const mapped = mapServiceError(error);
      if (mapped) {
        return mapped;
      }

      logger.apiError('POST', '/api/leagues/[id]/waivers/submit', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/submit'
);
