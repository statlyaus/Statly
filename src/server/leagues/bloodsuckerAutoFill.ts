import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  buildAvailableDraftPlayer,
  calculateStatlyZScores,
  loadDraftPlayerStatsLookup,
} from '@/server/draft/readModels/draftPlayerReadModel';
import { getLeagueRosterCapacity } from '@/server/rosters/rosterCapacity';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

import { loadLeagueDraftWindowState } from './bloodsuckerWindow';
import { normalizeCategoryDirections } from './categoryDirections';
import { ensureDefaultLineups, parseLeagueCategories } from './defaultLineups';
import { lockLeagueRow } from './leagueRowLock';
import { findFirstOpenRound } from './playerMoveLock';
import { publishLeagueSystemMessage } from './social/socialSystemEvents';

/**
 * Closing the Bloodsucker's exclusive window (Bloodsucker 3/9, #1280; BR-13, BR-14, E6). When the
 * window has ended, every empty Bloodsucker roster spot is filled with the highest-Statly-Z unowned
 * player, ties to the lower player id, and the Bloodsucker gets a default lineup if it saved none.
 * One BLOODSUCKER_WINDOW_CLOSED audit row per completed draft makes the close idempotent: a second
 * run finds the row and adds nothing.
 */

/** Bump when the ranking or tie-break changes, so a stored fill can be reproduced (NFR-2). */
export const BLOODSUCKER_AUTO_FILL_RULE_VERSION = 1;
export const BLOODSUCKER_AUTO_FILL_ACQUIRED_BY = 'BLOODSUCKER_AUTO_FILL';

export type BloodsuckerWindowCloseResult =
  | { closed: true; filledPlayerIds: string[] }
  | { closed: false; reason: 'NOT_APPLICABLE' | 'WINDOW_OPEN' | 'ALREADY_CLOSED' };

