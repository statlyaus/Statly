import { describe, expect, it } from 'vitest';

import {
  backToBackHistory,
  careerPriors,
  lastSeasonLines,
  type HistoryGame,
  type SeasonTotals,
} from './playerHistory';

const SEASON = 2027;

function totals(playerId: string, season: number, minutes: number, games = 10): SeasonTotals {
  // Every stat as a share of minutes, so rates are easy to read.
  const per = (share: number) => share * minutes;
  return {
    playerId,
    season,
    minutes,
    games,
    pts: per(0.5),
    fg3m: per(0.05),
    reb: per(0.2),
    ast: per(0.1),
    stl: per(0.03),
    blk: per(0.02),
    tov: per(0.04),
    fgm: per(0.2),
    fga: per(0.4),
    ftm: per(0.08),
    fta: per(0.1),
  };
}

describe('careerPriors', () => {
  it('halves the weight of each earlier season', () => {
    const rows = [totals('vet', 2026, 1000), { ...totals('vet', 2025, 2000), pts: 2000 * 0.8 }];
    const prior = careerPriors(rows, SEASON).get('vet')!;
    // pts: (500 + 0.5 × 1600) / (1000 + 0.5 × 2000)
    expect(prior.rates.pts).toBeCloseTo(0.65, 12);
    expect(prior.rates.reb).toBeCloseTo(0.2, 12);
    expect(prior).toMatchObject({ fgm: 400, fga: 800, ftm: 160, fta: 200 });
  });

  it('leaves out players under 100 minutes and seasons outside the 13 before this one', () => {
    const rows = [
      totals('short', 2026, 60),
      totals('short', 2025, 39),
      totals('enough', 2026, 60),
      totals('enough', 2025, 40),
      totals('rookie', 2027, 500),
      totals('old', 2013, 900),
    ];
    expect([...careerPriors(rows, SEASON).keys()]).toEqual(['enough']);
  });
});

describe('lastSeasonLines', () => {
  it('gives last season’s minutes per game and share of 82 games played', () => {
    const rows = [totals('a', 2026, 1640, 41), totals('a', 2025, 3000, 82), totals('b', 2025, 900)];
    expect(Object.fromEntries(lastSeasonLines(rows, SEASON))).toEqual({
      a: { mpg: 40, share: 0.5 },
    });
  });
});

describe('backToBackHistory', () => {
  // ATL plays 3, 4 and 5 Jan (a back-to-back with a next game), then 7 and 8 Jan, its last two.
  const atl = ['2026-01-03', '2026-01-04', '2026-01-05', '2026-01-07', '2026-01-08'];
  const games: HistoryGame[] = atl.map((date) => ({
    season: 2026,
    date,
    home: 'ATL',
    away: 'BOS',
  }));
  const at = (playerId: string, team: string, ...dates: string[]) =>
    dates.map((date) => ({ team, date, playerId }));

  it('counts second nights after a played first night, and sits followed by a played game', () => {
    const presence = [
      ...at('sat', 'ATL', '2026-01-03', '2026-01-05', '2026-01-07'),
      ...at('played', 'ATL', ...atl),
      ...at('gone', 'ATL', '2026-01-03', '2026-01-07'),
      ...at('missed-first', 'ATL', '2026-01-04', '2026-01-05'),
      ...at('other-team', 'BOS', '2026-01-03', '2026-01-05'),
    ];
    // 4 Jan and 5 Jan are second nights; 8 Jan has no next game.
    expect(Object.fromEntries(backToBackHistory(games, presence, SEASON))).toEqual({
      sat: { eligible: 1, sits: 1 },
      played: { eligible: 2, sits: 0 },
      gone: { eligible: 1, sits: 0 },
      'missed-first': { eligible: 1, sits: 0 },
      'other-team': { eligible: 1, sits: 1 },
    });
  });

  it('uses the three seasons before this one, each on its own', () => {
    const old = games.map((game) => ({ ...game, season: 2023 }));
    const presence = at('sat', 'ATL', '2026-01-03', '2026-01-05');
    expect(backToBackHistory([...games, ...old], presence, SEASON).get('sat')).toEqual({
      eligible: 1,
      sits: 1,
    });
    // A season's last game is no second night, even when the next season follows the next day.
    const split: HistoryGame[] = [
      { season: 2025, date: '2025-04-12', home: 'ATL', away: 'BOS' },
      { season: 2025, date: '2025-04-13', home: 'ATL', away: 'BOS' },
      { season: 2026, date: '2025-04-14', home: 'ATL', away: 'BOS' },
    ];
    expect(backToBackHistory(split, at('p', 'ATL', '2025-04-12', '2025-04-14'), SEASON).size).toBe(
      0
    );
  });
});
