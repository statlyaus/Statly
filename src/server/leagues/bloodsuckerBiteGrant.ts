import type { LeagueBiteStatus, Prisma } from '@prisma/client';

// Bloodsucker bite rights (Bloodsucker 6/9, #1283; BR-17 to BR-20, BR-27, BR-33; owner decisions E4,
// E5, E9). A right is granted, reactivated, cancelled or noted inside the scoring transaction that
// writes a matchup's result, so the grant and the FINAL result commit together. No `server-only`
// import: the scoring read model reaches it.

const HOUR_MS = 60 * 60 * 1000;
export const BITE_DEADLINE_HOURS = 48;
export const BITE_DEADLINE_LOCK_BUFFER_HOURS = 2;
/** E4: a bite never auto-runs sooner than this after its grant, however late the grant was. */
export const BITE_DEADLINE_MIN_HOURS = 24;

/**
 * BR-27 with E4 and E9: the earlier of 48 hours after the grant or 2 hours before the next regular
 * round's first lock, but never sooner than 24 hours after the grant. No next regular round (a grant
 * in the last regular round) or an unknown start gives 48 hours.
 */
export function computeBiteDeadline(input: {
  grantedAt: Date;
  nextRoundFirstLockAt: Date | null;
}): Date {
  const granted = input.grantedAt.getTime();
  const byClock = granted + BITE_DEADLINE_HOURS * HOUR_MS;
  const byLock = input.nextRoundFirstLockAt
    ? input.nextRoundFirstLockAt.getTime() - BITE_DEADLINE_LOCK_BUFFER_HOURS * HOUR_MS
    : byClock;
  return new Date(Math.max(Math.min(byClock, byLock), granted + BITE_DEADLINE_MIN_HOURS * HOUR_MS));
}

export type BiteCancelledBy = 'RESULT_CHANGED' | 'COMMISSIONER';

export interface BiteGrantMatchup {
  status: string;
  phase: string;
  homeMemberId: string | null;
  awayMemberId: string | null;
  winnerMemberId: string | null;
}

export type BiteGrantChange =
  | {
      kind: 'GRANT' | 'REACTIVATE';
      victimMemberId: string;
      trigger: 'FINAL' | 'GRANTED_ON_RESCORE';
    }
  | { kind: 'CANCEL' | 'RESULT_CHANGED'; victimMemberId: string };

const UNEXECUTED: readonly LeagueBiteStatus[] = ['OPEN', 'WAITING_LOCK'];
const EXECUTED: readonly LeagueBiteStatus[] = ['EXECUTED', 'AUTO_EXECUTED'];

/**
 * What one scored matchup does to its bite right.
 * - A FINAL REGULAR matchup the Bloodsucker won grants a right once (BR-17, BR-19). A draw, a bye, a
 *   loss or a finals matchup grants nothing (BR-18).
 * - A re-score that turns a loss or draw into a win grants, or reactivates a right an earlier
 *   re-score cancelled, so win-loss-win gives one bite (E4). A commissioner's cancel is never undone.
 * - A re-score that takes the win away cancels an unexecuted right; an executed bite stands and the
 *   change is only recorded (BR-33, BR-36).
 * - A matchup that is not FINAL changes nothing: its right waits until it is FINAL again (E5).
 */
export function planBiteGrantChange(input: {
  bloodsuckerMemberId: string;
  matchup: BiteGrantMatchup;
  /** The winner stored before this run, when the matchup was already FINAL. */
  previousWinnerMemberId?: string | null;
  existing: ExistingBite | null;
}): BiteGrantChange | null {
  const { bloodsuckerMemberId: bs, matchup, existing } = input;
  const victimMemberId = bloodsuckerOpponent(matchup, bs);
  if (!victimMemberId) return null;
  const flipped =
    input.previousWinnerMemberId !== undefined &&
    input.previousWinnerMemberId !== matchup.winnerMemberId;
  return matchup.winnerMemberId === bs
    ? planForWin(victimMemberId, flipped, existing)
    : planForNoWin(victimMemberId, flipped, existing);
}

