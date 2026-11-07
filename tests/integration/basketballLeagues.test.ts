import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/lib/prisma';
import {
  addBasketballRosterSpots,
  clearBasketballMatchup,
  createBasketballLeague,
  deleteBasketballLeague,
  removeBasketballRosterSpot,
  setBasketballLeagueTeams,
  setBasketballMatchup,
  updateBasketballLeague,
  updateBasketballRosterSpot,
} from '@/server/basketball/leagues/basketballLeagueCommands';
import {
  getBasketballLeagueDetail,
  listBasketballLeagues,
  loadOwnedBasketballLeague,
  matchPastedRoster,
  searchNbaPlayers,
} from '@/server/basketball/leagues/basketballLeagueQueries';
import { YAHOO_DEFAULT_ROSTER_SLOTS } from '@/types/basketball';

const PREFIX = 'int-bball-leagues';
const OWNER = `${PREFIX}-owner`;
const INTRUDER = `${PREFIX}-intruder`;
const NBA_TEAMS = [
  { id: `${PREFIX}-team-a`, code: 'IBLA', name: 'Integration Alphas' },
  { id: `${PREFIX}-team-b`, code: 'IBLB', name: 'Integration Bravos' },
];
const PLAYERS = {
  jokic: { id: `${PREFIX}-jokic`, fullName: 'Nikola Jokić', lastName: 'Jokić', positions: ['C'] },
  zeb: {
    id: `${PREFIX}-zeb`,
    fullName: 'Zebulon Quixley',
    lastName: 'Quixley',
    positions: ['PG', 'SG'],
  },
  zach: {
    id: `${PREFIX}-zach`,
    fullName: 'Zachary Quixley',
    lastName: 'Quixley',
    positions: ['SF'],
    active: false,
  },
  vale: {
    id: `${PREFIX}-vale`,
    fullName: 'Yannick Ørsted-Vale',
    lastName: 'Ørsted-Vale',
    positions: ['PF'],
  },
};

const createInput = {
  name: 'REC Bible',
  platform: 'YAHOO',
  format: 'H2H_MOST_CATEGORIES',
  categories: ['TO', 'PTS', 'FG_PCT', 'REB'],
  puntCategories: ['TO'],
  teamCount: 4,
  rosterSlots: YAHOO_DEFAULT_ROSTER_SLOTS,
  weekOneStartsOn: '2026-10-19',
  regularSeasonEndsOn: '2027-04-11',
  auctionBudget: 200,
  myTeamName: 'Bobby Buckets',
  otherTeamNames: ['Second Team', 'Third Team'],
};

async function removeFixtures(): Promise<void> {
  await prisma.basketballLeague.deleteMany({ where: { ownerId: { in: [OWNER, INTRUDER] } } });
  await prisma.nbaPlayer.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.nbaTeam.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, INTRUDER] } } });
}

beforeAll(async () => {
  await removeFixtures();
  await prisma.nbaTeam.createMany({ data: NBA_TEAMS });
  await prisma.nbaPlayer.createMany({
    data: Object.values(PLAYERS).map((player, index) => ({
      ...player,
      teamId: NBA_TEAMS[index % 2].id,
    })),
  });
  await prisma.nbaPlayerInjury.create({
    data: {
      playerId: PLAYERS.vale.id,
      status: 'DAY_TO_DAY',
      detail: 'Ankle',
      expectedReturnOn: new Date('2026-11-10T00:00:00Z'),
      fetchedAt: new Date(),
    },
  });
});

beforeEach(async () => {
  await prisma.basketballLeague.deleteMany({ where: { ownerId: { in: [OWNER, INTRUDER] } } });
});

afterAll(async () => {
  await prisma.nbaPlayerInjury.deleteMany({ where: { playerId: { startsWith: PREFIX } } });
  await removeFixtures();
});

async function expectError(promise: Promise<unknown>, code: string): Promise<unknown> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (caught: unknown) => caught
  );
  expect(error).toMatchObject({ code });
  return error;
}

