import { prisma } from '@/lib/prisma';

export type MembershipSource = 'embedded' | 'none';

export interface MembershipCheckResult {
  isMember: boolean;
  source: MembershipSource;
  /**
   * Identifier associated with the member document.
   * For embedded membership, this is the `userId`.
   * For legacy membership, this is the legacy team/document id (often `leagueId_userId`).
   */
  memberDocId?: string;
}

/**
 * Verify whether a given user is a member of the specified league.
 * Prisma is the canonical league membership source.
 */
export async function verifyLeagueMembership(
  leagueId: string,
  userId: string
): Promise<MembershipCheckResult> {
  const member = await prisma.leagueMember.findFirst({
    where: {
      leagueId,
      userId,
    },
    select: {
      id: true,
      userId: true,
    },
  });
  if (member) {
    return { isMember: true, source: 'embedded', memberDocId: member.userId };
  }

  return { isMember: false, source: 'none' };
}

/**
 * Ensures membership or throws a standard error. Useful when callers prefer exceptions.
 */
export async function assertLeagueMember(
  leagueId: string,
  userId: string
): Promise<Exclude<MembershipCheckResult, { isMember: false }>> {
  const result = await verifyLeagueMembership(leagueId, userId);
  if (!result.isMember) {
    const error = new Error('FORBIDDEN_NOT_LEAGUE_MEMBER');
    // @ts-expect-error attach metadata for upstream handlers
    error.status = 403;
    throw error;
  }
  return result as Exclude<MembershipCheckResult, { isMember: false }>;
}