type ExistingBite = { status: LeagueBiteStatus; cancelledBy: string | null };

/** The Bloodsucker's opponent in a FINAL, REGULAR, two-team matchup it plays in; else null. */
function bloodsuckerOpponent(matchup: BiteGrantMatchup, bs: string): string | null {
  if (matchup.status !== 'FINAL' || matchup.phase !== 'REGULAR') return null;
  const { homeMemberId: home, awayMemberId: away } = matchup;
  if (!home || !away) return null;
  if (home === bs) return away;
  return away === bs ? home : null;
}

function planForWin(
  victimMemberId: string,
  flipped: boolean,
  existing: ExistingBite | null
): BiteGrantChange | null {
  if (!existing) {
    return { kind: 'GRANT', victimMemberId, trigger: flipped ? 'GRANTED_ON_RESCORE' : 'FINAL' };
  }
  const cancelledByResult =
    existing.status === 'CANCELLED' && existing.cancelledBy === 'RESULT_CHANGED';
  return cancelledByResult
    ? { kind: 'REACTIVATE', victimMemberId, trigger: 'GRANTED_ON_RESCORE' }
    : null;
}

function planForNoWin(
  victimMemberId: string,
  flipped: boolean,
  existing: ExistingBite | null
): BiteGrantChange | null {
  if (!existing) return null;
  if (UNEXECUTED.includes(existing.status)) return { kind: 'CANCEL', victimMemberId };
  return EXECUTED.includes(existing.status) && flipped
    ? { kind: 'RESULT_CHANGED', victimMemberId }
    : null;
}

type GrantClient = Pick<
  Prisma.TransactionClient,
  'leagueBite' | 'leagueCompetitionAudit' | 'leagueCompetitionRound'
>;

export interface ScoredBiteMatchup extends BiteGrantMatchup {
  id: string;
  competitionRoundId: string | null;
}

/**
 * Applies `planBiteGrantChange` to every scored matchup, inside the caller's scoring transaction
 * (which holds the League row lock). Each change writes one competition audit row (BR-38).
 */
