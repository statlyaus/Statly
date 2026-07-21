import type { NextRequest } from 'next/server';

import { deleteSocialReply, editSocialReply } from '@/server/leagues/social/socialCommands';

import { readSocialJson, withLeagueSocialRoute } from '../../socialRoute';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; replyId: string }> }
) {
  return withLeagueSocialRoute(request, params, async ({ leagueId, userId, params: values }) =>
    editSocialReply(leagueId, userId, values.replyId, await readSocialJson(request))
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; replyId: string }> }
) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId, params: values }) =>
    deleteSocialReply(leagueId, userId, values.replyId)
  );
}
