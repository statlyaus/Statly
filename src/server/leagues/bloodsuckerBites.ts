import 'server-only';

import type { LeagueBite, Prisma } from '@prisma/client';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

import { isActivePrismaMembership } from './activeMembership';
import { isCommissioner } from './competitionRules';
import { resolveBloodsuckerMemberId } from './leagueFormat';
import { lockLeagueRow } from './leagueRowLock';
import { findRoundInProgress, replacePlayerInOpenLineups } from './playerMoveLock';
import { refreshOwnershipProjection, swapRosterPlayers } from './rosterSwap';
import { publishLeagueSystemMessage } from './social/socialSystemEvents';

// Executing a Bloodsucker bite (Bloodsucker 6/9, #1283; BR-21, BR-24 to BR-26, BR-35, BR-36, BR-38,
// BR-39; owner decisions E1, E2, E5, E7, E8). Every swap goes through the shared roster-swap
// primitive under the League row lock, so a concurrent waiver run, trade or second bite sees it.
// The checks and the swap are exported for the deadline auto-bite (`bloodsuckerAutoBite.ts`, #1284).

type Transaction = Prisma.TransactionClient;

export type BiteErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'BITE_NOT_OPEN'
  | 'BITE_NOT_EXECUTED'
  | 'BITE_SUSPENDED'
  | 'EARLIER_BITE_PENDING'
  | 'ROUND_IN_PROGRESS'
  | 'ROSTER_CHANGED';

export class BiteError extends Error {
  constructor(
    public readonly code: BiteErrorCode,
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409
  ) {
    super(message);
    this.name = 'BiteError';
  }
}

export const BITE_ACQUIRED_BY = 'BLOODSUCKER_BITE';
export const PLAYER_BITTEN = 'PLAYER_BITTEN';
const UNEXECUTED = ['OPEN', 'WAITING_LOCK'] as const;
const EXECUTED = ['EXECUTED', 'AUTO_EXECUTED'] as const;

interface BiteActor {
  userId: string;
  memberId: string;
  commissioner: boolean;
}

async function loadActor(leagueId: string, userId: string): Promise<BiteActor> {
  const member = await prisma.leagueMember.findFirst({
    where: { leagueId, userId, isActive: true },
    select: { id: true, role: true, isCoCommissioner: true, isActive: true, status: true },
  });
  if (!member || !isActivePrismaMembership(member))
    throw new BiteError('FORBIDDEN', 'You are not a member of this league.', 403);
  return { userId, memberId: member.id, commissioner: isCommissioner(member) };
}

async function loadBite(leagueId: string, biteId: string): Promise<LeagueBite> {
  const bite = await prisma.leagueBite.findFirst({ where: { id: biteId, leagueId } });
  if (!bite) throw new BiteError('NOT_FOUND', 'Bite not found.', 404);
  return bite;
}

/** E8: no bite moves a player while a round is in progress, from its first lock until it ends. */
export async function assertNoRoundInProgress(tx: Transaction, leagueId: string, now: Date) {
  const settings = await tx.leagueSettings.findFirst({
    where: { league: { id: leagueId } },
    select: { competitionRulesVersion: true },
  });
  if (!settings || settings.competitionRulesVersion < 1) return;
  const rounds = await tx.leagueCompetitionRound.findMany({
    where: { leagueId, fixtureVersion: settings.competitionRulesVersion },
    select: { round: true, status: true, startsAt: true, endsAt: true },
  });
  const inProgress = findRoundInProgress(rounds, now);
  if (inProgress) {
    throw new BiteError(
      'ROUND_IN_PROGRESS',
      `Round ${inProgress.round} is in progress. Bites happen before a round's first game or after it ends.`,
      409
    );
  }
}

