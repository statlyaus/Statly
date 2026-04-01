import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mapServiceError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  const [code, detail] = message.includes(':') ? message.split(/:(.+)/, 2) : [null, message];

  switch (code) {
    case 'conflict':
      return NextResponse.json({ error: detail }, { status: 409 });
    case 'forbidden':
      return NextResponse.json({ error: detail }, { status: 403 });
    case 'not_found':
      return NextResponse.json({ error: detail }, { status: 404 });
    default:
      return null;
  }
}

export const POST = withMetrics(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id: leagueId } = await params;
      const callerUserId = await getAuthenticatedUserId(req);
      if (!callerUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const body = (await req.json().catch(() => null)) as { claimId?: string } | null;
      if (!body?.claimId || typeof body.claimId !== 'string') {
        return NextResponse.json({ error: 'Invalid claimId' }, { status: 400 });
      }

      await leagueApplicationService.cancelWaiverClaim({
        leagueId,
        claimId: body.claimId,
        callerUserId,
      });

      logger.info('waiver cancelled', { leagueId, callerUserId, claimId: body.claimId });
      try {
        revalidateTag(tags.waivers(leagueId));
        revalidateTag(tags.league(leagueId));
      } catch (error) {
        logger.warn('Failed to revalidate tags after waiver cancel', { leagueId, error });
      }

      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (error) {
      const mapped = mapServiceError(error);
      if (mapped) return mapped;

      logger.apiError('POST', '/api/leagues/[id]/waivers/cancel', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/cancel'
);
