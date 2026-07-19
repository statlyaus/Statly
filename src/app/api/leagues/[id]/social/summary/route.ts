import type { NextRequest } from 'next/server';

import { getLeagueSocialSummary } from '@/server/leagues/social/socialQueries';

import { withLeagueSocialRoute } from '../socialRoute';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId }) =>
    getLeagueSocialSummary(leagueId, userId)
  );
}
