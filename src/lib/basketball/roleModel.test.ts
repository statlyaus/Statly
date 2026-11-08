import { describe, expect, it } from 'vitest';

import { addDays } from './fantasyWeeks';
import type { RoleGameRow } from './roleGameRows';
import { minutesRange80, runRoleModel } from './roleModel';
import { MINUTES_BAND80 } from './roleModelConstants';

function played(team: string, day: number, playerId: string, min: number): RoleGameRow {
  return {
    date: addDays('2026-10-21', day),
    playerId,
    team,
    min,
    usg: 20,
    pm: 0,
    margin: 0,
    pts: 0,
    fg3m: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    fgm: 0,
    fga: 0,
    ftm: 0,
    fta: 0,
    tov: 0,
  };
}

/** `minutes[i]` for team game i; null = did not play. */
const games = (team: string, playerId: string, minutes: (number | null)[]) =>
  minutes.flatMap((min, day) => (min === null ? [] : [played(team, day, playerId, min)]));

const NONE = new Map<string, { fracNext5: number }>();

describe('runRoleModel', () => {
  it('outlooks players with 3+ games for the team and 10+ minutes over the last 5', () => {
    const rows = [
      ...games('ATL', 'anchor', [30, 30, 30, 30, 30]),
      ...games('ATL', 'two', [null, null, null, 30, 30]),
      ...games('ATL', 'three', [null, null, 20, 20, 20]),
      ...games('ATL', 'ten', [10, 10, 10, 10, 10]),
      ...games('ATL', 'under', [10, 10, 10, 10, 9]),
    ];
    const ids = runRoleModel(rows, NONE).map((row) => row.playerId);
    expect(ids.sort()).toEqual(['anchor', 'ten', 'three']);
  });

  it('gives a traded player one row per team, counting that team’s games only', () => {
    const rows = [
      ...games('ATL', 'p', [30, 30, 30, 30]),
      ...games('BOS', 'p', [null, null, null, null, 25, 25, 25]),
    ];
    const result = runRoleModel(rows, NONE);
    const byTeam = [...result].sort((a, b) => a.teamCode.localeCompare(b.teamCode));
    expect(byTeam.map((row) => [row.teamCode, row.gamesPlayed, row.lastGameDate])).toEqual([
      ['ATL', 4, '2026-10-24'],
      ['BOS', 3, '2026-10-27'],
    ]);
    expect(byTeam[0]).toMatchObject({ coach: 'Quin Snyder', minutesLast5: 30, usageLast5: 20 });
    expect(result[0].totalUsageNext5).toBeGreaterThanOrEqual(result[1].totalUsageNext5);
  });

  describe('injured and returning teammates', () => {
    // x played 38 when j sat (game 2), 33 while g was gone (4-7) and 40 when k sat (game 8).
    const rows = [
      ...games('ATL', 'x', [30, 30, 38, 30, 33, 33, 33, 33, 40, 30]),
      ...games('ATL', 'k', [30, 30, 30, 30, 30, 30, 30, 30, null, null]),
      ...games('ATL', 'j', [30, 30, null, 30, 30, 30, 30, 30, 30, 30]),
      ...games('ATL', 'g', [30, 30, 30, 30, null, null, null, null, null, null]),
    ];
    const outlook = (injuries: [string, number][]) =>
      runRoleModel(rows, new Map(injuries.map(([id, fracNext5]) => [id, { fracNext5 }]))).find(
        (row) => row.playerId === 'x'
      )!;

    it('shifts his minutes by the with/without difference, shrunk by n / (n + 3)', () => {
      const x = outlook([['j', 0.5]]);
      // k back: (40 − 260/8) · 1/4 = 1.875. j newly out half the next 5: (38 − 262/8) · 1/4 = 1.3125.
      expect(x.drivers).toEqual([
        { playerId: 'k', status: 'BACK', minutes: 1.9 },
        { playerId: 'j', status: 'OUT', minutes: 1.3 },
      ]);
      expect(x.injuryMinutesShift).toBe(-1.2); // 0.5 · 1.3125 − 1.875
    });

    it('leaves out a teammate gone more than 5 team games unless he is on the injury report', () => {
      const off = outlook([['j', 0.5]]);
      const on = outlook([
        ['j', 0.5],
        ['g', 1],
      ]);
      expect(off.drivers.map((driver) => driver.playerId)).not.toContain('g');
      // Already out, so not newly out: the shift holds, the model's other teammate inputs move.
      expect(on.drivers).toContainEqual({ playerId: 'g', status: 'OUT', minutes: 1.5 });
      expect(on.injuryMinutesShift).toBe(-1.2);
      expect(on.raw.y5_min).not.toBe(off.raw.y5_min);
    });
  });
});

describe('minutesRange80', () => {
  it('takes the first band whose upper edge reaches the prediction, else the last', () => {
    expect(minutesRange80(MINUTES_BAND80[0].upto)).toEqual({ low: 11.9, high: 24 });
    expect(minutesRange80(18.3)).toEqual({ low: 12.5, high: 23.7 });
    expect(minutesRange80(50)).toEqual({ low: 45.3, high: 52.6 });
  });

  it('never goes below zero minutes', () => {
    expect(minutesRange80(3)).toEqual({ low: 0, high: 8.7 });
  });
});