/** E5: a bite waits while its matchup is not FINAL (a re-score sent it back to LIVE). */
export async function assertMatchupFinal(tx: Transaction, bite: LeagueBite) {
  const matchup = await tx.leagueMatchup.findUnique({
    where: { id: bite.matchupId },
    select: { status: true },
  });
  if (matchup?.status !== 'FINAL') {
    throw new BiteError(
      'BITE_SUSPENDED',
      'This matchup is being re-scored. The bite can run once its result is final again.',
      409
    );
  }
}

/** E7: bites execute oldest grant first. */
export async function assertOldestOpenBite(tx: Transaction, bite: LeagueBite) {
  const earlier = await tx.leagueBite.findFirst({
    where: {
      leagueId: bite.leagueId,
      bloodsuckerMemberId: bite.bloodsuckerMemberId,
      status: { in: [...UNEXECUTED] },
      id: { not: bite.id },
      OR: [{ opensAt: { lt: bite.opensAt } }, { opensAt: bite.opensAt, id: { lt: bite.id } }],
    },
    select: { round: true },
  });
  if (earlier) {
    throw new BiteError(
      'EARLIER_BITE_PENDING',
      `Your bite from round ${earlier.round} comes first.`,
      409
    );
  }
}

async function rosterOf(tx: Transaction, leagueId: string, memberId: string) {
  const rows = await tx.leagueRosterPlayer.findMany({
    where: { leagueId, memberId },
    select: { playerId: true },
    orderBy: { playerId: 'asc' },
  });
  return rows.map((row) => row.playerId);
}

interface SwapResult {
  rostersBefore: { bloodsucker: string[]; victim: string[] };
  rostersAfter: { bloodsucker: string[]; victim: string[] };
}

/**
 * One bite swap: `takenPlayerId` leaves the victim for the Bloodsucker and `returnedPlayerId` goes
 * the other way (BR-21, E2: any player for any player). Inside the caller's transaction, after the
 * League row lock. The incoming player takes the outgoing player's slot in each side's unlocked
 * lineups (BR-25); pending trades with either player are invalidated and pending waiver claims that
 * drop either player fail, both with `PLAYER_BITTEN` (BR-26).
 */
export async function swapBitePlayers(
  tx: Transaction,
  bite: LeagueBite,
  input: { takenPlayerId: string; returnedPlayerId: string; now: Date }
): Promise<SwapResult> {
  const { leagueId } = bite;
  const victim = bite.victimMemberId;
  const bloodsucker = bite.bloodsuckerMemberId;
  const rostersBefore = {
    bloodsucker: await rosterOf(tx, leagueId, bloodsucker),
    victim: await rosterOf(tx, leagueId, victim),
  };
  if (!rostersBefore.victim.includes(input.takenPlayerId)) {
    throw new BiteError('ROSTER_CHANGED', 'That player is not on the losing team any more.', 409);
  }
  if (!rostersBefore.bloodsucker.includes(input.returnedPlayerId)) {
    throw new BiteError('ROSTER_CHANGED', 'That player is not on your roster any more.', 409);
  }

  await replacePlayerInOpenLineups(tx, {
    leagueId,
    memberId: victim,
    outgoingPlayerId: input.takenPlayerId,
    incomingPlayerId: input.returnedPlayerId,
    now: input.now,
  });
  await replacePlayerInOpenLineups(tx, {
    leagueId,
    memberId: bloodsucker,
    outgoingPlayerId: input.returnedPlayerId,
    incomingPlayerId: input.takenPlayerId,
    now: input.now,
  });
  await swapRosterPlayers(tx, {
    leagueId,
    seasonId: bite.seasonId,
    fromMemberId: victim,
    toMemberId: bloodsucker,
    fromPlayerIds: [input.takenPlayerId],
    toPlayerIds: [input.returnedPlayerId],
    acquiredBy: BITE_ACQUIRED_BY,
    invalidationReason: PLAYER_BITTEN,
    now: input.now,
  });
  await failWaiverClaimsDropping(tx, bite, [input.takenPlayerId, input.returnedPlayerId]);

  return {
    rostersBefore,
    rostersAfter: {
      bloodsucker: await rosterOf(tx, leagueId, bloodsucker),
      victim: await rosterOf(tx, leagueId, victim),
    },
  };
}

