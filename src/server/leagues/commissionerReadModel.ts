import type { Prisma, PrismaClient } from '@prisma/client';
import { LeagueRole } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';

import { isActivePrismaMembership } from './activeMembership';
import { memberRemovalBlock } from './memberCommands';

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
  /** Why removal is closed (the command's own message), or null while it is open. */
  memberRemovalClosedReason: string | null;
  members: CommissionerLeagueMember[];
}

const commissionerLeagueSelect = {
  id: true,
  name: true,
  inviteCode: true,
  settings: { select: { maxTeams: true, competitionPublishedAt: true } },
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

function memberRemovalState(
  draft: Parameters<typeof memberRemovalBlock>[0],
  competitionPublishedAt: Date | null
): Pick<CommissionerLeague, 'memberRemovalOpen' | 'memberRemovalClosedReason'> {
  const block = memberRemovalBlock(draft, competitionPublishedAt);
  return { memberRemovalOpen: block === null, memberRemovalClosedReason: block?.message ?? null };
}

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
    ...memberRemovalState(league.drafts[0], league.settings.competitionPublishedAt),
    members: league.members.filter(isActivePrismaMembership).map((member) => ({
      userId: member.userId,
      teamName: member.teamName,
      managerName: member.user?.displayName ?? null,
      isOwner: member.role === LeagueRole.OWNER || member.userId === userId,
      joinedAt: member.joinedAt.toISOString(),
    })),
  }));
}
