import 'server-only';

import type { LeagueBite, Prisma } from '@prisma/client';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  buildAvailableDraftPlayer,
  calculateStatlyZScores,
  type DraftPlayerStatsLookup,
  loadDraftPlayerStatsLookup,
} from '@/server/draft/readModels/draftPlayerReadModel';

import {
  afterBiteCommitted,
  assertMatchupFinal,
  assertNoRoundInProgress,
  assertOldestOpenBite,
  auditPayload,
  BiteError,
  lockBite,
  swapBitePlayers,
  takenSlotOf,
} from './bloodsuckerBites';
import { normalizeCategoryDirections } from './categoryDirections';
import { parseLeagueCategories } from './defaultLineups';
import { LeagueBusyError, SCHEDULED_LEAGUE_LOCK } from './leagueRowLock';
import { publishLeagueSystemMessage } from './social/socialSystemEvents';

/**
 * The auto-bite (Bloodsucker 7/9, #1284; BR-27 to BR-29, NFR-2, NFR-3; owner decisions E2, E7, E8).
 * The 5-minute `cron-bloodsucker` sweep runs every OPEN bite past its deadline and every
 * WAITING_LOCK bite. A bite never runs while a round is in progress (E8): an OPEN bite then becomes
 * WAITING_LOCK and runs at the first sweep after the round ends. Bites run oldest grant first (E7).
 *
 * Each bite is its own transaction under the League row lock, re-checked by `version`, as
 * `processDueLeagueTrades` does, so two sweeps at once execute a bite once.
 *
 * A bite that cannot run does not fail every sweep for ever (#1343):
 * - no pair (a roster is empty at the deadline) ends the bite as CANCELLED / `NO_PAIR`, audited;
 * - a thrown failure, or a bite still suspended (its matchup not FINAL) two hours past its deadline,
 *   is recorded on the bite and fails one run, which is the alert; later sweeps keep counting it and
 *   list it in `knownFailingBiteIds` while the run stays green for every other league.
 */

/** Bump when the ranking, the Z population or the tie-break changes (NFR-2). */
export const AUTO_BITE_RULE_VERSION = 1;

type Transaction = Prisma.TransactionClient;

// A type alias, not an interface, so it fits Prisma's JSON input type for the snapshot.
export type RankedPlayer = {
  playerId: string;
  /** Statly Z; null when the player has no stats in any league category. */
  z: number | null;
};

export interface AutoBitePick {
  takenPlayerId: string;
  returnedPlayerId: string;
  /** The victim's roster, best first. */
  victim: RankedPlayer[];
  /** The Bloodsucker's roster, worst first. */
  bloodsucker: RankedPlayer[];
}

/** Best first: a higher Z, then a scored player before an unscored one, then the lower id. */
function compareBestFirst(left: RankedPlayer, right: RankedPlayer): number {
  if (left.z !== null && right.z !== null && left.z !== right.z) return right.z - left.z;
  if ((left.z === null) !== (right.z === null)) return left.z === null ? 1 : -1;
  return left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0;
}

/** Worst first: a lower Z (an unscored player lowest), then the lower id. */
function compareWorstFirst(left: RankedPlayer, right: RankedPlayer): number {
  if (left.z !== null && right.z !== null && left.z !== right.z) return left.z - right.z;
  if ((left.z === null) !== (right.z === null)) return left.z === null ? -1 : 1;
  return left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0;
}

/**
 * BR-28 with E2: take the victim's highest-Statly-Z player and return the Bloodsucker's lowest,
 * ties to the lower player id. Every rostered player is eligible (E8 replaced the per-player lock).
 */
export function pickAutoBitePair(input: {
  victimPlayerIds: readonly string[];
  bloodsuckerPlayerIds: readonly string[];
  scoreByPlayerId: ReadonlyMap<string, number>;
}): AutoBitePick | null {
  const rank = (ids: readonly string[]) =>
    ids.map((playerId) => ({ playerId, z: input.scoreByPlayerId.get(playerId) ?? null }));
  const victim = rank(input.victimPlayerIds).sort(compareBestFirst);
  const bloodsucker = rank(input.bloodsuckerPlayerIds).sort(compareWorstFirst);
  if (!victim[0] || !bloodsucker[0]) return null;
  return {
    takenPlayerId: victim[0].playerId,
    returnedPlayerId: bloodsucker[0].playerId,
    victim,
    bloodsucker,
  };
}

interface LeagueScores {
  categories: string[];
  scoreByPlayerId: Map<string, number>;
}

/**
 * Statly Z for every active player under the league's categories and directions, the same scale
 * as the draft room and the window auto-fill. A player with no stat in any category is unscored.
 */
