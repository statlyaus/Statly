import { describe, expect, it, vi } from 'vitest';

const cacheCalls = vi.hoisted(() => [] as { key: string[]; options: unknown }[]);
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[], options: unknown) => {
    cacheCalls.push({ key, options });
    // The data cache stores JSON: anything that does not survive a round trip would break.
    return async () => JSON.parse(JSON.stringify(await fn()));
  },
}));

import {
  syntheticRoleHistory,
  syntheticRoleLeague,
} from '@/lib/basketball/__fixtures__/roleModelLeague';
import { toRoleGameRows } from '@/lib/basketball/roleGameRows';
import { runRoleModel } from '@/lib/basketball/roleModel';

import { leagueFixture, spot } from './__fixtures__/fakeNbaClient';
import {
  loadOutlook,
  loadSeasonOutlook,
  RELEVANT_FREE_AGENTS,
  type OutlookReadClient,
} from './roleOutlook';

// Six made-up teams, 36 days played and 21 to come; 'BOS-06' moves from BOS to NOP on day 18.
const league = syntheticRoleLeague({ futureDays: 21 });
const history = syntheticRoleHistory();
const TODAY = league.today; // Thursday 26 November 2026, fantasy week 6 (Mon 23 to Sun 29)
const NOW = new Date(`${TODAY}T15:00:00Z`);
const STATS_RUN = new Date(`${TODAY}T09:00:00Z`);
const TRADED = 'BOS-06';

interface FakeInjury {
  playerId: string;
  status: 'OUT' | 'DAY_TO_DAY';
  expectedReturnOn?: string;
  seasonEnding?: boolean;
}

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** The made-up league's own report: one newly out, one due back, one out for the season. */
const REPORT: FakeInjury[] = [
  { playerId: 'ATL-03', status: 'OUT', expectedReturnOn: '2026-12-02' },
  { playerId: 'BOS-04', status: 'DAY_TO_DAY' },
  { playerId: 'DAL-02', status: 'OUT', seasonEnding: true },
];

function fakeClient(injuries: FakeInjury[] = REPORT, fetchedAt = STATS_RUN): OutlookReadClient {
  const client = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join('?');
      if (sql.includes('"opponentScore"')) {
        expect(values).toEqual([2027]);
        return league.rows;
      }
      if (sql.includes('GROUP BY')) {
        expect(values).toEqual([2027, 2014]);
        return history.totals;
      }
      expect(values).toEqual([2027, 2024]);
      if (sql.includes('AS home')) return history.games;
      if (sql.includes('AS team')) return history.presence;
      throw new Error(`fake client: unsupported query ${sql}`);
    },
    nbaGame: {
      async findMany(args: { where: { season: number } }) {
        expect(args.where).toEqual({ season: 2027, status: { notIn: ['POSTPONED', 'CANCELLED'] } });
        return league.games.map((game) => ({
          gameDate: day(game.date),
          status: game.final ? 'FINAL' : 'SCHEDULED',
          homeTeam: { code: game.home },
          awayTeam: { code: game.away },
        }));
      },
    },
    nbaPlayer: {
      async findMany(args: { where: { id: { in: string[] } } }) {
        return args.where.id.in.map((id) => ({ id, fullName: `Name ${id}`, positions: ['G'] }));
      },
    },
    nbaPlayerInjury: {
      async findMany() {
        return injuries.map((injury) => ({
          playerId: injury.playerId,
          status: injury.status,
          detail: 'Knee',
          expectedReturnOn: injury.expectedReturnOn ? day(injury.expectedReturnOn) : null,
          seasonEnding: injury.seasonEnding ?? false,
          fetchedAt,
        }));
      },
    },
    nbaIngestRun: {
      async findFirst() {
        return { finishedAt: STATS_RUN };
      },
    },
  };
  return client as unknown as OutlookReadClient;
}

/** The dates of a team's games still to play, from today. */
const upcomingDates = (team: string) =>
  league.games
    .filter((game) => !game.final && (game.home === team || game.away === team))
    .map((game) => game.date)
    .sort();

const playerIn = async (injuries: FakeInjury[], playerId: string) => {
  const outlook = await loadSeasonOutlook(fakeClient(injuries), 2027, TODAY);
  return outlook.players.find((player) => player.playerId === playerId)!;
};

