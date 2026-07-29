import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { canManageLeague } from '@/server/leagues/membership';
import { WaiverProcessingService } from '@/server/waivers/WaiverProcessingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withMetrics(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: leagueId } = await params;

    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const allowed = await canManageLeague(leagueId, userId);
      if (!allowed) {
        return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 });
      }

      const result = await new WaiverProcessingService().processLeague({ leagueId });

      logger.info('waivers processed', { leagueId, processed: result.processed });

      const revalidation = await Promise.allSettled([
        revalidateTag(tags.waivers(leagueId), { expire: 0 }),
        revalidateTag(tags.league(leagueId), { expire: 0 }),
      ]);
      const failedRevalidations = revalidation.filter((item) => item.status === 'rejected');
      if (failedRevalidations.length) {
        logger.warn('Failed to revalidate tags after waivers process', {
          leagueId,
          failed: failedRevalidations.length,
        });
      }

      return NextResponse.json(result);
    } catch (error) {
      logger.apiError('POST', '/api/leagues/[id]/waivers/process', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/process'
);