/** Highest Statly Z first; an unscored player ranks below every scored one; ties to the lower id. */
export function rankAutoFillCandidates<T extends { id: string }>(
  candidates: readonly T[],
  scoreByPlayerId: ReadonlyMap<string, number>
): T[] {
  return [...candidates].sort((left, right) => {
    const leftScore = scoreByPlayerId.get(left.id);
    const rightScore = scoreByPlayerId.get(right.id);
    if (leftScore !== undefined && rightScore !== undefined && leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    if ((leftScore === undefined) !== (rightScore === undefined)) {
      return leftScore === undefined ? 1 : -1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export async function closeBloodsuckerWindow(
  leagueId: string,
  now = new Date()
): Promise<BloodsuckerWindowCloseResult> {
  // Cheap unlocked look first, so the 5-minute sweep does not load stats for a league with nothing due.
  const pending = await prisma.$transaction((tx) => readCloseState(tx, leagueId, now));
  if ('reason' in pending) return { closed: false, reason: pending.reason };

  const statsLookup = await loadDraftPlayerStatsLookup();

  const closed = await prisma.$transaction(async (tx) => {
    await lockLeagueRow(tx, leagueId);
    // Re-read under the League row lock: a concurrent close has either committed its audit row or not started.
    const state = await readCloseState(tx, leagueId, now);
    if ('reason' in state) return state;
    const { bloodsucker, draftId } = state;

    const league = await tx.league.findUniqueOrThrow({
      where: { id: leagueId },
      select: {
        categoriesJson: true,
        settings: {
          select: { rosterSize: true, benchSize: true, categoryDirectionsJson: true },
        },
      },
    });
    const rostered = await tx.leagueRosterPlayer.findMany({
      where: { leagueId },
      select: { playerId: true, memberId: true },
    });
    const emptySpots =
      getLeagueRosterCapacity(league.settings) -
      rostered.filter((row) => row.memberId === bloodsucker.memberId).length;

    let filledPlayerIds: string[] = [];
    if (emptySpots > 0) {
      const categories = parseLeagueCategories(league.categoriesJson);
      const candidates = await tx.player.findMany({
        where: { active: true, id: { notIn: rostered.map((row) => row.playerId) } },
        select: { id: true, name: true, position: true, club: true },
      });
      const scores = calculateStatlyZScores(
        candidates.map((player) =>
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
        normalizeCategoryDirections(categories, league.settings.categoryDirectionsJson)
      );
      filledPlayerIds = rankAutoFillCandidates(
        candidates,
        new Map([...scores].map(([playerId, score]) => [playerId, score.score]))
      )
        .slice(0, emptySpots)
        .map((player) => player.id);
      await tx.leagueRosterPlayer.createMany({
        data: filledPlayerIds.map((playerId) => ({
          leagueId,
          memberId: bloodsucker.memberId,
          playerId,
          acquiredBy: BLOODSUCKER_AUTO_FILL_ACQUIRED_BY,
        })),
      });
    }

    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId,
        actorMemberId: null,
        eventType: 'BLOODSUCKER_WINDOW_CLOSED',
        payloadJson: {
          ruleVersion: BLOODSUCKER_AUTO_FILL_RULE_VERSION,
          draftId,
          bloodsuckerMemberId: bloodsucker.memberId,
          windowOpenedAt: bloodsucker.window.opensAt.toISOString(),
          windowClosedAt: bloodsucker.window.closesAt.toISOString(),
          windowSkipped: bloodsucker.window.skipped,
          emptySpots: Math.max(0, emptySpots),
          filledPlayerIds,
        },
      },
    });
    return { draftId, bloodsucker, filledPlayerIds };
  });
  if ('reason' in closed) return { closed: false, reason: closed.reason };

  await afterClose(leagueId, closed, now);
  return { closed: true, filledPlayerIds: closed.filledPlayerIds };
}

/**
 * E6: a draft that finishes within 3 hours of round 1 has no exclusive window, so the fill runs as
 * the draft completes rather than at the next sweep. Best effort: the draft already stands, the
 * sweep retries, and any other league (or a window still open) is a no-op here.
 */
export async function closeBloodsuckerWindowAfterDraft(leagueId: string): Promise<void> {
  try {
    await closeBloodsuckerWindow(leagueId);
  } catch (error) {
    logger.error('Bloodsucker window close failed after the draft completed', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type CloseState = NonNullable<
  Awaited<ReturnType<typeof loadLeagueDraftWindowState>>
>['bloodsucker'];

async function readCloseState(
  tx: Parameters<typeof lockLeagueRow>[0],
  leagueId: string,
  now: Date
): Promise<
  | { draftId: string; bloodsucker: NonNullable<CloseState> }
  | { reason: 'NOT_APPLICABLE' | 'WINDOW_OPEN' | 'ALREADY_CLOSED' }
> {
  const state = await loadLeagueDraftWindowState(leagueId, tx);
  if (!state?.bloodsucker) return { reason: 'NOT_APPLICABLE' };
  if (now < state.bloodsucker.window.closesAt) return { reason: 'WINDOW_OPEN' };
  // A re-run draft completes later than any earlier close, so only rows since this draft count.
  const alreadyClosed = await tx.leagueCompetitionAudit.findFirst({
    where: {
      leagueId,
      eventType: 'BLOODSUCKER_WINDOW_CLOSED',
      createdAt: { gte: state.bloodsucker.window.opensAt },
    },
    select: { id: true },
  });
  if (alreadyClosed) return { reason: 'ALREADY_CLOSED' };
  return { draftId: state.draftId, bloodsucker: state.bloodsucker };
}

/**
 * Follow-ups to a committed close. Each is best effort: the roster and the audit row already stand,
 * and the matchup read model builds a missing default lineup again when the round is scored.
 */
async function afterClose(
  leagueId: string,
  closed: { draftId: string; bloodsucker: NonNullable<CloseState>; filledPlayerIds: string[] },
  now: Date
): Promise<void> {
  const { memberId, window } = closed.bloodsucker;
  try {
    await new WaiverAvailabilityProjectionService().projectLeague({ leagueId });
  } catch (error) {
    logger.warn('Ownership projection refresh failed after the Bloodsucker auto-fill', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    // BR-14: round 1, or the round in progress when the draft finished after the season started.
    const settings = await prisma.leagueSettings.findFirst({
      where: { league: { id: leagueId } },
      select: { competitionRulesVersion: true },
    });
    const rounds =
      settings && settings.competitionRulesVersion > 0
        ? await prisma.leagueCompetitionRound.findMany({
            where: { leagueId, fixtureVersion: settings.competitionRulesVersion },
            select: { round: true, status: true, startsAt: true, endsAt: true },
          })
        : [];
    const round = rounds.length > 0 ? findFirstOpenRound(rounds, now) : 1;
    if (round !== null) await ensureDefaultLineups({ leagueId, round, memberIds: [memberId], now });
  } catch (error) {
    logger.warn('Bloodsucker default lineup failed after the window closed', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const count = closed.filledPlayerIds.length;
    const filled =
      count === 0
        ? 'Its roster was already full.'
        : `${count} empty roster ${count === 1 ? 'spot was' : 'spots were'} filled with the best available ${count === 1 ? 'player' : 'players'}.`;
    await publishLeagueSystemMessage({
      leagueId,
      eventType: 'BLOODSUCKER_WINDOW_CLOSED',
      relatedEntityId: `${closed.draftId}:${window.opensAt.toISOString()}`,
      content: `The Bloodsucker's free-agency window has closed. ${filled} Adds, drops, waiver claims and trades are open to everyone.`,
      context: { bloodsuckerMemberId: memberId, filledPlayerIds: closed.filledPlayerIds },
    });
  } catch (error) {
    logger.warn('Bloodsucker window activity message failed', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** How long after a draft completes the sweep keeps looking; a window never runs past 24 hours. */
const SWEEP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BloodsuckerSweepResult {
  checkedLeagueIds: string[];
  closedLeagueIds: string[];
  failedLeagueIds: string[];
}

/** Closes every Bloodsucker window that is due. One league's failure never stops the others. */
export async function sweepBloodsuckerWindows(now = new Date()): Promise<BloodsuckerSweepResult> {
  const leagues = await prisma.league.findMany({
    where: {
      settings: { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: { not: null } },
      drafts: {
        some: {
          status: 'COMPLETED',
          completedAt: { gte: new Date(now.getTime() - SWEEP_LOOKBACK_MS), lte: now },
        },
      },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const result: BloodsuckerSweepResult = {
    checkedLeagueIds: leagues.map((league) => league.id),
    closedLeagueIds: [],
    failedLeagueIds: [],
  };
  for (const league of leagues) {
    try {
      const closed = await closeBloodsuckerWindow(league.id, now);
      if (closed.closed) result.closedLeagueIds.push(league.id);
    } catch (error) {
      result.failedLeagueIds.push(league.id);
      logger.error('Bloodsucker window close failed', {
        leagueId: league.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
