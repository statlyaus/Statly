/**
 * A competition published before the AFL fixture was loaded has rounds with no start time, and
 * publication happens once. The hourly scoring job fills in those start times from the loaded
 * fixture, so such a round is scored once its AFL matches start (process-map finding league-07).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const fixture = vi.hoisted(() => ({ matches: [] as Array<Record<string, unknown>> }));
vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatches: vi.fn((season: number, round: number) =>
    Promise.resolve(
      fixture.matches.filter((match) => match.season === season && match.round_number === round)
    )
  ),
  getRoundMatchesResult: vi.fn().mockResolvedValue({ ok: true, matches: [] }),
  getRoundPlayerStatsResult: vi.fn().mockResolvedValue({ ok: true, stats: [] }),
}));

import { prisma } from '@/lib/prisma';
import { scoreStartedLeagueRounds } from '@/server/leagues/roundScoringSchedule';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-round-start-league';
const SETTINGS = 'int-round-start-settings';
const OWNER = 'int-round-start-owner';
const MEMBER = 'int-round-start-member';
const SEASON = 'int-round-start-2026';

const AFL_ROUND = 3;
const FIRST_BOUNCE = new Date('2026-03-26T08:30:00.000Z');
const NOW = new Date('2026-03-27T00:00:00.000Z');

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [],
    settingsIds: [SETTINGS],
    userIds: [OWNER],
  });

/** A league published at fixture version 2 while the AFL fixture had not been loaded. */
async function seedLeaguePublishedWithoutFixture() {
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
      timeZone: 'Australia/Melbourne',
      locked: false,
      competitionRulesVersion: 2,
      competitionStatus: 'PENDING',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Round start',
      inviteCode: 'INTRSTA',
      ownerId: OWNER,
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueSeason.create({
    data: { id: SEASON, leagueId: LEAGUE, label: '2026 season', year: 2026 },
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  await prisma.leagueMember.create({
    data: { id: MEMBER, leagueId: LEAGUE, userId: OWNER, role: 'OWNER', teamName: 'Owner' },
  });

  // Version 1 is an older fixture: it must stay as it was.
  for (const fixtureVersion of [1, 2]) {
    const competitionRound = await prisma.leagueCompetitionRound.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        fixtureVersion,
        round: 1,
        aflRound: AFL_ROUND,
        status: 'PENDING',
        startsAt: null,
        publishedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    await prisma.leagueMatchup.create({
      data: {
        leagueId: LEAGUE,
        round: 1,
        fixtureVersion,
        competitionRoundId: competitionRound.id,
        homeMemberId: MEMBER,
      },
    });
  }
}

const recalculate = vi.fn(({ round }: { round: number }) =>
  Promise.resolve({
    status: 'LIVE' as const,
    recalculated: round,
    roundStatus: { hasUnavailableStatus: false, matches: [] },
  })
);

function currentRound() {
  return prisma.leagueCompetitionRound.findUniqueOrThrow({
    where: { leagueId_fixtureVersion_round: { leagueId: LEAGUE, fixtureVersion: 2, round: 1 } },
    select: { status: true, startsAt: true, matchups: { select: { startsAt: true } } },
  });
}

describe('rounds published before the AFL fixture was loaded', () => {
  beforeEach(async () => {
    fixture.matches = [];
    recalculate.mockClear();
    await seedLeaguePublishedWithoutFixture();
  });

  afterAll(removeFixture);

  it('stay pending and unscored while the fixture has no matches for the round', async () => {
    const run = await scoreStartedLeagueRounds(NOW, recalculate as never);

    expect(run.leagues.find((league) => league.leagueId === LEAGUE)).toBeUndefined();
    expect(recalculate).not.toHaveBeenCalledWith(expect.objectContaining({ leagueId: LEAGUE }));
    await expect(currentRound()).resolves.toEqual({
      status: 'PENDING',
      startsAt: null,
      matchups: [{ startsAt: null }],
    });
  });

  it('take the first bounce as their start time once fixtures land, and are scored', async () => {
    fixture.matches = [
      {
        season: 2026,
        round_number: AFL_ROUND,
        match_uid: '2026-R3-RIC-CAR',
        start_time_utc: FIRST_BOUNCE.toISOString(),
        status: 'final',
      },
      {
        season: 2026,
        round_number: AFL_ROUND,
        match_uid: '2026-R3-GEE-HAW',
        start_time_utc: '2026-03-28T05:15:00.000Z',
        status: 'scheduled',
      },
    ];

    const run = await scoreStartedLeagueRounds(NOW, recalculate as never);

    expect(recalculate).toHaveBeenCalledWith({ leagueId: LEAGUE, round: 1, finalize: false });
    expect(run.leagues.find((league) => league.leagueId === LEAGUE)).toEqual({
      leagueId: LEAGUE,
      rounds: [{ round: 1, status: 'LIVE', recalculated: 1 }],
    });
    await expect(currentRound()).resolves.toEqual({
      status: 'SCHEDULED',
      startsAt: FIRST_BOUNCE,
      matchups: [{ startsAt: FIRST_BOUNCE }],
    });

    const olderVersion = await prisma.leagueCompetitionRound.findUniqueOrThrow({
      where: { leagueId_fixtureVersion_round: { leagueId: LEAGUE, fixtureVersion: 1, round: 1 } },
      select: { status: true, startsAt: true },
    });
    expect(olderVersion).toEqual({ status: 'PENDING', startsAt: null });
  });

  it('get a start time before kick-off but wait for it to be scored', async () => {
    fixture.matches = [
      {
        season: 2026,
        round_number: AFL_ROUND,
        match_uid: '2026-R3-RIC-CAR',
        start_time_utc: FIRST_BOUNCE.toISOString(),
        status: 'scheduled',
      },
    ];

    await scoreStartedLeagueRounds(new Date('2026-03-20T00:00:00.000Z'), recalculate as never);

    expect(recalculate).not.toHaveBeenCalledWith(expect.objectContaining({ leagueId: LEAGUE }));
    await expect(currentRound()).resolves.toMatchObject({
      status: 'SCHEDULED',
      startsAt: FIRST_BOUNCE,
    });
  });
});
