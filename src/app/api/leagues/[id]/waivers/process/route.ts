import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

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
      if (result.alreadyRunning) {
        return NextResponse.json(
          { error: 'Waiver processing is already running' },
          { status: 409 }
        );
      }

      logger.info('waivers processed', { leagueId, processed: result.processed });

      return NextResponse.json(result);
    } catch (error) {
      logger.apiError('POST', '/api/leagues/[id]/waivers/process', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/process'
);