export async function loadLeagueScores(
  leagueId: string,
  statsLookup: DraftPlayerStatsLookup
): Promise<LeagueScores> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { categoriesJson: true, settings: { select: { categoryDirectionsJson: true } } },
  });
  const categories = parseLeagueCategories(league.categoriesJson);
  const players = await prisma.player.findMany({
    where: { active: true },
    select: { id: true, name: true, position: true, club: true },
  });
  const scores = calculateStatlyZScores(
    players.map((player) =>
      buildAvailableDraftPlayer(
        {
          id: player.id,
          name: player.name,
          position: player.position ?? '',
          club: player.club ?? '',
        },
        statsLookup
      )
    ),
    categories,
    normalizeCategoryDirections(categories, league.settings?.categoryDirectionsJson)
  );
  const scoreByPlayerId = new Map<string, number>();
  for (const [playerId, score] of scores) {
    if (score.breakdown.length > 0) scoreByPlayerId.set(playerId, score.score);
  }
  return { categories: [...categories], scoreByPlayerId };
}

export type AutoBiteOutcome =
  | { kind: 'AUTO_EXECUTED'; bite: LeagueBite }
  | { kind: 'WAITING_LOCK' }
  | { kind: 'NO_PAIR'; bite: LeagueBite }
  | { kind: 'SKIPPED'; reason: string };

/** Codes that mean "not this sweep": the next sweep looks again. Anything else fails the league. */
const WAIT_CODES = new Set(['BITE_NOT_OPEN', 'EARLIER_BITE_PENDING', 'BITE_SUSPENDED']);

export const BITE_CANCELLED_NO_PAIR = 'NO_PAIR';
/**
 * Hours past its deadline a bite may stay suspended before the sweep alerts. The hourly scoring job
 * re-finalises a matchup a re-score left LIVE, so two hours means that recovery has not worked.
 */
export const SUSPENDED_BITE_ALERT_HOURS = 2;

async function rosterIds(tx: Transaction, leagueId: string, memberId: string) {
  const rows = await tx.leagueRosterPlayer.findMany({
    where: { leagueId, memberId },
    select: { playerId: true },
  });
  return rows.map((row) => row.playerId);
}

/** E8: from a round's first lock until it ends, no bite runs. */
function roundInProgress(tx: Transaction, bite: LeagueBite, now: Date): Promise<boolean> {
  return assertNoRoundInProgress(tx, bite.leagueId, now).then(
    () => false,
    (error: unknown) => {
      if (error instanceof BiteError && error.code === 'ROUND_IN_PROGRESS') return true;
      throw error;
    }
  );
}

