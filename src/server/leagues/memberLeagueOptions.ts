import { prisma } from '@/lib/prisma';

import { isActivePrismaMembership } from './membership';

export interface MemberLeagueOption {
  id: string;
  name: string;
}

/** Leagues the user currently has a team in, most recently joined first. */
export async function loadMemberLeagueOptions(userId: string): Promise<MemberLeagueOption[]> {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'desc' },
    select: { isActive: true, status: true, league: { select: { id: true, name: true } } },
  });

  return memberships.filter(isActivePrismaMembership).map((membership) => membership.league);
}
