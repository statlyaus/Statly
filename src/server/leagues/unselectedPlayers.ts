import 'server-only';

import { prisma } from '@/lib/prisma';
import { getTeamName } from '@/lib/teamLogos';

import {
  normalizeRoundMatchStatus,
  type NormalizedLiveStatRow,
  type RawRoundMatch,
} from './liveStatsAdapter';

/**
 * The ETL writes stat rows only for players who took the field, so a player his club did not
 * select has no row at all. He is inferred DID_NOT_PLAY only when his club's match in the round is
 * final and every stat row for his club in that match reaches a Statly player, i.e. the club's team
 * sheet is ingested and identity-mapped. An unlinked row may be the player himself under an
 * unreviewed ETL id, so anything less keeps the round waiting
 * (docs/product/league-competition-rules.md, "Interchange autosubs").
 */

interface RoundPlayer {
  playerId: string;
  club: string | null;
}

interface RoundEvidence {
  stats: readonly NormalizedLiveStatRow[];
  matches: readonly RawRoundMatch[];
  players: readonly RoundPlayer[];
}

function clubName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? getTeamName(value) : null;
}

/** Rows of the club's one final match in the round; none when it is not final or is ambiguous. */
function teamSheetRows({ stats, matches }: Omit<RoundEvidence, 'players'>, club: string) {
  const statuses = normalizeRoundMatchStatus(matches).matches;
  const clubMatches = matches.flatMap((match, index) =>
    clubName(match.home_team) === club || clubName(match.away_team) === club
      ? [statuses[index]]
      : []
  );
  if (clubMatches.length !== 1) return [];
  const [{ matchId, status }] = clubMatches;
  if (!matchId || status !== 'final') return [];
  return stats.filter((row) => row.matchId === matchId && clubName(row.team) === club);
}

function playersWithoutRows({ stats, matches, players }: RoundEvidence) {
  const playersWithRows = new Set(stats.map((row) => row.playerId));
  return players.flatMap((player) => {
    const club = clubName(player.club);
    return club && !playersWithRows.has(player.playerId)
      ? [{ playerId: player.playerId, rows: teamSheetRows({ stats, matches }, club) }]
      : [];
  });
}

/** The stat row player ids that are Statly players, among the rows that could prove a team sheet. */
export async function loadTeamSheetStatlyPlayerIds(evidence: RoundEvidence): Promise<Set<string>> {
  const ids = [
    ...new Set(playersWithoutRows(evidence).flatMap(({ rows }) => rows.map((row) => row.playerId))),
  ];
  if (ids.length === 0) return new Set();
  const players = await prisma.player.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return new Set(players.map((player) => player.id));
}

export function inferUnselectedDidNotPlay({
  statlyPlayerIds,
  ...evidence
}: RoundEvidence & { statlyPlayerIds: ReadonlySet<string> }): string[] {
  return playersWithoutRows(evidence)
    .filter(({ rows }) => rows.length > 0 && rows.every((row) => statlyPlayerIds.has(row.playerId)))
    .map(({ playerId }) => playerId);
}