describe('basketball league profiles', () => {
  it('creates a profile with the lazily created user, its teams and the season it ends in', async () => {
    const league = await createBasketballLeague(OWNER, createInput);

    expect(league).toMatchObject({
      name: 'REC Bible',
      platform: 'YAHOO',
      format: 'H2H_MOST_CATEGORIES',
      season: 2027,
      categories: ['FG_PCT', 'PTS', 'REB', 'TO'],
      puntCategories: ['TO'],
      teamCount: 4,
      rosterSlots: YAHOO_DEFAULT_ROSTER_SLOTS,
      weekOneStartsOn: '2026-10-19',
      regularSeasonEndsOn: '2027-04-11',
      twoWeekMatchups: [],
      auctionBudget: 200,
      rosterSpots: [],
      matchups: [],
    });
    expect(league.teams.map(({ name, isMine }) => [name, isMine])).toEqual([
      ['Bobby Buckets', true],
      ['Second Team', false],
      ['Third Team', false],
    ]);
    expect(league.myTeamId).toBe(league.teams[0].id);
    expect(await prisma.user.findUnique({ where: { id: OWNER } })).not.toBeNull();

    expect(await listBasketballLeagues(OWNER)).toEqual([
      expect.objectContaining({ id: league.id, myTeamName: 'Bobby Buckets', season: 2027 }),
    ]);
    expect(await getBasketballLeagueDetail(OWNER, league.id)).toEqual(league);
  });

  it('rejects invalid input before writing anything', async () => {
    await expectError(
      createBasketballLeague(OWNER, { ...createInput, teamCount: 1 }),
      'VALIDATION'
    );
    expect(await listBasketballLeagues(OWNER)).toEqual([]);
  });

  it('answers 404 to anyone but the owner, exactly as for a missing league', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const other = league.teams[1].id;

    const attempts: Array<() => Promise<unknown>> = [
      () => getBasketballLeagueDetail(INTRUDER, league.id),
      () => updateBasketballLeague(INTRUDER, league.id, { name: 'Mine now' }),
      () => deleteBasketballLeague(INTRUDER, league.id),
      () => setBasketballLeagueTeams(INTRUDER, league.id, { teams: [{ name: 'Mine now' }] }),
      () =>
        addBasketballRosterSpots(INTRUDER, league.id, {
          entries: [{ playerId: PLAYERS.jokic.id, teamId: null }],
        }),
      () =>
        updateBasketballRosterSpot(INTRUDER, league.id, PLAYERS.jokic.id, { onInjuredList: true }),
      () => removeBasketballRosterSpot(INTRUDER, league.id, PLAYERS.jokic.id),
      () => setBasketballMatchup(INTRUDER, league.id, 1, { opponentTeamId: other }),
      () => clearBasketballMatchup(INTRUDER, league.id, 1),
      () => matchPastedRoster(INTRUDER, league.id, { text: 'Nikola Jokic' }),
    ];
    for (const attempt of attempts) {
      const error = await expectError(attempt(), 'NOT_FOUND');
      const missing = await getBasketballLeagueDetail(OWNER, 'no-such-league').catch(
        (caught: unknown) => caught
      );
      expect(error).toEqual(missing);
    }

    expect(await loadOwnedBasketballLeague(INTRUDER, league.id)).toBeNull();
    expect(await loadOwnedBasketballLeague(OWNER, league.id)).toMatchObject({ id: league.id });
    expect(await listBasketballLeagues(INTRUDER)).toEqual([]);
    expect((await getBasketballLeagueDetail(OWNER, league.id)).name).toBe('REC Bible');
  });

  it('updates settings by validating the merged result', async () => {
    const league = await createBasketballLeague(OWNER, createInput);

    const updated = await updateBasketballLeague(OWNER, league.id, {
      name: 'REC Bible 2',
      puntCategories: ['FG_PCT'],
      auctionBudget: null,
      twoWeekMatchups: [18],
    });
    expect(updated).toMatchObject({
      name: 'REC Bible 2',
      puntCategories: ['FG_PCT'],
      auctionBudget: null,
      twoWeekMatchups: [18],
      categories: ['FG_PCT', 'PTS', 'REB', 'TO'],
    });

    const punted = await expectError(
      updateBasketballLeague(OWNER, league.id, { categories: ['PTS', 'REB'] }),
      'VALIDATION'
    );
    expect(punted).toMatchObject({
      details: { fieldErrors: { puntCategories: expect.any(Array) } },
    });

    const shrunk = await expectError(
      updateBasketballLeague(OWNER, league.id, { teamCount: 2 }),
      'VALIDATION'
    );
    expect(shrunk).toMatchObject({ details: { fieldErrors: { teamCount: expect.any(Array) } } });

    await expectError(
      updateBasketballLeague(OWNER, league.id, { ownerId: INTRUDER }),
      'VALIDATION'
    );
  });

  it('refuses to shorten the season past a week that has a matchup', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    await setBasketballMatchup(OWNER, league.id, 25, { opponentTeamId: league.teams[1].id });

    const stranded = await expectError(
      updateBasketballLeague(OWNER, league.id, { regularSeasonEndsOn: '2027-03-01' }),
      'VALIDATION'
    );
    expect(stranded).toMatchObject({
      details: { fieldErrors: { regularSeasonEndsOn: expect.any(Array) } },
    });
  });

  it('names the season by the year it ends, even for a profile that stops early', async () => {
    const truncated = await createBasketballLeague(OWNER, {
      ...createInput,
      regularSeasonEndsOn: '2026-12-31',
    });
    const lateStart = await createBasketballLeague(OWNER, {
      ...createInput,
      name: 'Second half',
      weekOneStartsOn: '2027-01-04',
      regularSeasonEndsOn: '2027-04-11',
    });

    expect(truncated.season).toBe(2027);
    expect(lateStart.season).toBe(2027);
  });

  it('allows only one team marked as the user’s own per league', async () => {
    const league = await createBasketballLeague(OWNER, createInput);

    await expect(
      prisma.basketballLeagueTeam.create({
        data: { leagueId: league.id, name: 'Second mine', isMine: true },
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('deletes a profile with its teams, spots and matchups, but never NBA players', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    await addBasketballRosterSpots(OWNER, league.id, {
      entries: [{ playerId: PLAYERS.jokic.id, teamId: league.myTeamId }],
    });
    await setBasketballMatchup(OWNER, league.id, 1, { opponentTeamId: league.teams[1].id });

    expect(await deleteBasketballLeague(OWNER, league.id)).toEqual({ id: league.id });

    expect(await prisma.basketballLeagueTeam.count({ where: { leagueId: league.id } })).toBe(0);
    expect(await prisma.basketballRosterSpot.count({ where: { leagueId: league.id } })).toBe(0);
    expect(await prisma.basketballMatchup.count({ where: { leagueId: league.id } })).toBe(0);
    expect(await prisma.nbaPlayer.count({ where: { id: PLAYERS.jokic.id } })).toBe(1);
    await expectError(deleteBasketballLeague(OWNER, league.id), 'NOT_FOUND');
  });
});

describe('basketball league teams', () => {
  it('renames, adds and removes teams, removing a team’s roster spots with it', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const [mine, , third] = league.teams;
    await addBasketballRosterSpots(OWNER, league.id, {
      entries: [{ playerId: PLAYERS.zeb.id, teamId: third.id }],
    });

    const updated = await setBasketballLeagueTeams(OWNER, league.id, {
      teams: [
        { id: mine.id, name: 'Third Team' },
        { id: third.id, name: 'Bobby Buckets' },
        { name: 'Fourth Team' },
      ],
    });

    expect(updated.teams.map(({ id, name, isMine }) => [id, name, isMine])).toEqual([
      [mine.id, 'Third Team', true],
      [third.id, 'Bobby Buckets', false],
      [expect.any(String), 'Fourth Team', false],
    ]);
    expect(updated.rosterSpots).toEqual([expect.objectContaining({ playerId: PLAYERS.zeb.id })]);

    const removed = await setBasketballLeagueTeams(OWNER, league.id, {
      teams: [{ id: mine.id, name: 'Third Team' }],
    });
    expect(removed.teams).toHaveLength(1);
    expect(removed.rosterSpots).toEqual([]);
  });

  it('never removes the user’s own team and keeps within the team count', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const [, second] = league.teams;

    await expectError(
      setBasketballLeagueTeams(OWNER, league.id, { teams: [{ id: second.id, name: 'Only' }] }),
      'VALIDATION'
    );
    await expectError(
      setBasketballLeagueTeams(OWNER, league.id, {
        teams: [
          { id: league.myTeamId, name: 'Mine' },
          ...['A', 'B', 'C', 'D'].map((name) => ({ name })),
        ],
      }),
      'VALIDATION'
    );
  });

  it('rejects a team id from another league', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const otherLeague = await createBasketballLeague(OWNER, { ...createInput, name: 'Other' });

    await expectError(
      setBasketballLeagueTeams(OWNER, league.id, {
        teams: [
          { id: league.myTeamId, name: 'Mine' },
          { id: otherLeague.teams[1].id, name: 'Stolen' },
        ],
      }),
      'VALIDATION'
    );
    expect((await getBasketballLeagueDetail(OWNER, otherLeague.id)).teams[1].name).toBe(
      'Second Team'
    );
  });
});