/** One bite, in its own transaction under the League row lock. */
export async function autoBite(
  candidate: LeagueBite,
  scores: () => Promise<LeagueScores>,
  now: Date
): Promise<AutoBiteOutcome> {
  // A bite already waiting skips the stats read while its round is still in progress.
  if (candidate.status === 'WAITING_LOCK' && (await roundInProgress(prisma, candidate, now))) {
    return { kind: 'SKIPPED', reason: 'ROUND_IN_PROGRESS' };
  }
  // Loaded before the transaction so the League lock is never held across the stats read.
  const leagueScores = await scores();
  try {
    return await prisma.$transaction(async (tx) => {
      const bite = await lockBite(tx, candidate, SCHEDULED_LEAGUE_LOCK.waitMs);
      const due =
        bite.status === 'WAITING_LOCK' || (bite.status === 'OPEN' && bite.deadlineAt <= now);
      if (!due) return { kind: 'SKIPPED', reason: 'NOT_DUE' } as const;
      await assertOldestOpenBite(tx, bite);
      await assertMatchupFinal(tx, bite);

      if (await roundInProgress(tx, bite, now)) {
        if (bite.status === 'WAITING_LOCK') {
          return { kind: 'SKIPPED', reason: 'ROUND_IN_PROGRESS' } as const;
        }
        await tx.leagueBite.update({
          where: { id: bite.id },
          data: { status: 'WAITING_LOCK', version: { increment: 1 } },
        });
        await tx.leagueCompetitionAudit.create({
          data: {
            leagueId: bite.leagueId,
            actorMemberId: null,
            eventType: 'BITE_WAITING_LOCK',
            payloadJson: auditPayload(bite, {
              actor: 'system',
              at: now.toISOString(),
              reason: 'ROUND_IN_PROGRESS',
              deadlineAt: bite.deadlineAt.toISOString(),
            }),
          },
        });
        return { kind: 'WAITING_LOCK' } as const;
      }

      const pick = pickAutoBitePair({
        victimPlayerIds: await rosterIds(tx, bite.leagueId, bite.victimMemberId),
        bloodsuckerPlayerIds: await rosterIds(tx, bite.leagueId, bite.bloodsuckerMemberId),
        scoreByPlayerId: leagueScores.scoreByPlayerId,
      });
      if (!pick) {
        // One for one needs a player on each side. The right ends here, audited, rather than
        // throwing on every sweep; BR-20 lets a right end cancelled.
        const cancelled = await tx.leagueBite.update({
          where: { id: bite.id },
          data: {
            status: 'CANCELLED',
            cancelledBy: BITE_CANCELLED_NO_PAIR,
            cancelledReason:
              'A roster was empty at the deadline, so there was no player to take or send back.',
            version: { increment: 1 },
          },
        });
        await tx.leagueCompetitionAudit.create({
          data: {
            leagueId: bite.leagueId,
            actorMemberId: null,
            eventType: 'BITE_CANCELLED',
            payloadJson: auditPayload(bite, {
              actor: 'system',
              at: now.toISOString(),
              reason: BITE_CANCELLED_NO_PAIR,
              statusBefore: bite.status,
              deadlineAt: bite.deadlineAt.toISOString(),
              rostersBefore: {
                victim: await rosterIds(tx, bite.leagueId, bite.victimMemberId),
                bloodsucker: await rosterIds(tx, bite.leagueId, bite.bloodsuckerMemberId),
              },
            }),
          },
        });
        return { kind: 'NO_PAIR', bite: cancelled } as const;
      }
      const pair = { takenPlayerId: pick.takenPlayerId, returnedPlayerId: pick.returnedPlayerId };
      const snapshot = {
        ruleVersion: AUTO_BITE_RULE_VERSION,
        computedAt: now.toISOString(),
        categories: leagueScores.categories,
        victim: pick.victim,
        bloodsucker: pick.bloodsucker,
      };
      const reason = bite.status === 'WAITING_LOCK' ? 'LOCK_RELEASED' : 'DEADLINE';

      const takenSlot = await takenSlotOf(tx, bite, pair.takenPlayerId);
      const swap = await swapBitePlayers(tx, bite, { ...pair, now });
      const updated = await tx.leagueBite.update({
        where: { id: bite.id },
        data: {
          status: 'AUTO_EXECUTED',
          ...pair,
          takenSlot,
          executedAt: now,
          executedByUserId: null,
          autoBiteRuleVersion: AUTO_BITE_RULE_VERSION,
          autoBiteSnapshotJson: snapshot,
          version: { increment: 1 },
        },
      });
      await tx.teamAction.create({
        data: {
          leagueId: bite.leagueId,
          seasonId: bite.seasonId,
          memberId: bite.bloodsuckerMemberId,
          targetMemberId: bite.victimMemberId,
          actionType: 'BLOODSUCKER_BITE',
          status: 'PROCESSED',
          processedAt: now,
          details: { biteId: bite.id, ...pair, auto: true },
        },
      });
      await tx.leagueCompetitionAudit.create({
        data: {
          leagueId: bite.leagueId,
          actorMemberId: null,
          eventType: 'BITE_AUTO',
          payloadJson: auditPayload(bite, {
            actor: 'system',
            at: now.toISOString(),
            reason,
            ...pair,
            takenSlot,
            autoBiteRuleVersion: AUTO_BITE_RULE_VERSION,
            ...swap,
          }),
        },
      });
      return { kind: 'AUTO_EXECUTED', bite: updated } as const;
    }, SCHEDULED_LEAGUE_LOCK.transaction);
  } catch (error) {
    if (error instanceof BiteError && WAIT_CODES.has(error.code)) {
      return { kind: 'SKIPPED', reason: error.code };
    }
    // Round scoring still holds the League row: not a failure, the next sweep runs the bite.
    if (error instanceof LeagueBusyError) return { kind: 'SKIPPED', reason: error.code };
    throw error;
  }
}

