import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { requireActiveSeasonId } from './activeSeason';
import {
  isLineupPlayerLocked,
  loadRoundPlayerGameStarts,
  resolveStartUnknownHeldPlayerIds,
} from './lineupService';

/**
 * A player whose AFL game has started in the league's round in progress cannot be dropped, traded
 * or picked up as a free agent until the round ends (owner decisions 2026-11-08 and 2026-11-11). The lock comes from the official fixture
 * start times, the same source lineup locks use, never from a lineup row's lazily stamped
 * `lockedAt`.
 */

export interface LockedPlayer {
  playerId: string;
  name: string;
}

export type PlayerMoveLockResult =
  { ok: true; lockedPlayers: LockedPlayer[] } | { ok: false; error: string };

type RoundWindow = {
  round: number;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

function isPlayableRound(round: RoundWindow): boolean {
  return round.status !== 'NO_MATCHUP';
}

/** The latest playable round that has started and is neither finalized nor past its end. */
export function findRoundInProgress<T extends RoundWindow>(
  rounds: readonly T[],
  now: Date
): T | null {
  const inProgress = rounds.filter(
    (round) =>
      isPlayableRound(round) &&
      round.status !== 'FINAL' &&
      round.startsAt !== null &&
      round.startsAt <= now &&
      (!round.endsAt || round.endsAt > now)
  );
  return inProgress.sort((left, right) => right.round - left.round)[0] ?? null;
}

/** The first round whose lineups can still change: the round in progress, else the next to start. */
export function findFirstOpenRound(rounds: readonly RoundWindow[], now: Date): number | null {
  const inProgress = findRoundInProgress(rounds, now);
  if (inProgress) return inProgress.round;
  const upcoming = rounds
    .filter((round) => isPlayableRound(round) && (!round.startsAt || round.startsAt > now))
    .sort((left, right) => left.round - right.round)[0];
  return upcoming?.round ?? null;
}

export async function findPlayersLockedForMove({
  leagueId,
  playerIds,
  now = new Date(),
}: {
  leagueId: string;
  playerIds: readonly string[];
  now?: Date;
}): Promise<PlayerMoveLockResult> {
  const uniquePlayerIds = [...new Set(playerIds)];
  if (uniquePlayerIds.length === 0) return { ok: true, lockedPlayers: [] };

  const settings = await prisma.leagueSettings.findFirst({
    where: { league: { id: leagueId } },
    select: { competitionRulesVersion: true },
  });
  if (!settings || settings.competitionRulesVersion < 1) return { ok: true, lockedPlayers: [] };

  const rounds = await prisma.leagueCompetitionRound.findMany({
    where: { leagueId, fixtureVersion: settings.competitionRulesVersion },
    select: {
      round: true,
      aflRound: true,
      status: true,
      startsAt: true,
      endsAt: true,
      season: { select: { year: true } },
    },
  });
  const round = findRoundInProgress(rounds, now);
  if (!round) return { ok: true, lockedPlayers: [] };

  const players = await prisma.player.findMany({
    where: { id: { in: uniquePlayerIds } },
    select: { id: true, name: true, club: true },
  });
  const timing = await loadRoundPlayerGameStarts({
    aflRound: round.aflRound,
    season: round.season?.year ?? undefined,
    players: players.map((player) => ({ playerId: player.id, club: player.club })),
  });
  if (!timing.ok) return { ok: false, error: timing.error };

  const heldPlayerIds = resolveStartUnknownHeldPlayerIds(timing, round, now);
  const lockedPlayers = players
    .filter(
      (player) =>
        isLineupPlayerLocked(timing.gameStartsByPlayerId.get(player.id), now) ||
        heldPlayerIds.has(player.id)
    )
    .map((player) => ({ playerId: player.id, name: player.name }));
  return { ok: true, lockedPlayers };
}

export function describeLockedPlayers(
  lockedPlayers: readonly LockedPlayer[],
  move: 'moved' | 'picked up' = 'moved'
): string {
  if (lockedPlayers.length === 1) {
    return `${lockedPlayers[0]!.name}'s game has started; he can be ${move} after the round ends.`;
  }
  const names = lockedPlayers.map((player) => player.name);
  const list = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Games have started for ${list}; they can be ${move} after the round ends.`;
}

type LineupCleanupDb = Pick<
  Prisma.TransactionClient,
  'league' | 'leagueSettings' | 'leagueCompetitionRound' | 'leagueLineupPlayer'
>;

/**
 * Removes players who just left a member's roster from that member's unlocked lineup rows, from the
 * round in progress onward. Scored rounds and locked rows are history and stay as they are.
 */
export async function removePlayersFromOpenLineups(
  tx: LineupCleanupDb,
  input: { leagueId: string; memberId: string; playerIds: readonly string[]; now?: Date }
): Promise<number> {
  const { leagueId, memberId } = input;
  if (input.playerIds.length === 0) return 0;

  const open = await findOpenLineupRounds(tx, leagueId, input.now ?? new Date());
  if (!open) return 0;

  const removed = await tx.leagueLineupPlayer.deleteMany({
    where: {
      lockedAt: null,
      playerId: { in: [...input.playerIds] },
      lineup: {
        leagueId,
        seasonId: open.seasonId,
        memberId,
        round: { gte: open.fromRound },
        lockedAt: null,
      },
    },
  });
  return removed.count;
}

/**
 * Puts `incomingPlayerId` in the slot `outgoingPlayerId` held in a member's unlocked lineup rows,
 * from the round in progress onward (a Bloodsucker bite, BR-25). Scored rounds and locked rows stay
 * as they are. Run it before the roster swap, which then finds nothing of the outgoing player to remove.
 */
export async function replacePlayerInOpenLineups(
  tx: LineupCleanupDb,
  input: {
    leagueId: string;
    memberId: string;
    outgoingPlayerId: string;
    incomingPlayerId: string;
    now?: Date;
  }
): Promise<number> {
  const open = await findOpenLineupRounds(tx, input.leagueId, input.now ?? new Date());
  if (!open) return 0;

  const replaced = await tx.leagueLineupPlayer.updateMany({
    where: {
      lockedAt: null,
      playerId: input.outgoingPlayerId,
      lineup: {
        leagueId: input.leagueId,
        seasonId: open.seasonId,
        memberId: input.memberId,
        round: { gte: open.fromRound },
        lockedAt: null,
      },
    },
    data: { playerId: input.incomingPlayerId },
  });
  return replaced.count;
}

/** The active season and the first round whose lineups can still change; null when none can. */
async function findOpenLineupRounds(
  tx: LineupCleanupDb,
  leagueId: string,
  now: Date
): Promise<{ seasonId: string; fromRound: number } | null> {
  const [seasonId, settings] = await Promise.all([
    requireActiveSeasonId(tx, leagueId),
    tx.leagueSettings.findFirst({
      where: { league: { id: leagueId } },
      select: { competitionRulesVersion: true },
    }),
  ]);
  if (!settings || settings.competitionRulesVersion < 1) return { seasonId, fromRound: 1 };
  const rounds = await tx.leagueCompetitionRound.findMany({
    where: { leagueId, fixtureVersion: settings.competitionRulesVersion },
    select: { round: true, status: true, startsAt: true, endsAt: true },
  });
  const fromRound = findFirstOpenRound(rounds, now);
  return fromRound === null ? null : { seasonId, fromRound };
}
