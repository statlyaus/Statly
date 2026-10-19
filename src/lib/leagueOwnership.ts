import { prisma } from '@/lib/prisma';

export interface LeagueOwnershipMap {
  totalTeams: number;
  counts: Map<string, number>;
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

  // Query LeagueRosterPlayer for ownership of the requested players
  const ownedPlayers = await prisma.leagueRosterPlayer.findMany({
    where: { leagueId, playerId: { in: requestedPlayerIds } },
    select: { playerId: true },
  });

  for (const { playerId } of ownedPlayers) {
    counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
  }

  return { totalTeams, counts };
}
