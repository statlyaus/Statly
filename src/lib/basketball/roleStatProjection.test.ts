import { describe, expect, it } from 'vitest';

import { gameRow } from './__fixtures__/roleModelLeague';
import { addDays } from './fantasyWeeks';
import { PROJECTED_STATS, type CareerPrior, type PlayerHistory } from './playerHistory';
import type { ProjectedStat } from './roleModelConstants';
import { buildScheduleContext } from './roleSchedule';
import { projectNextFive, shootingPercentages } from './roleStatProjection';

// Twelve final games against BOS every other day, then five from 1 Nov against `opponent`.
const dates = Array.from({ length: 12 }, (_, i) => addDays('2026-10-08', 2 * i));
const mine = dates.map((date, i) =>
  gameRow({
    date,
    playerId: 'p',
    team: 'ATL',
    min: 26 + i,
    usg: 18 + i / 2,
    pts: 10 + i,
    fg3m: i % 3,
    reb: 5,
    ast: 2 + (i % 4),
    stl: 1,
    blk: i % 2,
    tov: 2,
    fga: 9 + i,
    fgm: 4 + (i >> 1),
    fta: 3,
    ftm: 2,
  })
);
const theirs = dates.map((date) =>
  gameRow({ date, playerId: 'q', team: 'BOS', min: 40, pts: 30, reb: 4, ast: 9 })
);
const rows = [...mine, ...theirs];
const context = (opponent: string) =>
  buildScheduleContext(
    rows,
    [
      ...dates.map((date) => ({ date, home: 'ATL', away: 'BOS', final: true })),
      ...[0, 2, 3, 5, 7].map((d) => ({
        date: addDays('2026-11-01', d),
        home: opponent,
        away: 'ATL',
        final: false,
      })),
    ],
    '2026-11-01'
  );
// The role model's rounded predictions are the inputs, as in the sheet.
const role = { playerId: 'p', teamCode: 'ATL', minutesNext5: 31, usageNext5: 22 };
const NONE = new Map();
const history = (priors: Map<string, CareerPrior> = NONE): PlayerHistory => ({
  priors,
  lastSeason: NONE,
  backToBack: NONE,
});
const PRIOR: CareerPrior = {
  rates: {
    pts: 0.6,
    fg3m: 0.08,
    reb: 0.25,
    ast: 0.15,
    stl: 0.04,
    blk: 0.03,
    tov: 0.07,
    fga: 0.5,
    fta: 0.15,
  },
  fgm: 300,
  fga: 600,
  ftm: 120,
  fta: 150,
};

/** Raw stats against the script's, in the order pts, 3PM, REB, AST, STL, BLK, TO, FGA, FTA. */
function expectClose(actual: Record<ProjectedStat, number>, expected: number[]) {
  PROJECTED_STATS.forEach((stat, i) => expect(actual[stat]).toBeCloseTo(expected[i], 12));
}

