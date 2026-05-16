import { prisma } from '@/lib/prisma';

import type { DevFixtureScenarioManifest, DevFixtureStepResult } from '../core/types';

export async function resetFixtureLeagues(input: {
  manifest: DevFixtureScenarioManifest;
}): Promise<DevFixtureStepResult[]> {
  const leagues = await prisma.league.findMany({
    where: {
      name: {
        startsWith: input.manifest.leagueNamePrefix,
      },
    },
    select: {
      id: true,
      settingsId: true,
    },
  });

  const leagueIds = leagues.map((league) => league.id);
  const settingsIds = leagues.map((league) => league.settingsId);

  if (leagueIds.length === 0) {
    return [{ name: 'reset', status: 'skipped', detail: 'No fixture leagues found.' }];
  }

  const drafts = await prisma.draft.findMany({
    where: { leagueId: { in: leagueIds } },
    select: { id: true },
  });
  const draftIds = drafts.map((draft) => draft.id);
  const trades = await prisma.trade.findMany({
    where: { leagueId: { in: leagueIds } },
    select: { id: true },
  });
  const tradeIds = trades.map((trade) => trade.id);

  await prisma.$transaction(
    async (tx) => {
      await tx.tradeAction.deleteMany({ where: { tradeId: { in: tradeIds } } });
      await tx.tradeReviewVote.deleteMany({ where: { tradeId: { in: tradeIds } } });
      await tx.tradeAudit.deleteMany({ where: { tradeId: { in: tradeIds } } });
      await tx.tradePlayerLock.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.tradeItem.deleteMany({ where: { tradeId: { in: tradeIds } } });
      await tx.trade.deleteMany({ where: { id: { in: tradeIds } } });
      await tx.teamAction.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.waiverClaim.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.waiverPriority.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.leagueRosterPlayerSummary.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.leagueRosterPlayer.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.leagueRoster.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.leagueBotProfile.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.draftEvent.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.draftWatchlist.deleteMany({ where: { draftId: { in: draftIds } } });
      await tx.preDraftQueue.deleteMany({ where: { draftId: { in: draftIds } } });
      await tx.lobbyActivity.deleteMany({ where: { draftId: { in: draftIds } } });
      await tx.pick.deleteMany({ where: { draftId: { in: draftIds } } });
      await tx.draftOrder.deleteMany({ where: { draftId: { in: draftIds } } });
      await tx.draft.deleteMany({ where: { id: { in: draftIds } } });
      await tx.leagueMember.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.league.deleteMany({ where: { id: { in: leagueIds } } });
      await tx.leagueSettings.deleteMany({ where: { id: { in: settingsIds } } });
    },
    { timeout: 30000 }
  );

  return [
    {
      name: 'reset',
      status: 'updated',
      detail: `Deleted ${leagueIds.length} fixture leagues and owned children.`,
    },
  ];
}
