import type { NextRequest } from 'next/server';

import { moderateSocialContent } from '@/server/leagues/social/socialCommands';
import { enforceSocialRateLimit } from '@/server/leagues/social/socialRateLimit';

import { readSocialJson, withLeagueSocialRoute } from '../socialRoute';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(request, params, async ({ leagueId, userId }) => {
    await enforceSocialRateLimit({
      leagueId,
      userId,
      action: 'moderation',
      maxRequests: 30,
      windowSeconds: 60,
    });
    return moderateSocialContent(leagueId, userId, await readSocialJson(request));
  });
}
