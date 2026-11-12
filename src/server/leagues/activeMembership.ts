const INACTIVE_MEMBERSHIP_STATUSES = ['declined', 'inactive', 'removed'];

/** A Prisma league member still occupies a team only while active and not declined or removed. */
export function isActivePrismaMembership(member: { isActive: boolean; status: string }): boolean {
  if (!member.isActive) {
    return false;
  }

  return !INACTIVE_MEMBERSHIP_STATUSES.includes(member.status.trim().toLowerCase());
}

/** The member fields `leagueManagerUserIds` reads; use as a Prisma `select`. */
export const LEAGUE_MANAGER_MEMBER_SELECT = {
  userId: true,
  isCoCommissioner: true,
  isActive: true,
  status: true,
} as const;

/**
 * Users who may manage the league (and so its draft): the owner and co-commissioners, while each is
 * an active member. Same rule as `getLeagueMembershipAccess().canManage`, and independent of the
 * draft order, so a commissioner who never picks (the Bloodsucker, #1279) keeps the controls.
 */
export function leagueManagerUserIds(league: {
  ownerId: string;
  members: Array<{ userId: string; isCoCommissioner: boolean; isActive: boolean; status: string }>;
}): string[] {
  return league.members
    .filter(
      (member) =>
        isActivePrismaMembership(member) &&
        (member.userId === league.ownerId || member.isCoCommissioner)
    )
    .map((member) => member.userId);
}
