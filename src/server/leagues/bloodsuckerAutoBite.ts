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

/**
 * The auto-bite (Bloodsucker 7/9, #1284; BR-27 to BR-29, NFR-2, NFR-3; owner decisions E2, E7, E8).
 * The 5-minute `cron-bloodsucker` sweep runs every OPEN bite past its deadline and every
 * WAITING_LOCK bite. A bite never runs while a round is in progress (E8): an OPEN bite then becomes
 * WAITING_LOCK and runs at the first sweep after the round ends. Bites run oldest grant first (E7).
 *
 * Each bite is its own transaction under the League row lock, re-checked by `version`, as
 * `processDueLeagueTrades` does, so two sweeps at once execute a bite once.
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
async function loadLeagueScores(
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

type AutoBiteOutcome =
  | { kind: 'AUTO_EXECUTED'; bite: LeagueBite }
  | { kind: 'WAITING_LOCK' }
  | { kind: 'SKIPPED'; reason: string };

/** Codes that mean "not this sweep": the next sweep looks again. Anything else fails the league. */
const WAIT_CODES = new Set(['BITE_NOT_OPEN', 'EARLIER_BITE_PENDING', 'BITE_SUSPENDED']);

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
async function autoBite(
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
      const bite = await lockBite(tx, candidate);
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
        throw new Error(`Bite ${bite.id} has no pair: a roster is empty.`);
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
    });
  } catch (error) {
    if (error instanceof BiteError && WAIT_CODES.has(error.code)) {
      return { kind: 'SKIPPED', reason: error.code };
    }
    throw error;
  }
}

export interface BloodsuckerBiteSweepResult {
  autoExecutedBiteIds: string[];
  waitingLockBiteIds: string[];
  failedLeagueIds: string[];
}

/**
 * Runs every due bite, oldest grant first within each league. A league whose bite fails stops at
 * that bite (later bites wait for it, E7) and is reported; other leagues carry on.
 */
export async function sweepDueBloodsuckerBites(
  now = new Date()
): Promise<BloodsuckerBiteSweepResult> {
  const due = await prisma.leagueBite.findMany({
    where: {
      OR: [{ status: 'OPEN', deadlineAt: { lte: now } }, { status: 'WAITING_LOCK' }],
    },
    orderBy: [{ leagueId: 'asc' }, { opensAt: 'asc' }, { id: 'asc' }],
  });
  const result: BloodsuckerBiteSweepResult = {
    autoExecutedBiteIds: [],
    waitingLockBiteIds: [],
    failedLeagueIds: [],
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
    for (const bite of bites) {
      try {
        const outcome = await autoBite(bite, scores, now);
        if (outcome.kind === 'AUTO_EXECUTED') {
          result.autoExecutedBiteIds.push(bite.id);
          await afterBiteCommitted(outcome.bite, 'executed', { auto: true });
        } else if (outcome.kind === 'WAITING_LOCK') {
          result.waitingLockBiteIds.push(bite.id);
        }
      } catch (error) {
        result.failedLeagueIds.push(leagueId);
        logger.error('Bloodsucker auto-bite failed', {
          leagueId,
          biteId: bite.id,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
  }
  return result;
}
