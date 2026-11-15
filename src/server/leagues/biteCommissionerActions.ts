// What a commissioner may do to a Bloodsucker bite (BR-35, E1), as a pure rule the screens and the
// read model share. No `server-only` import: client components read it too. It decides what to
// offer; `commissionerBiteAction` in `bloodsuckerBites.ts` still decides what is allowed.

export type BiteCommissionerAction = 'cancel' | 'redo';

const OPEN_STATUSES = ['OPEN', 'WAITING_LOCK'];
const EXECUTED_STATUSES = ['EXECUTED', 'AUTO_EXECUTED'];

export const BITE_PARTY_MESSAGE =
  'You are part of this bite, so another commissioner or the owner must change it.';

/**
 * Cancel on an open or executed bite, redo on an executed one; nothing for a non-commissioner, for
 * either side of the bite, or for a bite in any other (finished or unknown) status.
 */
export function commissionerBiteActions(
  bite: { status: string; bloodsuckerMemberId: string; victimMemberId: string },
  viewer: { memberId: string; isCommissioner: boolean }
): BiteCommissionerAction[] {
  if (!viewer.isCommissioner) return [];
  if (viewer.memberId === bite.bloodsuckerMemberId || viewer.memberId === bite.victimMemberId) {
    return [];
  }
  if (EXECUTED_STATUSES.includes(bite.status)) return ['cancel', 'redo'];
  return OPEN_STATUSES.includes(bite.status) ? ['cancel'] : [];
}
