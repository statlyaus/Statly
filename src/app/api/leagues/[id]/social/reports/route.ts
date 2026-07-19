import type { NextRequest } from 'next/server';

import { reportSocialContent } from '@/server/leagues/social/socialCommands';
import { enforceSocialRateLimit } from '@/server/leagues/social/socialRateLimit';

import { readSocialJson, withLeagueSocialRoute } from '../socialRoute';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(
    request,
    params,
    async ({ leagueId, userId }) => {
      await enforceSocialRateLimit({
        leagueId,
        userId,
        action: 'report',
        maxRequests: 5,
        windowSeconds: 300,
      });
      return reportSocialContent(leagueId, userId, await readSocialJson(request));
    },
    201
  );
}
