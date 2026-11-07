import { prisma } from '@/lib/prisma';

import { isActivePrismaMembership } from './activeMembership';

export interface LeagueMembershipAccess {
  leagueId: string;
  userId: string;
  memberId?: string;
  role?: string;
  isMember: boolean;
  canManage: boolean;
}

/**
 * Resolves a caller's membership and management rights from Prisma alone. A league with no Prisma
 * row, or a user with no active Prisma membership, is not a member: Firestore member and league
 * documents are a compatibility projection and never decide access.
 */
export async function getLeagueMembershipAccess(
  leagueId: string,
  userId: string
): Promise<LeagueMembershipAccess> {
  const prismaLeague = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      ownerId: true,
      members: {
        where: { userId },
        select: {
          id: true,
          role: true,
          isActive: true,
          status: true,
          isCoCommissioner: true,
        },
        take: 1,
      },
    },
  });

  const member = prismaLeague?.members[0];
  if (!prismaLeague || !member || !isActivePrismaMembership(member)) {
    return {
      leagueId,
      userId,
      isMember: false,
      canManage: false,
    };
  }

  return {
    leagueId,
    userId,
    memberId: member.id,
    role: member.role,
    isMember: true,
    canManage: prismaLeague.ownerId === userId || member.isCoCommissioner,
  };
}

export { isActivePrismaMembership };

export async function canManageLeague(leagueId: string, userId: string): Promise<boolean> {
  return (await getLeagueMembershipAccess(leagueId, userId)).canManage;
}

export async function getDraftMembershipAccess(
  draftId: string,
  userId: string
): Promise<LeagueMembershipAccess> {
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    select: { leagueId: true },
  });

  if (!draft?.leagueId) {
    return {
      leagueId: '',
      userId,
      isMember: false,
      canManage: false,
    };
  }

  return getLeagueMembershipAccess(draft.leagueId, userId);
}
