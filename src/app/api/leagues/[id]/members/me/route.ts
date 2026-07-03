import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { getLeagueMembership, queueLeagueMembershipPatch } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  normalizeTeamSymbolPosition,
  normalizeTeamSymbolUrl,
  normalizeTeamSymbolZoom,
} from '@/lib/teamSymbol';

function parseTeamLogoUrl(body: Record<string, unknown>): string | null {
  const teamLogoUrl = normalizeTeamSymbolUrl(body.teamLogoUrl);
  return teamLogoUrl;
}

function parseTeamLogoPosition(body: Record<string, unknown>) {
  return {
    teamLogoPositionX: normalizeTeamSymbolPosition(body.teamLogoPositionX),
    teamLogoPositionY: normalizeTeamSymbolPosition(body.teamLogoPositionY),
    teamLogoZoom: normalizeTeamSymbolZoom(body.teamLogoZoom),
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 });
    }

    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await getLeagueMembership(id, userId);
    if (!membership.isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    let teamLogoUrl: string | null;
    let teamLogoPositionX: number;
    let teamLogoPositionY: number;
    let teamLogoZoom: number;
    try {
      teamLogoUrl = parseTeamLogoUrl(body);
      ({ teamLogoPositionX, teamLogoPositionY, teamLogoZoom } = parseTeamLogoPosition(body));
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ error: 'Invalid team symbol' }, { status: 400 });
    }

    if (membership.source === 'prisma' && membership.memberDocId) {
      const updatedMember = await prisma.leagueMember.update({
        where: { id: membership.memberDocId },
        data: { teamLogoUrl, teamLogoPositionX, teamLogoPositionY, teamLogoZoom },
        select: {
          id: true,
          leagueId: true,
          userId: true,
          role: true,
          teamName: true,
          teamLogoUrl: true,
          teamLogoPositionX: true,
          teamLogoPositionY: true,
          teamLogoZoom: true,
          joinedAt: true,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          member: {
            id: updatedMember.id,
            leagueId: updatedMember.leagueId,
            userId: updatedMember.userId,
            role: String(updatedMember.role).toLowerCase(),
            teamName: updatedMember.teamName,
            teamLogoUrl: updatedMember.teamLogoUrl ?? undefined,
            teamLogoPositionX: updatedMember.teamLogoPositionX ?? undefined,
            teamLogoPositionY: updatedMember.teamLogoPositionY ?? undefined,
            teamLogoZoom: updatedMember.teamLogoZoom ?? undefined,
            joinedAt: updatedMember.joinedAt.toISOString(),
            isActive: true,
          },
        },
      });
    }

    const batch = adminDb.batch();
    queueLeagueMembershipPatch(batch, id, userId, {
      teamLogoUrl,
      teamLogoPositionX,
      teamLogoPositionY,
      teamLogoZoom,
    });
    await batch.commit();

    return NextResponse.json({
      success: true,
      data: {
        member: {
          id: membership.memberDocId ?? userId,
          leagueId: id,
          userId,
          role: typeof membership.data?.role === 'string' ? membership.data.role : 'member',
          teamName: typeof membership.data?.teamName === 'string' ? membership.data.teamName : 'Team',
          teamLogoUrl: teamLogoUrl ?? undefined,
          teamLogoPositionX,
          teamLogoPositionY,
          teamLogoZoom,
          joinedAt:
            typeof membership.data?.joinedAt === 'string'
              ? membership.data.joinedAt
              : new Date().toISOString(),
          isActive: true,
        },
      },
    });
  } catch (error) {
    logger.error('Error updating league member identity:', error);
    return NextResponse.json({ error: 'Failed to update team identity' }, { status: 500 });
  }
}
