import type { PrismaClient } from '@prisma/client';

// Legacy rosters, team actions and waiver priorities have no foreign keys; members, drafts and picks
// do not cascade from League; trade rows restrict member deletion. So fixtures are removed child-first,
// and everything else cascades from the member, league or player.
export async function deleteLeagueFixtures(
  client: PrismaClient,
  fixtures: { leagueIds: string[]; playerIds: string[]; settingsIds: string[]; userIds: string[] }
): Promise<void> {
  const league = { leagueId: { in: fixtures.leagueIds } };
  await client.$transaction([
    client.leagueTradeThread.deleteMany({ where: league }),
    client.pick.deleteMany({ where: { draft: league } }),
    client.draftOrder.deleteMany({ where: { draft: league } }),
    client.draft.deleteMany({ where: league }),
    client.leagueRoster.deleteMany({ where: league }),
    client.teamAction.deleteMany({ where: league }),
    client.waiverPriority.deleteMany({ where: league }),
    client.leagueMember.deleteMany({ where: league }),
    client.league.deleteMany({ where: { id: { in: fixtures.leagueIds } } }),
    client.player.deleteMany({ where: { id: { in: fixtures.playerIds } } }),
    client.leagueSettings.deleteMany({ where: { id: { in: fixtures.settingsIds } } }),
    client.user.deleteMany({ where: { id: { in: fixtures.userIds } } }),
  ]);
}
