// Bloodsucker 4/9 (#1281, BR-15, BR-16): in a Bloodsucker league the Bloodsucker is pinned at waiver
// priority 1. Winning a claim never moves it, and every other member rotates from 2. Standard
// leagues have no pinned member, so their order is unchanged.

import type { Prisma } from '@prisma/client';

import { isActivePrismaMembership } from '@/server/leagues/activeMembership';
import { resolveBloodsuckerMemberId } from '@/server/leagues/leagueFormat';

/** The member pinned at waiver priority 1: the league's active Bloodsucker, or null. */
export async function loadPinnedPriorityMemberId(
  db: Pick<Prisma.TransactionClient, 'league'>,
  leagueId: string
): Promise<string | null> {
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: {
      settings: { select: { leagueFormat: true, bloodsuckerMemberId: true } },
      members: { select: { id: true, isActive: true, status: true } },
    },
  });
  if (!league?.settings) return null;
  return resolveBloodsuckerMemberId(
    league.settings,
    (league.members ?? []).filter(isActivePrismaMembership).map((member) => member.id)
  );
}

/** The given order with the pinned member moved to the front; unchanged when nothing is pinned. */
export function withPinnedFirst<T>(ordered: readonly T[], pinned: T | null | undefined): T[] {
  if (pinned === null || pinned === undefined) return [...ordered];
  return [pinned, ...ordered.filter((item) => item !== pinned)];
}
