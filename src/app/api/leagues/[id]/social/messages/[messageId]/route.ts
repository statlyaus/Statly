import type { NextRequest } from 'next/server';

import { deleteSocialMessage, editSocialMessage } from '@/server/leagues/social/socialCommands';

import { readSocialJson, withLeagueSocialRoute } from '../../socialRoute';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  return withLeagueSocialRoute(request, params, async ({ leagueId, userId, params: values }) =>
    editSocialMessage(leagueId, userId, values.messageId, await readSocialJson(request))
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId, params: values }) =>
    deleteSocialMessage(leagueId, userId, values.messageId)
  );
}
