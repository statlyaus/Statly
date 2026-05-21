import { getDefaultAflSeason } from '@/lib/aflSeason';
import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';

import type { DevFixtureLeagueReadiness, DevFixtureScenarioManifest } from '../core/types';

export async function findFixtureLeagueIds(manifest: DevFixtureScenarioManifest) {
  const leagues = await prisma.league.findMany({
    where: {
      name: {
        startsWith: manifest.leagueNamePrefix,
      },
    },
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return leagues.map((league) => league.id);
}

export async function verifyFixtureLeagues(input: {
  manifest: DevFixtureScenarioManifest;
  leagueIds?: string[];
  season?: number;
}): Promise<DevFixtureLeagueReadiness[]> {
  const season = input.season ?? getDefaultAflSeason();
  const leagueIds = input.leagueIds ?? (await findFixtureLeagueIds(input.manifest));
  const leagues = await prisma.league.findMany({
    where: {
      id: { in: leagueIds },
    },
    include: {
      settings: true,
      members: {
        include: {
          botProfile: true,
          rosterPlayers: true,
        },
      },
      drafts: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        include: {
          orders: {
            select: { slot: true },
            orderBy: { slot: 'asc' },
          },
        },
      },
    },
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
  });

  const readiness: DevFixtureLeagueReadiness[] = [];

  for (const league of leagues) {
    const scheduleSnap = await adminDb
      .collection('leagues')
      .doc(league.id)
      .collection('schedule')
      .where('season', '==', season)
      .get();
    const matchupsSnap = await adminDb
      .collection('matchups')
      .where('leagueId', '==', league.id)
      .where('season', '==', season)
      .get();

    const botCount = league.members.filter((member) => member.botProfile?.enabled).length;
    const rosteredMemberCount = league.members.filter(
      (member) =>
        member.rosterPlayers.length >= input.manifest.rosterSize + input.manifest.benchSize
    ).length;
    const rosterPlayerCount = league.members.reduce(
      (total, member) => total + member.rosterPlayers.length,
      0
    );
    const draft = league.drafts[0] ?? null;
    const issues: string[] = [];

    if (league.members.length !== input.manifest.teamsPerLeague) {
      issues.push(
        `Expected ${input.manifest.teamsPerLeague} members, found ${league.members.length}.`
      );
    }
    if (botCount !== input.manifest.botTeamsPerLeague) {
      issues.push(`Expected ${input.manifest.botTeamsPerLeague} enabled bots, found ${botCount}.`);
    }
    if (rosteredMemberCount !== input.manifest.teamsPerLeague) {
      issues.push(
        `Expected ${input.manifest.teamsPerLeague} fully rostered members, found ${rosteredMemberCount}.`
      );
    }
    if (!draft) {
      issues.push('Draft is missing.');
    } else {
      const expectedSlots = Array.from(
        { length: input.manifest.teamsPerLeague },
        (_, index) => index + 1
      );
      const draftSlots = draft.orders
        .map((order) => order.slot)
        .sort((left, right) => left - right);
      const expectedTotalPicks =
        input.manifest.teamsPerLeague * (input.manifest.rosterSize + input.manifest.benchSize);

      if (draft.orders.length !== input.manifest.teamsPerLeague) {
        issues.push(
          `Expected ${input.manifest.teamsPerLeague} draft order slots, found ${draft.orders.length}.`
        );
      }
      if (
        draftSlots.length !== expectedSlots.length ||
        draftSlots.some((slot, index) => slot !== expectedSlots[index])
      ) {
        issues.push(
          `Draft order slots must be contiguous 1-${input.manifest.teamsPerLeague}, found ${draftSlots.join(', ') || 'none'}.`
        );
      }
      if (draft.totalPicks !== expectedTotalPicks) {
        issues.push(`Expected ${expectedTotalPicks} draft picks, found ${draft.totalPicks}.`);
      }
    }
    if (scheduleSnap.size === 0) {
      issues.push('Season schedule is missing.');
    }
    if (matchupsSnap.size === 0) {
      issues.push('Season matchups are missing.');
    }

    readiness.push({
      id: league.id,
      name: league.name,
      inviteCode: league.inviteCode,
      url: `/leagues/${league.id}`,
      memberCount: league.members.length,
      botCount,
      rosteredMemberCount,
      rosterPlayerCount,
      draftStatus: draft?.status ?? null,
      seasonWeeks: scheduleSnap.size,
      matchupCount: matchupsSnap.size,
      ready: issues.length === 0,
      issues,
    });
  }

  return readiness;
}
