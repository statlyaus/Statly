const INACTIVE_MEMBERSHIP_STATUSES = ['declined', 'inactive', 'removed'];

/** A Prisma league member still occupies a team only while active and not declined or removed. */
export function isActivePrismaMembership(member: { isActive: boolean; status: string }): boolean {
  if (!member.isActive) {
    return false;
  }

  return !INACTIVE_MEMBERSHIP_STATUSES.includes(member.status.trim().toLowerCase());
}
