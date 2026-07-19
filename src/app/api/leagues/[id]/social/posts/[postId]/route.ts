import type { NextRequest } from 'next/server';

import { deleteSocialPost, editSocialPost } from '@/server/leagues/social/socialCommands';
import { getSocialPostThread } from '@/server/leagues/social/socialQueries';
import { parseSocialPageSize } from '@/server/leagues/social/socialValidation';

import { readSocialJson, withLeagueSocialRoute } from '../../socialRoute';

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  return withLeagueSocialRoute(request, params, async ({ leagueId, userId, params: values }) =>
    editSocialPost(leagueId, userId, values.postId, await readSocialJson(request))
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  return withLeagueSocialRoute(request, params, ({ leagueId, userId, params: values }) =>
    deleteSocialPost(leagueId, userId, values.postId)
  );
}
