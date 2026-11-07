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
  it('splits the week into played and remaining dates and counts games per team', async () => {
    const schedule = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-11-05',
      client: client(week3Games),
    });

    expect(schedule).toMatchObject({ week: 3, start: '2026-11-02', end: '2026-11-08' });
    // Thursday is played: its only game is final with a box score.
    expect(schedule.playedDates).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    expect(schedule.remainingDates).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    expect(schedule.finalGames).toEqual([
      { gameId: 'mon', date: '2026-11-02' },
      { gameId: 'wed', date: '2026-11-04' },
      { gameId: 'thu', date: '2026-11-05' },
    ]);
    // A postponed game is not a game.
    expect(schedule.teamsByDate['2026-11-07']).toEqual([]);
    expect(schedule.teamsByDate['2026-11-06'].sort()).toEqual(['LAL', 'NYK']);
    expect(schedule.gamesByTeam.BOS).toEqual({ total: 2, remaining: 0 });
    expect(schedule.gamesByTeam.NYK).toEqual({ total: 3, remaining: 2 });
  });

  it('keeps today in the rest of the week until every game today is final and ingested', async () => {
    const games = [
      game('early', '2026-11-05', 'BOS', 'NYK', 'FINAL'),
      game('late', '2026-11-05', 'DEN', 'LAL', 'IN_PROGRESS'),
      { ...game('lagging', '2026-11-04', 'DEN', 'LAL', 'FINAL'), boxScoreIngested: false },
    ];
    const schedule = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-11-05',
      client: client(games),
    });

    expect(schedule.remainingDates[0]).toBe('2026-11-05');
    // Today's early game is projected with the rest of today, not counted twice.
    expect(schedule.finalGames).toEqual([{ gameId: 'lagging', date: '2026-11-04' }]);
    expect(schedule.teamsByDate['2026-11-05'].sort()).toEqual(['BOS', 'DEN', 'LAL', 'NYK']);
  });

  it('treats a past week as played and a future week as all to play', async () => {
    const past = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-11-20',
      client: client(week3Games),
    });
    const future = await loadWeekSchedule(leagueFixture(), 3, {
      today: '2026-10-25',
      client: client(week3Games),
    });

    expect(past.remainingDates).toEqual([]);
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
