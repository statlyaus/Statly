import { prisma } from '@/lib/prisma';

export interface LeagueOwnershipMap {
  totalTeams: number;
  counts: Map<string, number>;
}

function parsePlayerIds(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function getLeagueOwnershipMap(
  leagueId: string,
  playerIds: readonly string[]
): Promise<LeagueOwnershipMap> {
  const requestedPlayerIds = Array.from(new Set(playerIds.map(String).filter(Boolean)));
  const counts = new Map(requestedPlayerIds.map((playerId) => [playerId, 0]));

  if (!leagueId) {
    return { totalTeams: 0, counts };
  }

  const totalTeams = await prisma.leagueMember.count({ where: { leagueId } });

  if (requestedPlayerIds.length === 0) {
    return { totalTeams, counts };
  }

  const rosters = await prisma.leagueRoster.findMany({
    where: { leagueId },
    select: { playerIds: true },
  });

  for (const roster of rosters) {
    const rosterPlayerIds = new Set(parsePlayerIds(roster.playerIds));
    for (const playerId of requestedPlayerIds) {
      if (rosterPlayerIds.has(playerId)) {
        counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
      }
    }
  }

  return { totalTeams, counts };
}
