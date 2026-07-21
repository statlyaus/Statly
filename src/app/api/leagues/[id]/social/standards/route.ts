import type { NextRequest } from 'next/server';

import { acceptSocialStandards } from '@/server/leagues/social/socialCommands';

import { withLeagueSocialRoute } from '../socialRoute';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId }) =>
    acceptSocialStandards(leagueId, userId)
  );
}