/** BR-26: a pending waiver claim that would drop a bitten player can no longer settle. */
async function failWaiverClaimsDropping(
  tx: Transaction,
  bite: LeagueBite,
  playerIds: readonly string[]
) {
  const claims = await tx.teamAction.findMany({
    where: {
      leagueId: bite.leagueId,
      seasonId: bite.seasonId,
      actionType: 'WAIVER_CLAIM',
      status: 'PENDING',
      memberId: { in: [bite.victimMemberId, bite.bloodsuckerMemberId] },
      OR: playerIds.map((playerId) => ({ details: { path: ['dropPlayerId'], equals: playerId } })),
    },
    select: { id: true, details: true },
  });
  for (const claim of claims) {
    const details =
      claim.details && typeof claim.details === 'object' && !Array.isArray(claim.details)
        ? claim.details
        : {};
    await tx.teamAction.updateMany({
      where: { id: claim.id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        processedAt: new Date(),
        details: { ...details, failureReason: PLAYER_BITTEN },
      },
    });
  }
}

/** The victim's slot for the taken player in the bite's round lineup, when he was in it. */
export async function takenSlotOf(tx: Transaction, bite: LeagueBite, playerId: string) {
  const row = await tx.leagueLineupPlayer.findFirst({
    where: {
      playerId,
      lineup: {
        leagueId: bite.leagueId,
        seasonId: bite.seasonId,
        memberId: bite.victimMemberId,
        round: bite.round,
      },
    },
    select: { slot: true },
  });
  return row?.slot ?? null;
}

export function auditPayload(
  bite: LeagueBite,
  extra: Record<string, unknown>
): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      biteId: bite.id,
      seasonId: bite.seasonId,
      round: bite.round,
      matchupId: bite.matchupId,
      bloodsuckerMemberId: bite.bloodsuckerMemberId,
      victimMemberId: bite.victimMemberId,
      ...extra,
    })
  ) as Prisma.InputJsonValue;
}

/** Re-reads the bite under the League lock; a concurrent change since it was read is refused. */
export async function lockBite(tx: Transaction, bite: LeagueBite): Promise<LeagueBite> {
  await lockLeagueRow(tx, bite.leagueId);
  const current = await tx.leagueBite.findUnique({ where: { id: bite.id } });
  if (!current || current.version !== bite.version) {
    throw new BiteError('BITE_NOT_OPEN', 'This bite changed. Refresh and try again.', 409);
  }
  return current;
}

export interface BiteResult {
  biteId: string;
  status: LeagueBite['status'];
  takenPlayerId: string | null;
  returnedPlayerId: string | null;
  version: number;
}

const toResult = (bite: LeagueBite): BiteResult => ({
  biteId: bite.id,
  status: bite.status,
  takenPlayerId: bite.takenPlayerId,
  returnedPlayerId: bite.returnedPlayerId,
  version: bite.version,
});

function readPlayerPair(input: unknown): { takenPlayerId: string; returnedPlayerId: string } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const takenPlayerId = typeof body.takenPlayerId === 'string' ? body.takenPlayerId.trim() : '';
  const returnedPlayerId =
    typeof body.returnedPlayerId === 'string' ? body.returnedPlayerId.trim() : '';
  if (!takenPlayerId || !returnedPlayerId) {
    throw new BiteError(
      'INVALID_INPUT',
      'Choose one player to take and one player to send back.',
      400
    );
  }
  return { takenPlayerId, returnedPlayerId };
}

