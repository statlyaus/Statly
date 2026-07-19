import type { NextRequest } from 'next/server';

import { createSocialPost } from '@/server/leagues/social/socialCommands';
import { listSocialPosts } from '@/server/leagues/social/socialQueries';
import { enforceSocialRateLimit } from '@/server/leagues/social/socialRateLimit';
import { parseSocialPageSize } from '@/server/leagues/social/socialValidation';

import { readSocialJson, withLeagueSocialRoute } from '../socialRoute';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sort =
    request.nextUrl.searchParams.get('sort') === 'createdAt' ? 'createdAt' : 'latestActivity';
  return withLeagueSocialRoute(request, params, ({ leagueId, userId }) =>
    listSocialPosts(leagueId, userId, {
      cursor: request.nextUrl.searchParams.get('cursor'),
      limit: parseSocialPageSize(request.nextUrl.searchParams.get('limit')),
      categoryId: request.nextUrl.searchParams.get('categoryId'),
      sort,
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
        action: 'post',
        maxRequests: 8,
        windowSeconds: 60,
      });
      return createSocialPost(leagueId, userId, await readSocialJson(request));
    },
    201
  );
}
