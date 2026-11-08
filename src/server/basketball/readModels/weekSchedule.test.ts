import { describe, expect, it } from 'vitest';

import { createFakeNbaClient, leagueFixture, type FakeGame } from './__fixtures__/fakeNbaClient';
import { loadWeekSchedule } from './weekSchedule';

const teams = ['BOS', 'NYK', 'DEN', 'LAL'].map((code) => ({ id: code, code }));

function game(
  id: string,
  gameDate: string,
  homeTeamId: string,
  awayTeamId: string,
  status: FakeGame['status'] = 'SCHEDULED',
  season = 2027
): FakeGame {
  return { id, season, gameDate, status, homeTeamId, awayTeamId };
}

// Week 3 of a league starting Mon 19 Oct 2026 is Mon 2 – Sun 8 Nov.
const week3Games: FakeGame[] = [
  game('mon', '2026-11-02', 'BOS', 'NYK', 'FINAL'),
  game('wed', '2026-11-04', 'DEN', 'LAL', 'FINAL'),
  game('thu', '2026-11-05', 'BOS', 'DEN', 'FINAL'),
  game('fri', '2026-11-06', 'NYK', 'LAL'),
  game('sat', '2026-11-07', 'BOS', 'LAL', 'POSTPONED'),
  game('sun', '2026-11-08', 'DEN', 'NYK'),
  game('next-mon', '2026-11-09', 'BOS', 'NYK'),
  game('old-season', '2026-11-03', 'BOS', 'NYK', 'FINAL', 2026),
];

const client = (games: FakeGame[]) => createFakeNbaClient({ teams, players: [], games, stats: [] });

describe('loadWeekSchedule', () => {
  it('counts final games and projects the rest, with games per team', async () => {
    const schedule = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-11-05',
      client: client(week3Games),
    });

    expect(schedule).toMatchObject({ week: 3, start: '2026-11-02', end: '2026-11-08' });
    expect(schedule.playedDates).toEqual(['2026-11-02', '2026-11-04', '2026-11-05']);
    // Saturday's only game is postponed, so nothing is left to play that day.
    expect(schedule.remainingDates).toEqual(['2026-11-06', '2026-11-08']);
    expect(schedule.finalGames).toEqual([
      { gameId: 'mon', date: '2026-11-02' },
      { gameId: 'wed', date: '2026-11-04' },
      { gameId: 'thu', date: '2026-11-05' },
    ]);
    expect(schedule.teamsByDate['2026-11-07']).toEqual([]);
    expect(schedule.teamsByDate['2026-11-06'].sort()).toEqual(['LAL', 'NYK']);
    expect(schedule.gamesByTeam.BOS).toEqual({ total: 2, remaining: 0 });
    expect(schedule.gamesByTeam.NYK).toEqual({ total: 3, remaining: 2 });
  });

  it('projects each game until it is final with a box score, whatever its date', async () => {
    const games = [
      game('early', '2026-11-05', 'BOS', 'NYK', 'FINAL'),
      game('late', '2026-11-05', 'DEN', 'LAL', 'IN_PROGRESS'),
      // Yesterday's late tip-off whose box score is not ingested yet.
      { ...game('lagging', '2026-11-04', 'DEN', 'LAL', 'FINAL'), boxScoreIngested: false },
    ];
    const schedule = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-11-05',
      client: client(games),
    });

    expect(schedule.finalGames).toEqual([{ gameId: 'early', date: '2026-11-05' }]);
    expect(schedule.playedDates).toEqual(['2026-11-05']);
    // Today is both: the early game counts, the late one is projected.
    expect(schedule.remainingDates).toEqual(['2026-11-04', '2026-11-05']);
    expect(schedule.teamsByDate['2026-11-05'].sort()).toEqual(['DEN', 'LAL']);
    expect(schedule.teamsByDate['2026-11-04'].sort()).toEqual(['DEN', 'LAL']);
    expect(schedule.gamesByTeam.BOS).toEqual({ total: 1, remaining: 0 });
    expect(schedule.gamesByTeam.LAL).toEqual({ total: 2, remaining: 2 });
  });

  it('treats a finished week as played and a future week as all to play', async () => {
    const finished = week3Games.map((g) =>
      g.status === 'SCHEDULED' ? { ...g, status: 'FINAL' as const } : g
    );
    const upcoming = week3Games.map((g) =>
      g.status === 'FINAL' ? { ...g, status: 'SCHEDULED' as const } : g
    );
    const past = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-11-20',
      client: client(finished),
    });
    const future = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-10-25',
      client: client(upcoming),
    });

    expect(past.remainingDates).toEqual([]);
    expect(past.gameDates).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-08',
    ]);
    expect(future.playedDates).toEqual([]);
    expect(future.gamesByTeam.NYK).toEqual({ total: 3, remaining: 3 });
  });

  it('spans fourteen dates for a two-week matchup', async () => {
    const schedule = await loadWeekSchedule(leagueFixture({ twoWeekMatchups: [2] }), 2, {
      today: '2026-10-01',
      client: client([]),
    });

    expect(schedule.dates).toHaveLength(14);
    expect(schedule.end).toBe('2026-11-08');
  });
});