// Expected values: RoleModel.gs statProj_ on the same rows, schedule and prior.
describe('projectNextFive', () => {
  it('blends recent, season and usage rates into per-game stats (no prior, neutral opponent)', () => {
    const [p] = projectNextFive(rows, [role], context('CHI'), history(), NONE);
    expectClose(
      p.raw.stats,
      [
        16.492058094427314, 1.058920472073718, 4.899262621302456, 3.5298580569447804,
        0.985794578454833, 0.4943398888788224, 1.9698045461240694, 14.627361850070573,
        2.951293638531574,
      ]
    );
    expect(p).toMatchObject({
      stats: {
        pts: 16.5,
        fg3m: 1.1,
        reb: 4.9,
        ast: 3.5,
        stl: 1,
        blk: 0.5,
        tov: 2,
        fga: 14.6,
        fta: 3,
      },
      // Rookie: season makes shrunk to the league's 46.3 % and 77.4 %.
      fgPct: 0.454,
      ftPct: 0.729,
      vsSeason: { pts: 1, reb: -0.1, ast: 0 },
      oppDefence: 0,
    });
  });

  it('pulls early-season rates towards his career and shooting towards his career %', () => {
    const [p] = projectNextFive(
      rows,
      [role],
      context('CHI'),
      history(new Map([['p', PRIOR]])),
      NONE
    );
    expectClose(
      p.raw.stats,
      [
        18.19296259426145, 1.6519546172165753, 5.935404407016741, 3.9441229919447807,
        1.0678977684548325, 0.6703607386645367, 2.0455495187669266, 14.914360403642,
        3.5141256528172877,
      ]
    );
    expect(p).toMatchObject({
      fgPct: 0.467,
      ftPct: 0.743,
      vsSeason: { pts: 2.7, reb: 0.9, ast: 0.4 },
    });
  });

  it('adjusts for what the next 5 opponents allow', () => {
    const [p] = projectNextFive(rows, [role], context('BOS'), history(), NONE);
    expectClose(
      p.raw.stats,
      [
        14.450656121032853, 1.5767145652802752, 5.597214526810053, 2.889410807135696,
        1.5131597893252318, 0.8093803909832653, 3.298895531030884, 14.627361850070573,
        5.00881567248243,
      ]
    );
    expect(p).toMatchObject({ oppDefence: -12.4, vsSeason: { pts: -1, reb: 0.6, ast: -0.6 } });
    expect(p).toMatchObject({ backToBacks: 1, chanceSitsBackToBack: 0.08, expectedGames: 4.8 });
  });
});

describe('projectNextFive floors', () => {
  const at = (projectRows: typeof rows, minutesNext5: number, usageNext5: number) =>
    projectNextFive(
      projectRows,
      [{ ...role, minutesNext5, usageNext5 }],
      context('CHI'),
      history(),
      NONE
    )[0];

  it('reads predicted minutes below 5 as 5 for the rate, then scales by the minutes', () => {
    const two = at(rows, 2, 22).raw.stats;
    const five = at(rows, 5, 22).raw.stats;
    for (const stat of PROJECTED_STATS) expect(two[stat]).toBeCloseTo(five[stat] * 0.4, 12);
  });

  it('never projects a negative stat', () => {
    // A 45 % usage season with a 5 % prediction pushes the usage-driven rates below zero.
    const highUsage = rows.map((row) => (row.playerId === 'p' ? { ...row, usg: 45 } : row));
    const { stats, raw } = at(highUsage, 31, 5);
    expect(raw.stats.tov).toBe(0);
    expect(stats.tov).toBe(0);
  });
});

describe('shootingPercentages', () => {
  // 10 of 20 from the field and 8 of 10 at the line over 2 games.
  const games = [0, 1].map((i) =>
    gameRow({
      date: dates[i],
      playerId: 'p',
      team: 'ATL',
      min: 30,
      fgm: 5,
      fga: 10,
      ftm: 4,
      fta: 5,
    })
  );

  it('shrinks his makes towards his career %, itself shrunk to the league', () => {
    // FG: (300 + 0.463·25) / 625 = 0.49852 career; (10 + 49.852) / 120 = 0.499.
    // FT: (120 + 0.774·12.5) / 162.5 = 0.79800 career; (8 + 39.9) / 60 = 0.798.
    expect(shootingPercentages(games, PRIOR)).toEqual({ fgPct: 0.499, ftPct: 0.798 });
  });

  it('uses the league % without 50 career FGA or 25 FTA', () => {
    const small = { ...PRIOR, fgm: 30, fga: 49, ftm: 20, fta: 24 };
    // (10 + 46.3) / 120 = 0.469; (8 + 38.7) / 60 = 0.778.
    expect(shootingPercentages(games, small)).toEqual({ fgPct: 0.469, ftPct: 0.778 });
    expect(shootingPercentages(games, undefined)).toEqual({ fgPct: 0.469, ftPct: 0.778 });
  });
});
