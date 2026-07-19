import { prisma } from '@/lib/prisma';
import { adminDb } from '@/lib/firebaseAdmin';
import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership';

export interface LeagueMembershipAccess {
  leagueId: string;
  userId: string;
  memberId?: string;
  role?: string;
  isMember: boolean;
  canManage: boolean;
}

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

  if (prismaLeague) {
    const member = prismaLeague.members[0];
    if (!member || !isActivePrismaMembership(member)) {
      return {
        leagueId,
        userId,
        isMember: false,
        canManage: false,
      };
    }

    const isOwner = prismaLeague.ownerId === userId;
    const role = member.role;
    const canManage = isOwner || member.isCoCommissioner;

    return {
      leagueId,
      userId,
      memberId: member.id,
      role,
      isMember: true,
      canManage,
    };
  }

  const membership = await getLeagueMembership(leagueId, userId);
  const firestoreOwner = await isFirestoreLeagueOwner(leagueId, userId);

  if (!membership.isMember) {
    return {
      leagueId,
      userId,
      ...(firestoreOwner ? { role: 'owner' } : {}),
      isMember: firestoreOwner,
      canManage: firestoreOwner,
    };
  }

  const role = typeof membership.data?.role === 'string' ? membership.data.role : undefined;
  const canManage = isLeagueManagerRole(role) || firestoreOwner;

  return {
    leagueId,
    userId,
    ...(membership.memberDocId ? { memberId: membership.memberDocId } : {}),
    ...(role ? { role } : {}),
    isMember: true,
    canManage,
  };
}

function isActivePrismaMembership(member: { isActive: boolean; status: string }): boolean {
  if (!member.isActive) {
    return false;
  }

  return !['declined', 'inactive', 'removed'].includes(member.status.trim().toLowerCase());
}

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

async function isFirestoreLeagueOwner(leagueId: string, userId: string): Promise<boolean> {
  const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
  if (!leagueDoc.exists) {
    return false;
  }

  return leagueDoc.data()?.ownerId === userId;
}