describe('basketball roster spots', () => {
  it('defaults acquiredOn to the first day of the current fantasy week', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    // Thursday 5 Nov 2026, 10 am US Eastern: week 3 runs Monday 2 Nov to Sunday 8 Nov.
    const now = new Date('2026-11-05T15:00:00Z');

    const updated = await addBasketballRosterSpots(
      OWNER,
      league.id,
      {
        entries: [
          { playerId: PLAYERS.jokic.id, teamId: league.myTeamId },
          { playerId: PLAYERS.zeb.id, teamId: null, acquiredOn: '2026-11-04' },
        ],
      },
      { now }
    );

    expect(updated.rosterSpots).toEqual([
      {
        playerId: PLAYERS.jokic.id,
        teamId: league.myTeamId,
        onInjuredList: false,
        acquiredOn: '2026-11-02',
        player: {
          fullName: 'Nikola Jokić',
          teamCode: 'IBLA',
          positions: ['C'],
          active: true,
          injury: null,
        },
      },
      expect.objectContaining({ playerId: PLAYERS.zeb.id, teamId: null, acquiredOn: '2026-11-04' }),
    ]);
  });

  it('moves a player already in the league instead of adding him twice', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const [mine, second] = league.teams;
    await addBasketballRosterSpots(
      OWNER,
      league.id,
      { entries: [{ playerId: PLAYERS.vale.id, teamId: mine.id, onInjuredList: true }] },
      { now: new Date('2026-10-20T15:00:00Z') }
    );

    const moved = await addBasketballRosterSpots(
      OWNER,
      league.id,
      { entries: [{ playerId: PLAYERS.vale.id, teamId: second.id }] },
      { now: new Date('2026-11-05T15:00:00Z') }
    );

    expect(moved.rosterSpots).toEqual([
      {
        playerId: PLAYERS.vale.id,
        teamId: second.id,
        onInjuredList: false,
        acquiredOn: '2026-11-02',
        player: expect.objectContaining({
          injury: { status: 'DAY_TO_DAY', detail: 'Ankle', expectedReturnOn: '2026-11-10' },
        }),
      },
    ]);
  });

  it('rejects a team from another league and an unknown player, writing nothing', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const otherLeague = await createBasketballLeague(OWNER, { ...createInput, name: 'Other' });

    const error = await expectError(
      addBasketballRosterSpots(OWNER, league.id, {
        entries: [
          { playerId: PLAYERS.jokic.id, teamId: league.myTeamId },
          { playerId: PLAYERS.zeb.id, teamId: otherLeague.myTeamId },
          { playerId: `${PREFIX}-nobody`, teamId: null },
        ],
      }),
      'VALIDATION'
    );

    expect(error).toMatchObject({
      details: {
        fieldErrors: {
          'entries.1.teamId': expect.any(Array),
          'entries.2.playerId': expect.any(Array),
        },
      },
    });
    expect(await prisma.basketballRosterSpot.count({ where: { leagueId: league.id } })).toBe(0);
  });

  it('updates and removes a spot', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    await addBasketballRosterSpots(OWNER, league.id, {
      entries: [{ playerId: PLAYERS.jokic.id, teamId: league.myTeamId, acquiredOn: '2026-10-19' }],
    });

    const flagged = await updateBasketballRosterSpot(OWNER, league.id, PLAYERS.jokic.id, {
      onInjuredList: true,
    });
    expect(flagged.rosterSpots[0]).toMatchObject({
      teamId: league.myTeamId,
      onInjuredList: true,
      acquiredOn: '2026-10-19',
    });

    const elsewhere = await updateBasketballRosterSpot(
      OWNER,
      league.id,
      PLAYERS.jokic.id,
      { teamId: null },
      { now: new Date('2026-11-05T15:00:00Z') }
    );
    expect(elsewhere.rosterSpots[0]).toMatchObject({
      teamId: null,
      onInjuredList: false,
      acquiredOn: '2026-11-02',
    });

    expect(
      (await removeBasketballRosterSpot(OWNER, league.id, PLAYERS.jokic.id)).rosterSpots
    ).toEqual([]);
    await expectError(removeBasketballRosterSpot(OWNER, league.id, PLAYERS.jokic.id), 'NOT_FOUND');
    await expectError(
      updateBasketballRosterSpot(OWNER, league.id, PLAYERS.jokic.id, { onInjuredList: true }),
      'NOT_FOUND'
    );
  });

  it('rejects moving a spot to a team from another league of the same owner', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const otherLeague = await createBasketballLeague(OWNER, { ...createInput, name: 'Other' });
    await addBasketballRosterSpots(OWNER, league.id, {
      entries: [{ playerId: PLAYERS.jokic.id, teamId: league.myTeamId }],
    });

    const error = await expectError(
      updateBasketballRosterSpot(OWNER, league.id, PLAYERS.jokic.id, {
        teamId: otherLeague.teams[1].id,
      }),
      'VALIDATION'
    );

    expect(error).toMatchObject({ details: { fieldErrors: { teamId: expect.any(Array) } } });
    expect((await getBasketballLeagueDetail(OWNER, league.id)).rosterSpots[0].teamId).toBe(
      league.myTeamId
    );
  });
});

