import type { NextRequest } from 'next/server';

import { updateSocialPreferences } from '@/server/leagues/social/socialCommands';

import { readSocialJson, withLeagueSocialRoute } from '../socialRoute';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withLeagueSocialRoute(request, params, async ({ leagueId, userId }) =>
    updateSocialPreferences(leagueId, userId, await readSocialJson(request))
  );
}
