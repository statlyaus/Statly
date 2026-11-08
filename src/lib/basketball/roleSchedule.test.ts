import { describe, expect, it } from 'vitest';

import { gameRow } from './__fixtures__/roleModelLeague';
import { addDays } from './fantasyWeeks';
import {
  buildScheduleContext,
  playerSchedule,
  upcomingGames,
  type ScheduleGame,
} from './roleSchedule';

const game = (date: string, home: string, away: string, final: boolean): ScheduleGame => ({
  date,
  home,
  away,
  final,
});

describe('buildScheduleContext', () => {
  it('shrinks what each defence allows per minute towards the league rate', () => {
    const rows = [
      gameRow({ date: '2026-11-01', playerId: 'a', team: 'ATL', min: 40, pts: 40 }),
      gameRow({ date: '2026-11-01', playerId: 'b', team: 'BOS', min: 40, pts: 20, reb: 8 }),
    ];
    const games = [game('2026-11-01', 'ATL', 'BOS', true), game('2026-11-03', 'BOS', 'ATL', false)];
    const context = buildScheduleContext(rows, games, '2026-11-03');
    // BOS allowed 1 point a minute against a league 0.75, over 1 game: ln((1·4/3 + 10) / 11).
    expect(context.defence.get('BOS')!.pts).toBeCloseTo(Math.log(34 / 33), 15);
    expect(context.defence.get('ATL')!.pts).toBeCloseTo(Math.log(32 / 33), 15);
    // No league total: no adjustment.
    expect(context.defence.get('BOS')!.ast).toBe(0);
    const next = playerSchedule(context, 'a', 'ATL', rows.slice(0, 1), undefined, 0);
    expect(next.od.pts).toBe(context.defence.get('BOS')!.pts);
    expect(upcomingGames(context, 'ATL')).toEqual([
      { date: '2026-11-03', opponent: 'BOS', final: false },
    ]);
  });
});

// RoleModel.gs playerSchedule_ on the schedule and rows below (a 28-minute player with no history,
// and a 34-minute one who sat 5 of 10 earlier second nights).
const SIT_28 = 0.06664250715047956;
const SIT_28_NOT_B2B = 0.028331973525465404;
const EXPECTED_28 = 4.74340853149763;
const SIT_34_HISTORY = 0.310064621872065;
const EXPECTED_34_HISTORY = 3.9212532594752667;

describe('playerSchedule', () => {
  // Ten final games every other day, then the remaining schedule from today, 3 Nov.
  const finals = Array.from({ length: 10 }, (_, i) => addDays('2026-10-12', 2 * i));
  const upcoming = ['2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08'];
  const later = ['2026-11-10', '2026-11-17', '2026-11-25'];
  const games = [
    ...finals.map((date) => game(date, 'ATL', 'BOS', true)),
    ...[...upcoming, ...later].map((date) => game(date, 'BOS', 'ATL', false)),
  ];
  const mine = (min: number) =>
    finals.map((date) => gameRow({ date, playerId: 'p', team: 'ATL', min }));
  const context = buildScheduleContext(mine(28), games, '2026-11-03');

  it('rates his chance of sitting a second night and his expected games (sit model)', () => {
    const s = playerSchedule(context, 'p', 'ATL', mine(28), undefined, 0);
    expect(s.chanceSitsBackToBack).toBeCloseTo(SIT_28, 12);
    expect(s.backToBacks).toBe(3);
    expect(s.expectedGames).toBeCloseTo(EXPECTED_28, 12);
    const veteran = playerSchedule(context, 'p', 'ATL', mine(34), { eligible: 10, sits: 5 }, 0);
    expect(veteran.chanceSitsBackToBack).toBeCloseTo(SIT_34_HISTORY, 12);
    expect(veteran.expectedGames).toBeCloseTo(EXPECTED_34_HISTORY, 12);
  });

  it('lists the next 14 days with the chance he plays, injured games off the front', () => {
    const s = playerSchedule(context, 'p', 'ATL', mine(28), undefined, 0.4);
    expect(s.upcoming.map((g) => g.date)).toEqual([...upcoming, '2026-11-10']);
    const chances = s.upcoming.map((g) => g.chancePlays);
    expect(chances.slice(0, 2)).toEqual([0, 0]);
    expect(chances[2]).toBeCloseTo(1 - SIT_28_NOT_B2B, 12);
    expect(chances[3]).toBeCloseTo(1 - SIT_28, 12);
    expect(s.expectedGames).toBeCloseTo(
      chances.slice(0, 5).reduce((a, b) => a + b),
      15
    );
  });

  it('adds this season’s second nights to his history', () => {
    const dates = ['2026-10-27', '2026-10-28', '2026-10-30'];
    const rows = [
      gameRow({ date: '2026-10-27', playerId: 'sat', team: 'ATL', min: 30 }),
      gameRow({ date: '2026-10-30', playerId: 'sat', team: 'ATL', min: 30 }),
      gameRow({ date: '2026-10-30', playerId: 'late', team: 'ATL', min: 30 }),
    ];
    const season = buildScheduleContext(
      rows,
      [...dates.map((d) => game(d, 'ATL', 'BOS', true)), game('2026-11-01', 'ATL', 'BOS', false)],
      '2026-11-01'
    );
    const g = rows.slice(0, 2);
    expect(playerSchedule(season, 'sat', 'ATL', g, undefined, 0).chanceSitsBackToBack).toBe(
      playerSchedule(season, 'late', 'ATL', g, { eligible: 1, sits: 1 }, 0).chanceSitsBackToBack
    );
  });
});
