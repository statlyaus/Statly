import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.string().min(1, 'Missing leagueId'),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });
    }
    const { id: leagueId } = parsedParams.data;

    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await verifyLeagueMembership(leagueId, userId);
    if (!membership.isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const settings = await leagueApplicationService.getWaiverSettings(leagueId);

    return NextResponse.json(
      {
        waiverSettings: settings?.waiverSettings ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.warn('Failed to load waiver settings', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to load waiver settings' }, { status: 500 });
  }
}
