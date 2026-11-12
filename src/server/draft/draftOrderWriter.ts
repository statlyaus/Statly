import type { Prisma } from '@prisma/client';

import { splitDraftingMembers } from '@/server/leagues/leagueFormat';

type FormatSettings = { leagueFormat: string; bloodsuckerMemberId: string | null };

/**
 * Writes a league's draft order from its active members, already in draft order. The drafters get
 * slots 1..n in the order and on their membership; a Bloodsucker (BR-09) is left out of the order and
 * takes membership slot n+1, which orders fixtures, tie-breaks and the dashboard but never picks.
 * Slots are always contiguous, because a turn is found by its slot. With no draft only the membership
 * slots are written.
 */
export async function writeDraftOrder(
  tx: Prisma.TransactionClient,
  input: {
    draftId: string | null;
    members: ReadonlyArray<{ id: string; draftSlot: number | null }>;
    settings: FormatSettings | null | undefined;
  }
): Promise<{ drafterCount: number; hasBloodsucker: boolean }> {
  const { drafters, bloodsucker } = splitDraftingMembers(input.members, input.settings);
  const slotted = bloodsucker ? [...drafters, bloodsucker] : drafters;
  await Promise.all(
    slotted.map((member, index) =>
      member.draftSlot === index + 1
        ? null
        : tx.leagueMember.update({ where: { id: member.id }, data: { draftSlot: index + 1 } })
    )
  );

  if (input.draftId) {
    await tx.draftOrder.deleteMany({ where: { draftId: input.draftId } });
    await tx.draftOrder.createMany({
      data: drafters.map((member, index) => ({
        draftId: input.draftId as string,
        memberId: member.id,
        slot: index + 1,
      })),
    });
  }
  return { drafterCount: drafters.length, hasBloodsucker: bloodsucker !== null };
}