describe('basketball matchups', () => {
  it('sets, replaces and clears this week’s opponent for the user’s team', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const [mine, second, third] = league.teams;

    await setBasketballMatchup(OWNER, league.id, 2, { opponentTeamId: second.id });
    const replaced = await setBasketballMatchup(OWNER, league.id, '2', {
      opponentTeamId: third.id,
    });
    expect(replaced.matchups).toEqual([{ week: 2, teamId: mine.id, opponentTeamId: third.id }]);

    expect((await clearBasketballMatchup(OWNER, league.id, '2')).matchups).toEqual([]);
    await expectError(clearBasketballMatchup(OWNER, league.id, 2), 'NOT_FOUND');
  });

  it('rejects the user’s own team, another league’s team and weeks outside the season', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    const otherLeague = await createBasketballLeague(OWNER, { ...createInput, name: 'Other' });

    for (const [week, opponentTeamId] of [
      [1, league.myTeamId],
      [1, otherLeague.teams[1].id],
      [26, league.teams[1].id],
      [0, league.teams[1].id],
    ] as const) {
      await expectError(
        setBasketballMatchup(OWNER, league.id, week, { opponentTeamId }),
        'VALIDATION'
      );
    }
    expect(await prisma.basketballMatchup.count({ where: { leagueId: league.id } })).toBe(0);
  });
});

