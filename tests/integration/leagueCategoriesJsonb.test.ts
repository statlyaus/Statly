/**
 * #955 cohort 2: League.categoriesJson, LeagueMember.notificationSettingsJson and
 * LeagueMatchupScore.categoriesJson are jsonb. Values round-trip as arrays and objects, never as
 * double-encoded strings, and the database itself rejects malformed JSON.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { createCanonicalLeague } from '@/server/leagues/createLeagueService';
import { parseLeagueCategories } from '@/server/leagues/defaultLineups';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const USER = 'int-jsonb-c2-owner';
const LEAGUE = 'int-jsonb-c2-league';

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

async function createLeague(inviteCode: string) {
  return createCanonicalLeague(
    {
      userId: USER,
      identity: { leagueId: LEAGUE },
      input: {
        name: 'Jsonb Cohort Two',
        type: 'private',
        maxTeams: 8,
        categories: ['goals', 'tackles', 'inside50s'],
        timeZone: 'Australia/Melbourne',
        draftType: 'snake',
        pickOrder: 'random',
        waiverRule: 'weekly',
      },
    },
    { generateInviteCode: () => inviteCode }
  );
}

describe('League categories and member notification settings jsonb columns', () => {
  beforeEach(removeFixture);
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('stores all three columns as jsonb', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; data_type: string }>
    >`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE (table_name, column_name) IN (
        ('League', 'categoriesJson'),
        ('LeagueMember', 'notificationSettingsJson'),
        ('LeagueMatchupScore', 'categoriesJson')
      )
      ORDER BY table_name`;
    expect(columns.map((column) => column.data_type)).toEqual(['jsonb', 'jsonb', 'jsonb']);
  });

  it('persists league categories as a JSON array that reads back exactly', async () => {
    await createLeague('JSONBC21');

    const league = await prisma.league.findUniqueOrThrow({ where: { id: LEAGUE } });
    expect(league.categoriesJson).toEqual(['goals', 'tackles', 'inside50s']);
    expect(parseLeagueCategories(league.categoriesJson)).toEqual(['goals', 'tackles', 'inside50s']);
    expect(parseLeagueCategories(null)).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);

    const [stored] = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT jsonb_typeof("categoriesJson") AS type FROM "League" WHERE "id" = ${LEAGUE}`;
    expect(stored.type).toBe('array');
  });

  it('round-trips member notification settings as an object', async () => {
    await createLeague('JSONBC22');
    const settings = {
      tradePush: true,
      waiverPush: false,
      draftReminder: true,
      scoringAlerts: false,
    };

    const member = await prisma.leagueMember.findFirstOrThrow({ where: { leagueId: LEAGUE } });
    await prisma.leagueMember.update({
      where: { id: member.id },
      data: { notificationSettingsJson: settings },
    });

    const stored = await prisma.leagueMember.findUniqueOrThrow({ where: { id: member.id } });
    expect(stored.notificationSettingsJson).toEqual(settings);
  });

  it('rejects malformed JSON writes at the database', async () => {
    await createLeague('JSONBC23');
    const member = await prisma.leagueMember.findFirstOrThrow({ where: { leagueId: LEAGUE } });

    // An untyped literal is coerced to the column type, so a text column would have accepted it.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "League" SET "categoriesJson" = '["goals"' WHERE "id" = $1`,
        LEAGUE
      )
    ).rejects.toThrow(/invalid input syntax for type json/);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "LeagueMember" SET "notificationSettingsJson" = 'goals,tackles' WHERE "id" = $1`,
        member.id
      )
    ).rejects.toThrow(/invalid input syntax for type json/);
  });
});