/** `POST /api/leagues/[id]/bites/[biteId]`: the Bloodsucker takes a player and returns one. */
export async function executeBite(input: {
  leagueId: string;
  biteId: string;
  userId: string;
  body: unknown;
  now?: Date;
}): Promise<BiteResult> {
  const now = input.now ?? new Date();
  const pair = readPlayerPair(input.body);
  const actor = await loadActor(input.leagueId, input.userId);
  const bite = await loadBite(input.leagueId, input.biteId);
  if (actor.memberId !== bite.bloodsuckerMemberId) {
    throw new BiteError('FORBIDDEN', 'Only the Bloodsucker can bite.', 403);
  }

  const executed = await prisma.$transaction(async (tx) => {
    const current = await lockBite(tx, bite);
    if (!(UNEXECUTED as readonly string[]).includes(current.status)) {
      throw new BiteError('BITE_NOT_OPEN', 'This bite is already done.', 409);
    }
    await assertOldestOpenBite(tx, current);
    await assertMatchupFinal(tx, current);
    await assertNoRoundInProgress(tx, current.leagueId, now);

    const takenSlot = await takenSlotOf(tx, current, pair.takenPlayerId);
    const swap = await swapBitePlayers(tx, current, { ...pair, now });
    const updated = await tx.leagueBite.update({
      where: { id: current.id },
      data: {
        status: 'EXECUTED',
        takenPlayerId: pair.takenPlayerId,
        returnedPlayerId: pair.returnedPlayerId,
        takenSlot,
        executedAt: now,
        executedByUserId: actor.userId,
        version: { increment: 1 },
      },
    });
    await tx.teamAction.create({
      data: {
        leagueId: current.leagueId,
        seasonId: current.seasonId,
        memberId: current.bloodsuckerMemberId,
        targetMemberId: current.victimMemberId,
        actionType: 'BLOODSUCKER_BITE',
        status: 'PROCESSED',
        processedAt: now,
        details: { biteId: current.id, ...pair },
      },
    });
    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId: current.leagueId,
        actorMemberId: actor.memberId,
        eventType: 'BITE_EXECUTED',
        payloadJson: auditPayload(current, {
          actor: 'bloodsucker',
          at: now.toISOString(),
          reason: 'BLOODSUCKER_CHOICE',
          ...pair,
          takenSlot,
          ...swap,
        }),
      },
    });
    return updated;
  });

  await afterBiteCommitted(executed, 'executed');
  return toResult(executed);
}

/**
 * `POST /api/leagues/[id]/bites/[biteId]/commissioner` (BR-35, E1): a commissioner who is neither
 * the Bloodsucker nor the victim cancels or redoes a bite, with a reason.
 * - `cancel` on an open bite ends it unused; on an executed bite it swaps both players back as a
 *   new move (nothing in history is rolled back).
 * - `redo` on an executed bite swaps the original players back and makes the new pair's swap, in one
 *   transaction.
 */
