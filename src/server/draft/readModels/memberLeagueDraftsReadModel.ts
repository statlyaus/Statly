import type { DraftStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { isActivePrismaMembership } from '@/server/leagues/activeMembership';

export interface MemberLeagueDraft {
  id: string;
  status: DraftStatus;
  leagueId: string;
  leagueName: string;
  startAt: Date | null;
  timeZone: string;
  createdAt: Date;
}

const MAX_DRAFTS = 50;

/** Drafts of the leagues the user has an active team in, newest first. */
export async function listMemberLeagueDrafts(userId: string): Promise<MemberLeagueDraft[]> {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    select: { leagueId: true, isActive: true, status: true },
  });
  const leagueIds = memberships.filter(isActivePrismaMembership).map((m) => m.leagueId);
  if (leagueIds.length === 0) return [];

  const drafts = await prisma.draft.findMany({
    where: { leagueId: { in: leagueIds } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      league: {
        select: { id: true, name: true, settings: { select: { startAt: true, timeZone: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_DRAFTS,
  });

  return drafts.map((draft) => ({
    id: draft.id,
    status: draft.status,
    leagueId: draft.league.id,
    leagueName: draft.league.name,
    startAt: draft.league.settings.startAt,
    timeZone: draft.league.settings.timeZone,
    createdAt: draft.createdAt,
  }));
}
