import 'server-only';

import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

export async function getLeagueOwnershipMap(
  leagueId: string,
  playerIds?: Iterable<string>
): Promise<{ totalTeams: number; counts: Map<string, number> }> {
  const filterSet = playerIds ? new Set(Array.from(playerIds).map(String)) : null;
  const filteredIds = filterSet ? Array.from(filterSet) : undefined;
  const ownership = await leagueApplicationService.getLeagueOwnershipStats({
    leagueId,
    playerIds: filteredIds,
  });
  return { totalTeams: ownership.totalTeams, counts: ownership.counts };
}

export async function getLeagueOwnershipDetails(
  leagueId: string,
  playerIds?: Iterable<string>
): Promise<{
  totalTeams: number;
  counts: Map<string, number>;
  owners: Map<string, string[]>;
}> {
  const filterSet = playerIds ? new Set(Array.from(playerIds).map(String)) : null;
  const filteredIds = filterSet ? Array.from(filterSet) : undefined;
  return leagueApplicationService.getLeagueOwnershipStats({
    leagueId,
    playerIds: filteredIds,
  });
}
