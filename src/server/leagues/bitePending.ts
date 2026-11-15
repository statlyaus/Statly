import type { Prisma } from '@prisma/client';

import { requireActiveSeasonId } from './activeSeason';

// BR-30 with E7: from a bite's grant until it is done, its victim cannot drop players, propose,
// accept or counter trades, or have a waiver claim that drops a player settle. The freeze lasts until
// every open bite on that member is done.

export const BITE_PENDING_MESSAGE =
  'The Bloodsucker has a bite on your team waiting. You can drop players and trade once it is done.';

/** For whoever completes a trade with a frozen team: the other team, a commissioner, the cron. */
export const BITE_PENDING_TRADE_HELD_MESSAGE =
  'The Bloodsucker has a bite waiting on a team in this trade. The trade can complete once it is done.';

export class BitePendingError extends Error {
  readonly code = 'BITE_PENDING' as const;
  readonly status = 409 as const;
  constructor() {
    super(BITE_PENDING_MESSAGE);
    this.name = 'BitePendingError';
  }
}

type BiteReader = Pick<Prisma.TransactionClient, 'leagueBite' | 'league'>;

/** True while a bite on this member is OPEN or WAITING_LOCK in the league's active season. */
export async function hasPendingBite(
  db: BiteReader,
  leagueId: string,
  memberId: string
): Promise<boolean> {
  const seasonId = await requireActiveSeasonId(db, leagueId);
  const pending = await db.leagueBite.findFirst({
    where: {
      leagueId,
      seasonId,
      victimMemberId: memberId,
      status: { in: ['OPEN', 'WAITING_LOCK'] },
    },
    select: { id: true },
  });
  return pending !== null;
}

export const LAST_PLAYER_BITE_HELD_MESSAGE =
  'You have a bite to make and it needs a player to send back, so you cannot drop your last player until the bite is done.';

/**
 * True while this member is the Bloodsucker of a bite that is OPEN or WAITING_LOCK in the league's
 * active season. Such a member keeps at least one player: a bite is one for one (BR-22), so an empty
 * roster would leave it with nothing to return (#1343).
 */
export async function holdsUnexecutedBite(
  db: BiteReader,
  leagueId: string,
  memberId: string
): Promise<boolean> {
  const seasonId = await requireActiveSeasonId(db, leagueId);
  const held = await db.leagueBite.findFirst({
    where: {
      leagueId,
      seasonId,
      bloodsuckerMemberId: memberId,
      status: { in: ['OPEN', 'WAITING_LOCK'] },
    },
    select: { id: true },
  });
  return held !== null;
}
