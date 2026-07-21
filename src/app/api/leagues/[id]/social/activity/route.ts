import type { NextRequest } from 'next/server';

import { listSocialActivity } from '@/server/leagues/social/socialQueries';
import { parseSocialPageSize } from '@/server/leagues/social/socialValidation';

import { withLeagueSocialRoute } from '../socialRoute';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId }) =>
    listSocialActivity(leagueId, userId, {
      cursor: request.nextUrl.searchParams.get('cursor'),
      limit: parseSocialPageSize(request.nextUrl.searchParams.get('limit')),
    })
  );
}