describe('basketball player lookup', () => {
  it('proposes players for pasted lines without saving anything', async () => {
    const league = await createBasketballLeague(OWNER, createInput);
    await addBasketballRosterSpots(OWNER, league.id, {
      entries: [{ playerId: PLAYERS.jokic.id, teamId: league.teams[1].id }],
    });

    const lines = await matchPastedRoster(OWNER, league.id, {
      text: 'C Nikola Jokic Den - C\n\nBN\nZ. Quixley\nYannick Orsted Vale DTD\nNobody Atall',
    });

    expect(lines).toEqual([
      {
        line: 1,
        text: 'C Nikola Jokic Den - C',
        name: 'Nikola Jokic',
        status: 'matched',
        candidates: [
          expect.objectContaining({
            id: PLAYERS.jokic.id,
            rostered: { teamId: league.teams[1].id, teamName: 'Second Team' },
          }),
        ],
      },
      expect.objectContaining({
        line: 4,
        status: 'suggested',
        candidates: [expect.objectContaining({ id: PLAYERS.zeb.id, rostered: null })],
      }),
      expect.objectContaining({ line: 5, status: 'matched' }),
      expect.objectContaining({ line: 6, status: 'none', candidates: [] }),
    ]);
    expect(await prisma.basketballRosterSpot.count({ where: { leagueId: league.id } })).toBe(1);
  });

  it('finds players by name without accents', async () => {
    const results = await searchNbaPlayers('jokic', { limit: 50 });

    expect(results).toContainEqual({
      id: PLAYERS.jokic.id,
      fullName: 'Nikola Jokić',
      teamCode: 'IBLA',
      positions: ['C'],
    });
    expect(results.map((result) => result.id)).not.toContain(PLAYERS.zach.id);
  });
});
