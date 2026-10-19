/**
 * #955: LeagueSettings JSON columns are jsonb. Values round-trip as objects, never as double-encoded
 * strings, and the database itself rejects malformed JSON instead of readers defaulting it.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import { createCanonicalLeague } from '@/server/leagues/createLeagueService';
import { normalizeLineupSlots } from '@/server/leagues/lineupSettings';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const USER = 'int-jsonb-owner';
const LEAGUE = 'int-jsonb-league';

async function removeFixture() {
  const league = await prisma.league.findUnique({ where: { id: LEAGUE } });
  await prisma.$transaction([
    prisma.leagueMember.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.leagueSeason.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.league.deleteMany({ where: { id: LEAGUE } }),
    prisma.leagueSettings.deleteMany({ where: { id: league?.settingsId ?? '' } }),
    prisma.user.deleteMany({ where: { id: USER } }),
  ]);
}

describe('LeagueSettings jsonb columns', () => {
  beforeEach(removeFixture);
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('persists league creation settings as JSON objects that read back exactly', async () => {
    const lineupSlots = { FWD: 4, DEF: 4, MID: 6, RUC: 1, UTIL: 2 };
    const creation = await createCanonicalLeague(
      {
        userId: USER,
        identity: { leagueId: LEAGUE },
        input: {
          name: 'Jsonb League',
          type: 'private',
          maxTeams: 8,
          categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
          timeZone: 'Australia/Melbourne',
          draftType: 'snake',
          pickOrder: 'random',
          waiverRule: 'weekly',
          lineupSlots,
          categoryDirections: { tackles: 'LOW_WINS' },
        },
      },
      { generateInviteCode: () => 'JSONB955' }
    );

    const settings = await prisma.leagueSettings.findUniqueOrThrow({
      where: { id: creation.settingsId },
    });
    expect(settings.lineupSlotsJson).toEqual(lineupSlots);
    expect(normalizeLineupSlots(settings.lineupSlotsJson)).toEqual(lineupSlots);
    expect(typeof settings.categoryDirectionsJson).toBe('object');
    expect(
      normalizeCategoryDirections(REAL_DATA_NINE_CATEGORY_PRESET, settings.categoryDirectionsJson)
    ).toMatchObject({ tackles: 'LOW_WINS', goals: 'HIGH_WINS' });

    const [stored] = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT jsonb_typeof("lineupSlotsJson") AS type FROM "LeagueSettings"
      WHERE "id" = ${creation.settingsId}`;
    expect(stored.type).toBe('object');
  });

  it('rejects a malformed JSON write at the database', async () => {
    const creation = await createCanonicalLeague(
      {
        userId: USER,
        identity: { leagueId: LEAGUE },
        input: {
          name: 'Jsonb League',
          type: 'private',
          maxTeams: 8,
          categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
          timeZone: 'Australia/Melbourne',
          draftType: 'snake',
          pickOrder: 'random',
          waiverRule: 'weekly',
        },
      },
      { generateInviteCode: () => 'JSONB956' }
    );

    // An untyped literal is coerced to the column type, so a text column would have accepted it.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "LeagueSettings" SET "competitionRulesJson" = '{"finalsTeams": 4' WHERE "id" = $1`,
        creation.settingsId
      )
    ).rejects.toThrow(/invalid input syntax for type json/);
  });
});
