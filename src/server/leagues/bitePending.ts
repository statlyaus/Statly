import type { Prisma } from '@prisma/client';

// BR-30 with E7: from a bite's grant until it is done, its victim cannot drop players, propose,
// accept or counter trades, or have a waiver claim that drops a player settle. The freeze lasts until
// every open bite on that member is done.

export const BITE_PENDING_MESSAGE =
  'The Bloodsucker has a bite on your team waiting. You can drop players and trade once it is done.';

export class BitePendingError extends Error {
  readonly code = 'BITE_PENDING' as const;
  readonly status = 409 as const;
  constructor() {
    super(BITE_PENDING_MESSAGE);
    this.name = 'BitePendingError';
  }
}

/** True while a bite on this member is OPEN or WAITING_LOCK. */
export async function hasPendingBite(
  db: Pick<Prisma.TransactionClient, 'leagueBite'>,
  leagueId: string,
  memberId: string
): Promise<boolean> {
  const pending = await db.leagueBite.findFirst({
    where: { leagueId, victimMemberId: memberId, status: { in: ['OPEN', 'WAITING_LOCK'] } },
    select: { id: true },
  });
  return pending !== null;
}