export async function commissionerBiteAction(input: {
  leagueId: string;
  biteId: string;
  userId: string;
  body: unknown;
  now?: Date;
}): Promise<BiteResult> {
  const now = input.now ?? new Date();
  const body = (input.body && typeof input.body === 'object' ? input.body : {}) as Record<
    string,
    unknown
  >;
  const action = body.action;
  if (action !== 'cancel' && action !== 'redo') {
    throw new BiteError('INVALID_INPUT', 'Action must be cancel or redo.', 400);
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 500) {
    throw new BiteError('INVALID_INPUT', 'A reason (up to 500 characters) is required.', 400);
  }
  const pair = action === 'redo' ? readPlayerPair(body) : null;

  const actor = await loadActor(input.leagueId, input.userId);
  if (!actor.commissioner) {
    throw new BiteError('FORBIDDEN', 'Only a commissioner can cancel or redo a bite.', 403);
  }
  const bite = await loadBite(input.leagueId, input.biteId);
  if (actor.memberId === bite.bloodsuckerMemberId || actor.memberId === bite.victimMemberId) {
    throw new BiteError(
      'FORBIDDEN',
      'You are part of this bite, so another commissioner or the owner must change it.',
      403
    );
  }

  const changed = await prisma.$transaction(async (tx) => {
    const current = await lockBite(tx, bite);
    const executed = (EXECUTED as readonly string[]).includes(current.status);
    const open = (UNEXECUTED as readonly string[]).includes(current.status);
    if (action === 'redo' && !executed) {
      throw new BiteError('BITE_NOT_EXECUTED', 'Only an executed bite can be redone.', 409);
    }
    if (action === 'cancel' && !executed && !open) {
      throw new BiteError('BITE_NOT_OPEN', 'This bite is already cancelled.', 409);
    }

    const steps: Array<Record<string, unknown>> = [];
    if (executed && current.takenPlayerId && current.returnedPlayerId) {
      await assertNoRoundInProgress(tx, current.leagueId, now);
      // The reversal: the taken player goes back to the victim, the returned one to the Bloodsucker.
      const reversal = await swapBitePlayers(tx, current, {
        takenPlayerId: current.returnedPlayerId,
        returnedPlayerId: current.takenPlayerId,
        now,
      }).catch(reverseRosterError);
      steps.push({ step: 'reversal', ...reversal });
    }
    if (pair) {
      const swap = await swapBitePlayers(tx, current, { ...pair, now });
      steps.push({ step: 'swap', ...pair, ...swap });
    }

    const updated = await tx.leagueBite.update({
      where: { id: current.id },
      data:
        action === 'cancel'
          ? {
              status: 'CANCELLED',
              cancelledBy: 'COMMISSIONER',
              cancelledReason: reason,
              version: { increment: 1 },
            }
          : {
              takenPlayerId: pair!.takenPlayerId,
              returnedPlayerId: pair!.returnedPlayerId,
              takenSlot: await takenSlotOf(tx, current, pair!.takenPlayerId),
              executedAt: now,
              executedByUserId: actor.userId,
              version: { increment: 1 },
            },
    });
    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId: current.leagueId,
        actorMemberId: actor.memberId,
        eventType: action === 'cancel' ? 'BITE_CANCELLED' : 'BITE_REDONE',
        payloadJson: auditPayload(current, {
          actor: 'commissioner',
          at: now.toISOString(),
          reason,
          statusBefore: current.status,
          previous: {
            takenPlayerId: current.takenPlayerId,
            returnedPlayerId: current.returnedPlayerId,
          },
          steps,
        }),
      },
    });
    return { bite: updated, moved: steps.length > 0 };
  });

  await afterBiteCommitted(changed.bite, action === 'cancel' ? 'cancelled' : 'redone', {
    moved: changed.moved,
    reason,
  });
  return toResult(changed.bite);
}

function reverseRosterError(error: unknown): never {
  if (error instanceof BiteError && error.code === 'ROSTER_CHANGED') {
    throw new BiteError(
      'ROSTER_CHANGED',
      'A player from the original bite has changed teams since, so it cannot be swapped back.',
      409
    );
  }
  throw error;
}

/**
 * After commit: the ownership projection, then one activity message per bite change (BR-39). Both are
 * best effort; the swap already stands.
 */
