import type { Prisma } from '@prisma/client';

import { isActivePrismaMembership } from './activeMembership';
import { requireActiveSeasonId } from './activeSeason';

// BR-30 with E7: from a bite's grant until it is done, its victim cannot add or drop players,
// propose, accept or counter trades, or have a waiver claim settle. The freeze lasts until every
// open bite on that member is done.
//
// E12 (#1355): the freeze starts when the round ends, not at the grant. The bite is granted in the
// transaction that makes the round FINAL, so the only time before the grant is between the round's
// end and its scoring, when the loser is not known yet. For that time the Bloodsucker's opponent is
// frozen whatever the score (`BLOODSUCKER_RESULT_PENDING`); a FINAL result then either grants the
// bite (`BITE_PENDING` takes over) or frees the team.

export const BITE_PENDING_MESSAGE =
  'The Bloodsucker has a bite on your team waiting. You can add, drop and trade players once it is done.';

export const BLOODSUCKER_RESULT_PENDING_MESSAGE =
  'Your matchup against the Bloodsucker has ended and is being scored. You can add, drop and trade players once the result is final, or once the bite is done if the Bloodsucker won.';

/** For whoever completes a trade with a team in that state: the other team, a commissioner, the cron. */
export const BLOODSUCKER_RESULT_PENDING_TRADE_HELD_MESSAGE =
  'A team in this trade has just played the Bloodsucker and the result is not final. The trade can complete once it is, or once the bite is done if the Bloodsucker won.';

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
type FreezeReader = BiteReader & Pick<Prisma.TransactionClient, 'leagueSettings' | 'leagueMatchup'>;

export type BiteFreezeCode = 'BITE_PENDING' | 'BLOODSUCKER_RESULT_PENDING';
export interface BiteFreeze {
  code: BiteFreezeCode;
  /** For the frozen member's own add, drop or trade. */
  message: string;
  /** For a trade somebody else is completing with the frozen member. */
  tradeHeldMessage: string;
}

/**
 * Why this member cannot add, drop or trade right now because of the Bloodsucker, or null (BR-30,
 * E12). Read it under the League row lock when the answer guards a roster write: the grant and the
 * bite take the same lock.
 */
export async function findBiteFreeze(
  db: FreezeReader,
  leagueId: string,
  memberId: string,
  now: Date = new Date()
): Promise<BiteFreeze | null> {
  if (await hasPendingBite(db, leagueId, memberId)) {
    return {
      code: 'BITE_PENDING',
      message: BITE_PENDING_MESSAGE,
      tradeHeldMessage: BITE_PENDING_TRADE_HELD_MESSAGE,
    };
  }
  if ((await listMembersAwaitingBloodsuckerResult(db, leagueId, now, memberId)).length > 0) {
    return {
      code: 'BLOODSUCKER_RESULT_PENDING',
      message: BLOODSUCKER_RESULT_PENDING_MESSAGE,
      tradeHeldMessage: BLOODSUCKER_RESULT_PENDING_TRADE_HELD_MESSAGE,
    };
  }
  return null;
}

/** Every member frozen by the Bloodsucker right now, with the reason, for read models. */
export async function listBiteFrozenMembers(
  db: FreezeReader,
  leagueId: string,
  now: Date = new Date()
): Promise<Map<string, BiteFreezeCode>> {
  const seasonId = await requireActiveSeasonId(db, leagueId);
  const [bites, awaiting] = await Promise.all([
    db.leagueBite.findMany({
      where: { leagueId, seasonId, status: { in: ['OPEN', 'WAITING_LOCK'] } },
      select: { victimMemberId: true },
    }),
    listMembersAwaitingBloodsuckerResult(db, leagueId, now),
  ]);
  return new Map<string, BiteFreezeCode>([
    ...awaiting.map((memberId) => [memberId, 'BLOODSUCKER_RESULT_PENDING'] as const),
    ...bites.map((bite) => [bite.victimMemberId, 'BITE_PENDING'] as const),
  ]);
}

/**
 * The members whose regular-season matchup against the Bloodsucker has ended (its round's end time
 * has passed) but is not FINAL, on the league's current fixture in its active season. With
 * `onlyMemberId`, that member or nobody.
 */
async function listMembersAwaitingBloodsuckerResult(
  db: FreezeReader,
  leagueId: string,
  now: Date,
  onlyMemberId?: string
): Promise<string[]> {
  const settings = await db.leagueSettings.findFirst({
    where: { league: { id: leagueId } },
    select: {
      leagueFormat: true,
      competitionRulesVersion: true,
      bloodsuckerMember: { select: { id: true, isActive: true, status: true } },
    },
  });
  const bloodsucker = settings?.bloodsuckerMember;
  if (
    !settings ||
    settings.leagueFormat !== 'BLOODSUCKER' ||
    settings.competitionRulesVersion < 1 ||
    !bloodsucker ||
    !isActivePrismaMembership(bloodsucker) ||
    bloodsucker.id === onlyMemberId
  ) {
    return [];
  }
  const seasonId = await requireActiveSeasonId(db, leagueId);
  const unscored = await db.leagueMatchup.findMany({
    where: {
      leagueId,
      fixtureVersion: settings.competitionRulesVersion,
      phase: 'REGULAR',
      status: { not: 'FINAL' },
      OR: [
        { homeMemberId: bloodsucker.id, awayMemberId: onlyMemberId ?? { not: null } },
        { homeMemberId: onlyMemberId ?? { not: null }, awayMemberId: bloodsucker.id },
      ],
      competitionRound: {
        seasonId,
        status: { notIn: ['FINAL', 'NO_MATCHUP'] },
        endsAt: { lte: now },
      },
    },
    select: { homeMemberId: true, awayMemberId: true },
  });
  return unscored.flatMap((matchup) => {
    const opponent =
      matchup.homeMemberId === bloodsucker.id ? matchup.awayMemberId : matchup.homeMemberId;
    return opponent ? [opponent] : [];
  });
}

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