/** Best effort, after commit: tells the league a bite ended unused because a roster was empty. */
async function announceNoPair(bite: LeagueBite) {
  try {
    const victim = await prisma.leagueMember.findUnique({
      where: { id: bite.victimMemberId },
      select: { teamName: true },
    });
    await publishLeagueSystemMessage({
      leagueId: bite.leagueId,
      eventType: 'BLOODSUCKER_BITE_CANCELLED',
      relatedEntityId: `${bite.id}:${bite.version}`,
      content: `The Bloodsucker's round ${bite.round} bite on ${victim?.teamName ?? 'their opponent'} ended unused: a roster was empty at the deadline, so there was no player to swap.`,
      context: { biteId: bite.id },
    });
  } catch (error) {
    logger.warn('Bloodsucker no-pair activity message failed', {
      leagueId: bite.leagueId,
      biteId: bite.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Counts a failed or stuck sweep on the bite. Returns true the first time, which is the one alert:
 * the caller logs an error (Sentry) and fails that run. Later calls only count.
 */
async function recordBiteFailure(bite: LeagueBite, reason: string, now: Date): Promise<boolean> {
  try {
    const first = await prisma.leagueBite.updateMany({
      where: {
        id: bite.id,
        leagueId: bite.leagueId,
        seasonId: bite.seasonId,
        failureAlertedAt: null,
      },
      data: { failureAlertedAt: now },
    });
    await prisma.leagueBite.updateMany({
      where: { id: bite.id, leagueId: bite.leagueId, seasonId: bite.seasonId },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: now,
        lastFailureReason: reason.slice(0, 500),
      },
    });
    return first.count === 1;
  } catch (error) {
    // The failure could not be stored, so it cannot be known as alerted: alert again.
    logger.error('Bloodsucker bite failure could not be recorded', {
      leagueId: bite.leagueId,
      biteId: bite.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

export interface BloodsuckerBiteSweepResult {
  autoExecutedBiteIds: string[];
  waitingLockBiteIds: string[];
  /** Bites ended as CANCELLED / NO_PAIR this run: a roster was empty at the deadline. */
  unpairableBiteIds: string[];
  /** Leagues with a bite that failed or got stuck for the first time this run: the run fails once. */
  failedLeagueIds: string[];
  /** Bites still failing or stuck after their one alert; see `LeagueBite.lastFailureReason`. */
  knownFailingBiteIds: string[];
}

/**
 * Runs every due bite of each league's active season, oldest grant first within the league. A league
 * whose bite fails stops at that bite (later bites wait for it, E7); other leagues carry on. A
 * failing bite fails the run once (the alert) and is then only counted, so one stuck bite cannot keep
 * the monitor red or hide another league's failure.
 */
export async function sweepDueBloodsuckerBites(
  now = new Date(),
  run: typeof autoBite = autoBite
): Promise<BloodsuckerBiteSweepResult> {
  const candidates = await prisma.leagueBite.findMany({
    where: {
      OR: [{ status: 'OPEN', deadlineAt: { lte: now } }, { status: 'WAITING_LOCK' }],
    },
    include: { league: { select: { activeSeasonId: true } } },
    orderBy: [{ leagueId: 'asc' }, { opensAt: 'asc' }, { id: 'asc' }],
  });
  // League and season scope: only bites of the league's active season run.
  const due: LeagueBite[] = candidates.flatMap(({ league, ...bite }) =>
    league.activeSeasonId === bite.seasonId ? [bite] : []
  );
  const result: BloodsuckerBiteSweepResult = {
    autoExecutedBiteIds: [],
    waitingLockBiteIds: [],
    unpairableBiteIds: [],
    failedLeagueIds: [],
    knownFailingBiteIds: [],
  };
  if (due.length === 0) return result;

  let statsLookup: Promise<DraftPlayerStatsLookup> | null = null;
  const byLeague = new Map<string, LeagueBite[]>();
  for (const bite of due)
    byLeague.set(bite.leagueId, [...(byLeague.get(bite.leagueId) ?? []), bite]);
  for (const [leagueId, bites] of byLeague) {
    let leagueScores: Promise<LeagueScores> | null = null;
    const scores = () =>
      (leagueScores ??= (statsLookup ??= loadDraftPlayerStatsLookup()).then((lookup) =>
        loadLeagueScores(leagueId, lookup)
      ));
    const fail = async (bite: LeagueBite, reason: string) => {
      const context = { leagueId, biteId: bite.id, error: reason, failures: bite.failureCount + 1 };
      if (await recordBiteFailure(bite, reason, now)) {
        result.failedLeagueIds.push(leagueId);
        logger.error('Bloodsucker auto-bite failed', context);
      } else {
        result.knownFailingBiteIds.push(bite.id);
        logger.warn('Bloodsucker auto-bite is still failing', context);
      }
    };
    for (const bite of bites) {
      try {
        const outcome = await run(bite, scores, now);
        if (outcome.kind === 'AUTO_EXECUTED') {
          result.autoExecutedBiteIds.push(bite.id);
          await afterBiteCommitted(outcome.bite, 'executed', { auto: true });
        } else if (outcome.kind === 'WAITING_LOCK') {
          result.waitingLockBiteIds.push(bite.id);
        } else if (outcome.kind === 'NO_PAIR') {
          result.unpairableBiteIds.push(bite.id);
          logger.warn('Bloodsucker bite ended unused: a roster was empty', {
            leagueId,
            biteId: bite.id,
          });
          await announceNoPair(outcome.bite);
        } else if (
          outcome.reason === 'BITE_SUSPENDED' &&
          now.getTime() - bite.deadlineAt.getTime() > SUSPENDED_BITE_ALERT_HOURS * 60 * 60 * 1000
        ) {
          await fail(
            bite,
            `BITE_SUSPENDED: the matchup is still not FINAL ${SUSPENDED_BITE_ALERT_HOURS} hours past the bite's deadline`
          );
        }
      } catch (error) {
        await fail(bite, error instanceof Error ? error.message : String(error));
        break;
      }
    }
  }
  return result;
}
