import type { Prisma, PrismaClient } from '@prisma/client';
import { LeagueRole } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';

import { isActivePrismaMembership } from './activeMembership';
import { hasDraftStarted } from './memberCommands';

export interface CommissionerLeagueMember {
  userId: string;
  teamName: string;
  managerName: string | null;
  isOwner: boolean;
  joinedAt: string;
}

export interface CommissionerLeague {
  id: string;
  name: string;
  inviteCode: string;
  maxTeams: number;
  /** Mirrors the removeLeagueMember rule so the page can explain it; the command still enforces it. */
  memberRemovalOpen: boolean;
  members: CommissionerLeagueMember[];
}

const commissionerLeagueSelect = {
  id: true,
  name: true,
  inviteCode: true,
  settings: { select: { maxTeams: true } },
  drafts: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      status: true,
      startedAt: true,
      lobbyStatus: true,
      _count: { select: { picks: true } },
    },
  },
  members: {
    orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
    select: {
      userId: true,
      teamName: true,
      role: true,
      isActive: true,
      status: true,
      joinedAt: true,
      user: { select: { displayName: true } },
    },
  },
} satisfies Prisma.LeagueSelect;

type CommissionerClient = { league: Pick<PrismaClient['league'], 'findMany'> };

/** Leagues the user owns, which are the leagues whose members they may remove or hand over. */
export async function loadCommissionerLeagues(
  userId: string,
  client: CommissionerClient = defaultPrisma
): Promise<CommissionerLeague[]> {
  const leagues = await client.league.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
    select: commissionerLeagueSelect,
  });

  return leagues.map((league) => ({
    id: league.id,
    name: league.name,
    inviteCode: league.inviteCode,
    maxTeams: league.settings.maxTeams,
    memberRemovalOpen: !hasDraftStarted(league.drafts[0]),
    members: league.members.filter(isActivePrismaMembership).map((member) => ({
      userId: member.userId,
      teamName: member.teamName,
      managerName: member.user?.displayName ?? null,
      isOwner: member.role === LeagueRole.OWNER || member.userId === userId,
      joinedAt: member.joinedAt.toISOString(),
    })),
  }));
}
