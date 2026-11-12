import 'server-only';

import { prisma } from '@/lib/prisma';

import { loadRoundPlayerFixtures } from './lineupService';
import { resolveCurrentCompetitionRound } from './matchupReadModel';
import { clubRecordFor, loadClubSeasonRecords, type ClubSeasonRecord } from './noLosersScreens';

/** BR-42: what a No Losers free-agent row shows about the player's club. Facts only, no odds. */
export interface NoLosersClubFact {
  record: ClubSeasonRecord;
  /** The league's current or next round's AFL game; null when the fixture is not known. */
  next: { aflRound: number; opponent: string | null; isHome: boolean | null; bye: boolean } | null;
}

/**
 * Club facts for each player in a No Losers league: his club's season W-L-D from stored results
 * and his game in the league's current (or next) round. Null outside No Losers leagues, so other
 * formats add no query and no response key.
 */
export async function loadNoLosersClubFacts({
  leagueId,
  players,
  now = new Date(),
}: {
  leagueId: string;
  players: ReadonlyArray<{ id: string; club?: string | null }>;
  now?: Date;
}): Promise<Record<string, NoLosersClubFact> | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: { select: { leagueFormat: true, competitionRulesVersion: true } } },
  });
  const settings = league?.settings;
  if (settings?.leagueFormat !== 'NO_LOSERS') return null;

  const rounds = await prisma.leagueCompetitionRound.findMany({
    where: { leagueId, fixtureVersion: settings.competitionRulesVersion },
    orderBy: { round: 'asc' },
    select: {
      round: true,
      aflRound: true,
      status: true,
      startsAt: true,
      endsAt: true,
      season: { select: { year: true } },
    },
  });
  const current = resolveCurrentCompetitionRound(rounds, now);
  const season = current?.season?.year ?? now.getFullYear();
  const withClub = players.flatMap((player) =>
    player.club ? [{ playerId: player.id, club: player.club }] : []
  );
  const [records, fixtures] = await Promise.all([
    loadClubSeasonRecords(season),
    loadRoundPlayerFixtures({ aflRound: current?.aflRound ?? null, season, players: withClub })
      // The fixture is display-only here; without it the record still shows.
      .catch(() => ({ ok: false as const })),
  ]);
  const fixturesByPlayerId = fixtures.ok ? fixtures.fixturesByPlayerId : new Map();

  const facts: Record<string, NoLosersClubFact> = {};
  for (const player of withClub) {
    const record = clubRecordFor(records, player.club);
    if (!record) continue;
    const fixture = fixturesByPlayerId.get(player.playerId);
    facts[player.playerId] = {
      record,
      next:
        fixture && current?.aflRound
          ? {
              aflRound: current.aflRound,
              opponent: fixture.opponent,
              isHome: fixture.isHome,
              bye: fixture.bye,
            }
          : null,
    };
  }
  return facts;
}