export async function syncBloodsuckerBites(
  tx: GrantClient,
  input: {
    leagueId: string;
    seasonId: string;
    round: number;
    fixtureVersion: number;
    bloodsuckerMemberId: string;
    /** The commissioner who ran the recalculation; null for the scheduled job. */
    actorMemberId: string | null;
    matchups: readonly ScoredBiteMatchup[];
    /** Winners stored before this run, for matchups that were already FINAL. */
    previousWinners: ReadonlyMap<string, string | null>;
    now: Date;
  }
): Promise<void> {
  const candidates = input.matchups.filter(
    (matchup): matchup is ScoredBiteMatchup & { competitionRoundId: string } =>
      Boolean(matchup.competitionRoundId) &&
      (matchup.homeMemberId === input.bloodsuckerMemberId ||
        matchup.awayMemberId === input.bloodsuckerMemberId)
  );
  if (!candidates.length) return;

  const existingRows = await tx.leagueBite.findMany({
    where: { leagueId: input.leagueId, matchupId: { in: candidates.map((m) => m.id) } },
  });
  let deadline: Date | null = null;
  const biteDeadline = async () => {
    if (deadline) return deadline;
    const next = await tx.leagueCompetitionRound.findFirst({
      where: {
        leagueId: input.leagueId,
        fixtureVersion: input.fixtureVersion,
        phase: 'REGULAR',
        round: { gt: input.round },
        status: { not: 'NO_MATCHUP' },
      },
      orderBy: { round: 'asc' },
      select: { startsAt: true },
    });
    deadline = computeBiteDeadline({
      grantedAt: input.now,
      nextRoundFirstLockAt: next?.startsAt ?? null,
    });
    return deadline;
  };

  for (const matchup of candidates) {
    const existing =
      existingRows.find(
        (row) => row.matchupId === matchup.id && row.roundId === matchup.competitionRoundId
      ) ?? null;
    const change = planBiteGrantChange({
      bloodsuckerMemberId: input.bloodsuckerMemberId,
      matchup,
      previousWinnerMemberId: input.previousWinners.has(matchup.id)
        ? (input.previousWinners.get(matchup.id) ?? null)
        : undefined,
      existing,
    });
    if (!change) continue;

    const result = {
      before: input.previousWinners.has(matchup.id)
        ? { winnerMemberId: input.previousWinners.get(matchup.id) ?? null }
        : null,
      after: { winnerMemberId: matchup.winnerMemberId },
    };
    const audit = (
      biteId: string,
      eventType: 'BITE_GRANTED' | 'BITE_CANCELLED' | 'BITE_RESULT_CHANGED',
      extra: Record<string, unknown>
    ) =>
      tx.leagueCompetitionAudit.create({
        data: {
          leagueId: input.leagueId,
          actorMemberId: input.actorMemberId,
          eventType,
          payloadJson: JSON.parse(
            JSON.stringify({
              biteId,
              seasonId: input.seasonId,
              round: input.round,
              matchupId: matchup.id,
              bloodsuckerMemberId: input.bloodsuckerMemberId,
              victimMemberId: change.victimMemberId,
              actor: input.actorMemberId ? 'commissioner' : 'system',
              at: input.now.toISOString(),
              result,
              ...extra,
            })
          ) as Prisma.InputJsonValue,
        },
      });

    if (change.kind === 'GRANT') {
      const deadlineAt = await biteDeadline();
      const bite = await tx.leagueBite.create({
        data: {
          leagueId: input.leagueId,
          seasonId: input.seasonId,
          roundId: matchup.competitionRoundId,
          round: input.round,
          matchupId: matchup.id,
          bloodsuckerMemberId: input.bloodsuckerMemberId,
          victimMemberId: change.victimMemberId,
          grantedWinnerMemberId: input.bloodsuckerMemberId,
          opensAt: input.now,
          deadlineAt,
        },
      });
      await audit(bite.id, 'BITE_GRANTED', {
        reason: change.trigger,
        grantedScoreVersion: bite.grantedScoreVersion,
        deadlineAt: deadlineAt.toISOString(),
      });
    } else if (change.kind === 'REACTIVATE' && existing) {
      const deadlineAt = await biteDeadline();
      const bite = await tx.leagueBite.update({
        where: { id: existing.id },
        data: {
          status: 'OPEN',
          grantedWinnerMemberId: input.bloodsuckerMemberId,
          grantedScoreVersion: { increment: 1 },
          opensAt: input.now,
          deadlineAt,
          cancelledBy: null,
          cancelledReason: null,
          version: { increment: 1 },
        },
      });
      await audit(bite.id, 'BITE_GRANTED', {
        reason: change.trigger,
        grantedScoreVersion: bite.grantedScoreVersion,
        deadlineAt: deadlineAt.toISOString(),
      });
    } else if (change.kind === 'CANCEL' && existing) {
      await tx.leagueBite.update({
        where: { id: existing.id },
        data: {
          status: 'CANCELLED',
          cancelledBy: 'RESULT_CHANGED' satisfies BiteCancelledBy,
          cancelledReason: 'A re-score changed the result: the Bloodsucker no longer won.',
          version: { increment: 1 },
        },
      });
      await audit(existing.id, 'BITE_CANCELLED', { reason: 'RESULT_CHANGED' });
    } else if (change.kind === 'RESULT_CHANGED' && existing) {
      await audit(existing.id, 'BITE_RESULT_CHANGED', {
        reason: 'RESULT_CHANGED',
        biteStatus: existing.status,
        takenPlayerId: existing.takenPlayerId,
        returnedPlayerId: existing.returnedPlayerId,
      });
    }
  }
}
