import { describe, expect, it } from 'vitest';

import { addDays } from './fantasyWeeks';
import { buildRoleFeatures } from './roleFeatures';
import type { RoleGameRow } from './roleGameRows';

/** One played game: team game `day` is 21 Oct 2026 plus `day` days. */
function played(
  team: string,
  day: number,
  playerId: string,
  min: number,
  line: Partial<RoleGameRow> = {}
): RoleGameRow {
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
    ...line,
  };
}

function gamesOf(rows: RoleGameRow[], playerId: string, team = 'ATL') {
  const sequence = buildRoleFeatures(rows).sequences.find(
    (candidate) => candidate.playerId === playerId && candidate.team === team
  );
  return sequence!.games;
}

describe('buildRoleFeatures', () => {
  it('averages his own games for the team and counts team games he missed', () => {
    const minutes = [20, 22, 24, 26, null, 28, 30];
    const rows = minutes.flatMap((min, day) => [
      played('ATL', day, 'anchor', 30),
      ...(min === null ? [] : [played('ATL', day, 'p', min)]),
    ]);
    const games = gamesOf(rows, 'p');
    expect(games.map((game) => game.features.gap)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(games.map((game) => game.teamGame)).toEqual([0, 1, 2, 3, 5, 6]);
    const last = games.at(-1)!.features;
    expect(last).toMatchObject({ min_l1: 30, min_l3: 28, min_l5: 26, min_l10: 25, min_szn: 25 });
    expect(last).toMatchObject({ gp: 6, min_gap: 1, usg_l5: 20, usg_sd10: 0 });
    expect(last.min_sd10).toBeCloseTo(Math.sqrt(14), 12);
    expect(last.load_l5).toBeCloseTo((20 * 26) / 48, 12);
  });

  it('counts consecutive games 4 minutes above the median of the 5 to 10 before', () => {
    const rows = [20, 20, 20, 20, 20, 24, 25, 20].map((min, day) => played('ATL', day, 'p', min));
    expect(gamesOf(rows, 'p').map((game) => game.features.role_tenure)).toEqual([
      0, 0, 0, 0, 0, 1, 2, 0,
    ]);
  });

  it('ranks season minutes within the team game, sharing ties', () => {
    const rows = [played('ATL', 0, 'a', 30), played('ATL', 0, 'b', 30), played('ATL', 0, 'c', 20)];
    expect(['a', 'b', 'c'].map((id) => gamesOf(rows, id)[0].features.team_min_rank)).toEqual([
      1.5, 1.5, 3,
    ]);
  });

  it('adds up the minutes per game of absent players in the top 8 by minutes so far', () => {
    const minutes = [40, 35, 30, 28, 26, 24, 22, 20, 10];
    const ids = minutes.map((_, index) => `r${index}`);
    const rows = [
      ...ids.map((id, index) => played('ATL', 0, id, minutes[index])),
      // r1 (second in minutes) and r8 (ninth) miss game 1; everyone plays game 2.
      ...ids.filter((id) => id !== 'r1' && id !== 'r8').map((id) => played('ATL', 1, id, 20)),
      ...ids.map((id) => played('ATL', 2, id, 20)),
    ];
    const games = gamesOf(rows, 'r0');
    expect(games.map((game) => game.features.rot_missing)).toEqual([0, 35, 0]);
    expect(games.map((game) => game.features.rot_missing_l3)).toEqual([0, 17.5, 35 / 3]);
  });

  it('builds per-36 and shooting rates, and divides team margin by 10 however few games', () => {
    const line = { pts: 20, fga: 15, fgm: 8, fg3m: 2, fta: 4, ftm: 2, tov: 2, margin: 0 };
    const rows = [
      played('ATL', 0, 'p', 30, { ...line, margin: 10 }),
      played('ATL', 1, 'p', 30, { ...line, margin: -4 }),
      played('ATL', 2, 'p', 30, line),
    ];
    const last = gamesOf(rows, 'p').at(-1)!.features;
    expect(last.teammargin_l10).toBeCloseTo(0.6, 12);
    expect(last.pts36_l5).toBeCloseTo(24, 12);
    expect(last.ts_l5).toBeCloseTo(60 / (2 * (45 + 0.44 * 12)), 12);
    expect(last.efg_l10).toBeCloseTo(0.6, 12);
    expect(last.ftp_l10).toBe(0.5);
    expect(last.tovr_l10).toBeCloseTo(6 / (45 + 0.44 * 12 + 6), 12);
    expect(last.ts_d5).toBe(0);
  });

  it('reads coach traits by team, zeros for an unknown team', () => {
    const atl = gamesOf([played('ATL', 0, 'p', 30)], 'p')[0].features;
    expect(atl.coach_vol).toBe(-1.0596154475544073);
    expect(atl.coach_prior_seasons).toBe(12);
    const unknown = gamesOf([played('XYZ', 0, 'p', 30)], 'p', 'XYZ')[0].features;
    expect(unknown.coach_vol).toBe(0);
  });

  it('keeps a traded player as one sequence per team', () => {
    const rows = [played('ATL', 0, 'p', 30), played('ATL', 1, 'p', 30), played('BOS', 3, 'p', 20)];
    const { sequences, lastTeamGame } = buildRoleFeatures(rows);
    expect(sequences.map((sequence) => [sequence.team, sequence.games.length])).toEqual([
      ['ATL', 2],
      ['BOS', 1],
    ]);
    expect(Object.fromEntries(lastTeamGame)).toEqual({ ATL: 1, BOS: 0 });
  });
});