describe('loadSeasonOutlook', () => {
  it('caches the computed season under its stats run, injury fetch and date, history daily', async () => {
    cacheCalls.length = 0;
    const outlook = await loadSeasonOutlook(fakeClient(), 2027, TODAY);

    expect(cacheCalls).toEqual([
      {
        key: [
          'basketball:role-outlook',
          '2027',
          STATS_RUN.toISOString(),
          STATS_RUN.toISOString(),
          TODAY,
        ],
        options: { revalidate: 300 },
      },
      { key: ['basketball:role-history', '2027'], options: { revalidate: 86_400 } },
    ]);
    expect(outlook).toMatchObject({
      season: 2027,
      today: TODAY,
      statsUpdatedAt: STATS_RUN.toISOString(),
      injuriesFetchedAt: STATS_RUN.toISOString(),
    });
    expect(outlook.players.length).toBeGreaterThan(40);
    const usage = outlook.players.map((player) => player.role.totalUsageNext5);
    expect(usage).toEqual([...usage].sort((a, b) => b - a));
  });

  it('shows a traded player once, for the team of his latest box score', async () => {
    const rows = runRoleModel(toRoleGameRows(league.rows), new Map());
    expect(rows.filter((row) => row.playerId === TRADED).map((row) => row.teamCode)).toEqual(
      expect.arrayContaining(['BOS', 'NOP'])
    );

    const outlook = await loadSeasonOutlook(fakeClient(), 2027, TODAY);
    const ids = outlook.players.map((player) => player.playerId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(outlook.players.find((player) => player.playerId === TRADED)).toMatchObject({
      teamCode: 'NOP',
      fullName: `Name ${TRADED}`,
      positions: ['G'],
    });
  });

  it("counts a return date over the player's current team's games", async () => {
    // A return date before which his old team plays a different number of games.
    const nop = upcomingDates('NOP');
    const missed = nop.findIndex(
      (date, i) => i > 0 && i < 5 && upcomingDates('BOS').filter((d) => d < date).length !== i
    );
    expect(missed).toBeGreaterThan(0);
    const back = nop[missed];

    const player = await playerIn(
      [{ playerId: TRADED, status: 'OUT', expectedReturnOn: back }],
      TRADED
    );
    expect(player.injury).toEqual({
      status: 'OUT',
      detail: 'Knee',
      expectedReturnOn: back,
      seasonEnding: false,
    });
    const upcoming = player.next5.upcoming.slice(0, missed + 1);
    expect(upcoming.map((game) => game.date)).toEqual(nop.slice(0, missed + 1));
    expect(upcoming.map((game) => game.chancePlays > 0)).toEqual([
      ...Array<boolean>(missed).fill(false),
      true,
    ]);
  });

  it('reads a season-ending injury as out for every remaining game, whatever its date', async () => {
    const player = await playerIn(
      [{ playerId: TRADED, status: 'OUT', expectedReturnOn: TODAY, seasonEnding: true }],
      TRADED
    );
    // Past the next 5 too, which a two-week fantasy week can reach.
    expect(player.next5.upcoming.length).toBeGreaterThan(5);
    expect(player.next5.upcoming.every((game) => game.chancePlays === 0)).toBe(true);
    expect(player.next5.expectedGames).toBe(0);
    expect(player.restOfSeason.expectedGames).toBe(0);
  });

  it('reads OUT with no date as missing 2 of the next 5 games', async () => {
    const player = await playerIn([{ playerId: TRADED, status: 'OUT' }], TRADED);
    const plays = player.next5.upcoming.map((game) => game.chancePlays);
    expect(plays.slice(0, 2)).toEqual([0, 0]);
    expect(plays[2]).toBeGreaterThan(0);
  });

  it('names the teammates who move a player’s minutes', async () => {
    const outlook = await loadSeasonOutlook(fakeClient(), 2027, TODAY);
    const drivers = outlook.players.flatMap((player) => player.role.drivers);
    expect(drivers.length).toBeGreaterThan(0);
    for (const driver of drivers) expect(driver.name).toBe(`Name ${driver.playerId}`);
  });
});

describe('loadOutlook', () => {
  const profile = leagueFixture({
    rosterSpots: [
      spot('ATL-01', 'team-me'),
      spot('NOP-02', 'team-me'),
      spot('BOS-01', 'team-opp'),
      spot('SAS-01', 'team-other'),
      spot('PHX-01', null),
    ],
    matchups: [
      { week: 6, teamId: 'team-me', opponentTeamId: 'team-opp' },
      { week: 6, teamId: 'team-opp', opponentTeamId: 'team-me' },
    ],
  });
  // A high-usage free agent out for the season: never in the default view.
  const sidelined: FakeInjury = { playerId: 'DAL-01', status: 'OUT', seasonEnding: true };

  it('labels every player with his owner and picks the default view', async () => {
    const view = await loadOutlook(profile, {
      now: NOW,
      client: fakeClient([...REPORT, sidelined]),
    });
    const owner = (playerId: string) =>
      view.players.find((player) => player.playerId === playerId)?.owner;
    expect(owner('ATL-01')).toEqual({ kind: 'MINE', teamName: 'My Team' });
    expect(owner('BOS-01')).toEqual({ kind: 'OPPONENT', teamName: 'Rivals' });
    expect(owner('SAS-01')).toEqual({ kind: 'TEAM', teamName: 'Others' });
    expect(owner('PHX-01')).toEqual({ kind: 'ELSEWHERE', teamName: null });
    expect(view.opponentName).toBe('Rivals');
    expect(view.week).toMatchObject({ week: 6, start: '2026-11-23', end: '2026-11-29' });

    const rostered = view.players.filter((player) => player.owner.kind !== 'FREE_AGENT');
    expect(rostered).toHaveLength(5);
    expect(rostered.every((player) => player.relevant)).toBe(true);

    const free = view.players.filter((player) => player.owner.kind === 'FREE_AGENT');
    const shown = free.filter((player) => player.relevant);
    expect(shown).toHaveLength(RELEVANT_FREE_AGENTS);
    expect(shown.every((player) => player.next5.expectedGames >= 1)).toBe(true);
    const cutoff = Math.min(...shown.map((player) => player.role.totalUsageNext5));
    for (const player of free.filter((p) => !p.relevant)) {
      expect(player.next5.expectedGames < 1 || player.role.totalUsageNext5 <= cutoff).toBe(true);
    }
    const out = free.find((player) => player.playerId === sidelined.playerId)!;
    expect(out.role.totalUsageNext5).toBeGreaterThan(cutoff);
    expect(out.relevant).toBe(false);
  });

  it("sums expected games over the league's fantasy week", async () => {
    const oneWeek = await loadOutlook(profile, { now: NOW, client: fakeClient() });
    const twoWeeks = await loadOutlook(
      { ...profile, twoWeekMatchups: [6] },
      { now: NOW, client: fakeClient() }
    );
    const player = oneWeek.players.find((p) => p.playerId === TRADED)!;
    const games = (end: string) =>
      player.next5.upcoming.filter((game) => game.date <= end).map((game) => game.chancePlays);
    expect(games('2026-11-29').length).toBeGreaterThan(0);
    expect(games('2026-12-06').length).toBeGreaterThan(games('2026-11-29').length);

    const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10;
    expect(player.expectedGamesThisWeek).toBe(sum(games('2026-11-29')));
    expect(twoWeeks.players.find((p) => p.playerId === TRADED)!.expectedGamesThisWeek).toBe(
      sum(games('2026-12-06'))
    );
  });

  it('uses an injury report over a day old and flags it stale', async () => {
    const old = new Date(NOW.getTime() - 30 * 3_600_000);
    const injured = [{ playerId: TRADED, status: 'OUT' as const }];
    const stale = await loadOutlook(profile, { now: NOW, client: fakeClient(injured, old) });
    expect(stale.injuriesStale).toBe(true);
    expect(stale.injuriesFetchedAt).toBe(old.toISOString());
    const player = stale.players.find((p) => p.playerId === TRADED)!;
    expect(player.next5.upcoming[0].chancePlays).toBe(0);

    const fresh = await loadOutlook(profile, { now: NOW, client: fakeClient(injured) });
    expect(fresh.injuriesStale).toBe(false);
  });
});
