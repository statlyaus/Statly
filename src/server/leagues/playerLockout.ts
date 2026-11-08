import 'server-only';

import { prisma } from '@/lib/prisma';
import { loadRoundPlayerGameStarts } from '@/server/leagues/lineupService';

/**
 * Rolling lockout: once a player's AFL game has started in the round in progress, he cannot be
 * dropped (directly or as a waiver drop) or traded until that round ends. A player whose game start
 * is unknown is held too, as lineups hold him, and the check fails closed when match times cannot
 * be read.
 */
export type PlayerLockout =
  | { ok: true; lockedPlayerIds: ReadonlySet<string> }
  | { ok: false; code: 'LOCK_TIMING_UNAVAILABLE'; reason: string };

export const PLAYER_LOCKED_REASON =
  "A player whose AFL game has started this round can't be dropped or traded until the round ends.";

const TIMING_UNAVAILABLE: PlayerLockout = {
  ok: false,
  code: 'LOCK_TIMING_UNAVAILABLE',
  reason:
    'Official AFL match times are unavailable right now, so drops and trades are paused. Try again soon.',
};

const NONE_LOCKED: PlayerLockout = { ok: true, lockedPlayerIds: new Set() };

export async function findLockedOutPlayers({
  leagueId,
  playerIds,
  now = new Date(),
}: {
  leagueId: string;
  playerIds: readonly string[];
  now?: Date;
}): Promise<PlayerLockout> {
  if (playerIds.length === 0) return NONE_LOCKED;

  const settings = await prisma.leagueSettings.findFirst({
    where: { league: { id: leagueId } },
    select: { competitionRulesVersion: true },
  });
  if (!settings || settings.competitionRulesVersion < 1) return NONE_LOCKED;

  const round = await prisma.leagueCompetitionRound.findFirst({
    where: {
      leagueId,
      fixtureVersion: settings.competitionRulesVersion,
      status: { notIn: ['NO_MATCHUP', 'FINAL'] },
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: { startsAt: 'desc' },
    select: { aflRound: true, season: { select: { year: true } } },
  });
  if (!round?.aflRound) return NONE_LOCKED;

  const players = await prisma.player.findMany({
    where: { id: { in: [...playerIds] } },
    select: { id: true, club: true },
  });
  const timing = await loadRoundPlayerGameStarts({
    aflRound: round.aflRound,
    season: round.season?.year ?? undefined,
    players: players.map((player) => ({ playerId: player.id, club: player.club })),
  });
  if (!timing.ok) return TIMING_UNAVAILABLE;

  const lockedPlayerIds = new Set<string>(timing.startUnknownPlayerIds);
  for (const [playerId, startsAt] of timing.gameStartsByPlayerId) {
    if (startsAt <= now) lockedPlayerIds.add(playerId);
  }
  return { ok: true, lockedPlayerIds };
}
