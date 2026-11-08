import { describe, expect, it } from 'vitest';

import { gameRow } from './__fixtures__/roleModelLeague';
import { addDays } from './fantasyWeeks';
import type { InjuryOutlook } from './injuryOutlook';
import type { CareerPrior, PlayerHistory } from './playerHistory';
import { projectRestOfSeason } from './restOfSeason';
import { buildScheduleContext } from './roleSchedule';

// p plays 3 games for BOS, then 12 for ATL (36 minutes when j is out, 6 of those games), with j
// (missed 4, the last 2 in a row) and k (missed 1); ATL has 20 games left from 1 Nov.
const dates = Array.from({ length: 12 }, (_, i) => addDays('2026-10-08', 2 * i));
const jOut = new Set([6, 7, 10, 11]);
const rows = [
  ...[0, 1, 2].map((i) =>
    gameRow({
      date: addDays('2026-10-01', i),
      playerId: 'p',
      team: 'BOS',
      min: 20,
      pts: 8,
      reb: 3,
      fga: 7,
      fgm: 3,
      fta: 2,
      ftm: 2,
    })
  ),
  ...dates.flatMap((date, i) => [
    gameRow({
      date,
      playerId: 'p',
      team: 'ATL',
      min: jOut.has(i) ? 36 : 30,
      pts: 14 + (i % 3),
      fg3m: i % 2,
      reb: 6,
      ast: 4,
      stl: 1,
      blk: i % 2,
      tov: 2,
      fga: 12,
      fgm: 5 + (i % 2),
      fta: 4,
      ftm: 3,
    }),
    ...(jOut.has(i) ? [] : [gameRow({ date, playerId: 'j', team: 'ATL', min: 32, pts: 20 })]),
    ...(i === 3 ? [] : [gameRow({ date, playerId: 'k', team: 'ATL', min: 24, pts: 9 })]),
  ]),
];
const context = buildScheduleContext(
  rows,
  [
    ...dates.map((date) => ({ date, home: 'ATL', away: 'CHI', final: true })),
    ...Array.from({ length: 20 }, (_, i) => ({
      date: addDays('2026-11-01', 2 * i),
      home: 'ATL',
      away: 'CHI',
      final: false,
    })),
  ],
  '2026-11-01'
);
const PRIOR: CareerPrior = {
  rates: {
    pts: 0.55,
    fg3m: 0.05,
    reb: 0.2,
    ast: 0.12,
    stl: 0.03,
    blk: 0.02,
    tov: 0.06,
    fga: 0.42,
    fta: 0.13,
  },
  fgm: 250,
  fga: 520,
  ftm: 100,
  fta: 130,
};
const NONE = new Map();
const role = { playerId: 'p', teamCode: 'ATL' };

// Expected values: RoleModel.gs rosProj_ on the same rows, schedule, history and injuries.
describe('projectRestOfSeason', () => {
  it('projects minutes, rates and games from his season, last season and career', () => {
    const history: PlayerHistory = {
      priors: new Map([['p', PRIOR]]),
      lastSeason: new Map([['p', { mpg: 28.5, share: 0.8 }]]),
      backToBack: NONE,
    };
    const [p] = projectRestOfSeason(rows, [role], context, history, NONE);
    expect(p.raw.minutes).toBeCloseTo(30.137677093628295, 12);
    expect(p.raw.expectedGames).toBeCloseTo(16.50133019999999, 12);
    expect(p.raw.teammateShift).toBeCloseTo(-0.013960366371703115, 12);
    expect(p.raw.stats.pts).toBeCloseTo(14.81652738813628, 12);
    expect(p.raw.stats.blk).toBeCloseTo(0.5210916120078315, 12);
    expect(p).toMatchObject({
      minutes: 30.1,
      expectedGames: 16.5,
      stats: {
        pts: 14.8,
        fg3m: 1.1,
        reb: 5.8,
        ast: 3.6,
        stl: 0.9,
        blk: 0.5,
        tov: 1.7,
        fga: 11.7,
        fta: 3.7,
      },
      fgPct: 0.464,
      ftPct: 0.774,
      teamGamesLeft: 20,
      teammateShift: 0,
    });
  });

  it('falls back to this season without history and takes injured games off the front', () => {
    const history: PlayerHistory = { priors: NONE, lastSeason: NONE, backToBack: NONE };
    const injuries = new Map<string, InjuryOutlook>([
      ['p', { fracNext5: 0.6, gamesOut: 3 }],
      ['j', { fracNext5: 0.8, gamesOut: 4 }],
    ]);
    const [p] = projectRestOfSeason(rows, [role], context, history, injuries);
    expect(p.raw.minutes).toBeCloseTo(31.535275749169383, 12);
    expect(p.raw.expectedGames).toBeCloseTo(14.415620899999999, 12);
    expect(p.raw.teammateShift).toBeCloseTo(-0.04837313083061684, 12);
    expect(p.raw.stats.fg3m).toBeCloseTo(0.5895214390226162, 12);
    expect(p.raw.stats.fta).toBeCloseTo(3.7540834232697993, 12);
    expect(p).toMatchObject({ minutes: 31.5, expectedGames: 14.4, fgPct: 0.458, ftPct: 0.776 });
  });
});
