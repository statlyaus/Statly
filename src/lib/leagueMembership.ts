import { adminDb } from '@/lib/firebaseAdmin';

export type MembershipSource = 'embedded' | 'legacy' | 'none';

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
 * Checks the canonical embedded doc first, then falls back to the legacy global collection.
 */
export async function verifyLeagueMembership(leagueId: string, userId: string): Promise<MembershipCheckResult> {
  // Prefer per-league embedded membership document
  const embeddedRef = adminDb.doc(`leagues/${leagueId}/members/${userId}`);
  const embeddedSnap = await embeddedRef.get();
  if (embeddedSnap.exists) {
    return { isMember: true, source: 'embedded', memberDocId: embeddedSnap.id };
  }

  // Fallback: legacy membership collection
  const legacySnap = await adminDb
    .collection('leagueMembers')
    .where('leagueId', '==', leagueId)
    .where('userId', '==', userId)
    .limit(1)
    .get();
  if (!legacySnap.empty) {
    const doc = legacySnap.docs[0];
    return { isMember: true, source: 'legacy', memberDocId: doc.id };
  }

  return { isMember: false, source: 'none' };
}

/**
 * Ensures membership or throws a standard error. Useful when callers prefer exceptions.
 */
export async function assertLeagueMember(leagueId: string, userId: string): Promise<Exclude<MembershipCheckResult, { isMember: false }>> {
  const result = await verifyLeagueMembership(leagueId, userId);
  if (!result.isMember) {
    const error = new Error('FORBIDDEN_NOT_LEAGUE_MEMBER');
    // @ts-expect-error attach metadata for upstream handlers
    error.status = 403;
    throw error;
  }
  return result as Exclude<MembershipCheckResult, { isMember: false }>;
}


