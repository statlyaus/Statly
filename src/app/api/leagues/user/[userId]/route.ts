import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
import type { UserLeagueSummaryErrorResponse, UserLeagueSummaryResponse } from '@/types/leagues';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json<UserLeagueSummaryErrorResponse>(
        {
          success: false,
          leagues: [],
          error: 'User ID is required',
        },
        { status: 400 }
      );
    }

    const leagues = await leagueApplicationService.listUserLeagues(userId);

    logger.info(`Fetched ${leagues.length} league memberships for user ${userId}`);

    return NextResponse.json<UserLeagueSummaryResponse>({
      success: true,
      leagues,
    });
  } catch (error) {
    logger.error('Error fetching user league memberships:', error);
    return NextResponse.json<UserLeagueSummaryErrorResponse>(
      {
        success: false,
        leagues: [],
        error: 'Failed to fetch user league memberships',
      },
      { status: 500 }
    );
  }
}