export async function afterBiteCommitted(
  bite: LeagueBite,
  change: 'executed' | 'cancelled' | 'redone',
  detail: { moved?: boolean; reason?: string; auto?: boolean } = {}
) {
  if (change === 'executed' || detail.moved) await refreshOwnershipProjection(bite.leagueId);
  try {
    const described = await describeBite(bite, change, detail.reason);
    const content = detail.auto
      ? `${described} The deadline passed, so the system made the pick.`
      : described;
    await publishLeagueSystemMessage({
      leagueId: bite.leagueId,
      eventType:
        change === 'executed' ? 'BLOODSUCKER_BITE' : `BLOODSUCKER_BITE_${change.toUpperCase()}`,
      relatedEntityId: `${bite.id}:${bite.version}`,
      content,
      context: {
        biteId: bite.id,
        ...(bite.takenPlayerId ? { takenPlayerId: bite.takenPlayerId } : {}),
        ...(bite.returnedPlayerId ? { returnedPlayerId: bite.returnedPlayerId } : {}),
      },
    });
  } catch (error) {
    logger.warn('Bloodsucker bite activity message failed', {
      leagueId: bite.leagueId,
      biteId: bite.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** BR-39: "The Bloodsucker beat {team} {score} and took {player}, sending back {player}." */
export async function describeBite(
  bite: LeagueBite,
  change: 'executed' | 'cancelled' | 'redone',
  reason?: string
): Promise<string> {
  const [victim, matchup, players] = await Promise.all([
    prisma.leagueMember.findUnique({
      where: { id: bite.victimMemberId },
      select: { teamName: true },
    }),
    prisma.leagueMatchup.findUnique({
      where: { id: bite.matchupId },
      select: { homeMemberId: true, homeCategoryWins: true, awayCategoryWins: true },
    }),
    prisma.player.findMany({
      where: { id: { in: [bite.takenPlayerId, bite.returnedPlayerId].flatMap((id) => id ?? []) } },
      select: { id: true, name: true },
    }),
  ]);
  const team = victim?.teamName ?? 'their opponent';
  const name = (id: string | null) =>
    players.find((player) => player.id === id)?.name ?? 'a player';
  if (change === 'cancelled') {
    return `A commissioner cancelled the Bloodsucker's round ${bite.round} bite on ${team}: ${reason ?? ''}`.trim();
  }
  const bloodsuckerHome = matchup?.homeMemberId === bite.bloodsuckerMemberId;
  const score = matchup
    ? bloodsuckerHome
      ? `${matchup.homeCategoryWins}-${matchup.awayCategoryWins}`
      : `${matchup.awayCategoryWins}-${matchup.homeCategoryWins}`
    : '';
  const took = `took ${name(bite.takenPlayerId)}, sending back ${name(bite.returnedPlayerId)}`;
  if (change === 'redone') {
    return `A commissioner redid the Bloodsucker's round ${bite.round} bite on ${team}: it now ${took}. Reason: ${reason ?? ''}`.trim();
  }
  return `The Bloodsucker beat ${team} ${score} and ${took}.`.replace(/\s+/g, ' ');
}

export const BLOODSUCKER_SELF_OVERRIDE_MESSAGE =
  'You play in a Bloodsucker matchup this round, so another commissioner or the owner must recalculate or finalize it.';

/**
 * BR-34 with E1: a commissioner who is the Bloodsucker, or who plays the Bloodsucker in this round,
 * cannot recalculate or force-finalize it. Another commissioner or the owner can; otherwise the round
 * waits for automatic scoring.
 */
export async function isBloodsuckerRoundSelfOverride(input: {
  leagueId: string;
  round: number;
  memberId: string | null;
}): Promise<boolean> {
  if (!input.memberId) return false;
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: {
      settings: {
        select: { leagueFormat: true, bloodsuckerMemberId: true, competitionRulesVersion: true },
      },
      members: { where: { isActive: true }, select: { id: true } },
    },
  });
  const settings = league?.settings;
  if (!settings) return false;
  const bloodsucker = resolveBloodsuckerMemberId(
    settings,
    league.members.map((member) => member.id)
  );
  if (!bloodsucker) return false;
  const matchup = await prisma.leagueMatchup.findFirst({
    where: {
      leagueId: input.leagueId,
      round: input.round,
      fixtureVersion: settings.competitionRulesVersion,
      OR: [{ homeMemberId: bloodsucker }, { awayMemberId: bloodsucker }],
    },
    select: { homeMemberId: true, awayMemberId: true },
  });
  return matchup !== null && [matchup.homeMemberId, matchup.awayMemberId].includes(input.memberId);
}
