/**
 * The league page asks for the social summary from two components at once, and on a league with no
 * active season both requests create it (#1009). Repeated rounds because one interleaving can pass
 * by luck.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/leagues/membership', () => ({ getLeagueMembershipAccess: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { ensureActiveLeagueSeason } from '@/server/leagues/social/socialAccess';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const ROUNDS = 8;
const LEAGUE = 'int-social-season-league';
const SETTINGS = 'int-social-season-settings';
const OWNER = 'int-social-season-owner';

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [],
    settingsIds: [SETTINGS],
    userIds: [OWNER],
  });

async function seedLeagueWithoutSeason() {
  await removeFixture();
  await prisma.user.create({
    data: { id: OWNER, email: `${OWNER}@statly.local`, passwordHash: 'x', displayName: OWNER },
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 1,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
      pickOrder: 'MANUAL',
      waiverRule: 'WEEKLY',
      startAt: new Date('2027-03-01T00:00:00Z'),
      timeZone: 'Australia/Melbourne',
      locked: false,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Social season',
      inviteCode: 'INTSOCS',
      ownerId: OWNER,
      settingsId: SETTINGS,
    },
  });
}

describe('ensureActiveLeagueSeason', () => {
  beforeEach(seedLeagueWithoutSeason);
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('gives concurrent first callers the same season and one set of board categories', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      if (round > 0) await seedLeagueWithoutSeason();

      const seasonIds = await Promise.all([
        ensureActiveLeagueSeason(LEAGUE),
        ensureActiveLeagueSeason(LEAGUE),
        ensureActiveLeagueSeason(LEAGUE),
      ]);

      expect(new Set(seasonIds).size).toBe(1);
      const league = await prisma.league.findUniqueOrThrow({ where: { id: LEAGUE } });
      expect(league.activeSeasonId).toBe(seasonIds[0]);
      await expect(prisma.leagueSeason.count({ where: { leagueId: LEAGUE } })).resolves.toBe(1);
      await expect(
        prisma.socialBoardCategory.count({ where: { leagueId: LEAGUE, seasonId: seasonIds[0] } })
      ).resolves.toBe(4);
    }
  });
});
