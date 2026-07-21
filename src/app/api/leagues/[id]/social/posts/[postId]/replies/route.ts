import type { NextRequest } from 'next/server';

import { createSocialReply } from '@/server/leagues/social/socialCommands';
import { getSocialPostThread } from '@/server/leagues/social/socialQueries';
import { enforceSocialRateLimit } from '@/server/leagues/social/socialRateLimit';
import { parseSocialPageSize } from '@/server/leagues/social/socialValidation';

import { readSocialJson, withLeagueSocialRoute } from '../../../socialRoute';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId, params: values }) =>
    getSocialPostThread(leagueId, userId, values.postId, {
      cursor: request.nextUrl.searchParams.get('cursor'),
      limit: parseSocialPageSize(request.nextUrl.searchParams.get('limit')),
    })
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  return withLeagueSocialRoute(
    request,
    params,
    async ({ leagueId, userId, params: values }) => {
      await enforceSocialRateLimit({
        leagueId,
        userId,
        action: 'reply',
        maxRequests: 12,
        windowSeconds: 60,
      });
      return createSocialReply(leagueId, userId, values.postId, await readSocialJson(request));
    },
    201
  );
}
