import type { NextRequest } from 'next/server';

import { createSocialMessage } from '@/server/leagues/social/socialCommands';
import { listSocialMessages } from '@/server/leagues/social/socialQueries';
import { enforceSocialRateLimit } from '@/server/leagues/social/socialRateLimit';
import { parseSocialPageSize } from '@/server/leagues/social/socialValidation';

import { readSocialJson, withLeagueSocialRoute } from '../socialRoute';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId }) =>
    listSocialMessages(leagueId, userId, {
      cursor: request.nextUrl.searchParams.get('cursor'),
      limit: parseSocialPageSize(request.nextUrl.searchParams.get('limit')),
    })
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(
    request,
    params,
    async ({ leagueId, userId }) => {
      await enforceSocialRateLimit({
        leagueId,
        userId,
        action: 'message',
        maxRequests: 20,
        windowSeconds: 60,
      });
      return createSocialMessage(leagueId, userId, await readSocialJson(request));
    },
    201
  );
}
