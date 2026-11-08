import { describe, expect, it } from 'vitest';

import { toRoleGameRows, type RoleBoxRow } from './roleGameRows';

/** One player's stored line; `minutes` are whole minutes, as ESPN prints them. */
function box(
  playerId: string,
  minutes: number,
  line: Partial<RoleBoxRow> = {},
  game: Partial<RoleBoxRow> = {}
): RoleBoxRow {
  return {
    gameId: 'g1',
    gameDate: '2026-10-21',
    teamCode: 'ATL',
    playerId,
    played: true,
    secondsPlayed: minutes * 60,
    teamScore: 101,
    opponentScore: 98,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    threePointersMade: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    plusMinus: 0,
    ...game,
    ...line,
  };
}

describe('toRoleGameRows', () => {
  it('keeps played rows, in date order, with the box-score usage rate and team margin', () => {
    const later = { gameId: 'g2', gameDate: '2026-10-23' };
    const rows = toRoleGameRows([
      box('a1', 30, { fieldGoalsAttempted: 10 }, later),
      box('b1', 48, { fieldGoalsAttempted: 20, points: 30, threePointersMade: 2, plusMinus: 7 }),
      box('b2', 48, { fieldGoalsAttempted: 5 }),
      box('b3', 48, { fieldGoalsAttempted: 5 }),
      box('b4', 48, { fieldGoalsAttempted: 5 }),
      box('b5', 48, { fieldGoalsAttempted: 5 }),
      box('b6', 0, { played: false }),
    ]);
    expect(rows.map((row) => row.playerId)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'a1']);
    // 100 · 20 · (240 / 5) / (48 · 40) and 100 · 5 · 48 / (48 · 40).
    expect(rows[0]).toMatchObject({
      date: '2026-10-21',
      team: 'ATL',
      min: 48,
      usg: 50,
      pts: 30,
      fg3m: 2,
      pm: 7,
      margin: 3,
    });
    expect(rows[1].usg).toBe(12.5);
  });

  it('counts a played row with no credited seconds as a quarter of a minute', () => {
    const rows = toRoleGameRows([
      box('c1', 60, { fieldGoalsAttempted: 10 }),
      box('c2', 60, { fieldGoalsAttempted: 10 }),
      box('c3', 60, { fieldGoalsAttempted: 10 }),
      box('c4', 60, { fieldGoalsAttempted: 10 }),
      box('cameo', 0, { freeThrowsAttempted: 1 }),
    ]);
    // Team possessions 40 + 0.44 · 1; team minutes 240.25 snap to 240.
    expect(rows.find((row) => row.playerId === 'cameo')).toMatchObject({ min: 0.25, usg: 208.9 });
    expect(rows[0].usg).toBe(19.8);
  });

  it('snaps team minutes to regulation plus 25 per overtime', () => {
    const rows = toRoleGameRows(
      [53, 53, 53, 52, 52].map((minutes, index) =>
        box(`o${index}`, minutes, { fieldGoalsAttempted: 10 })
      )
    );
    // 263 whole minutes is one overtime: 265 / 5 = 53 per player slot.
    expect(rows.map((row) => row.usg)).toEqual([20, 20, 20, 20.4, 20.4]);
  });

  it('gives no usage without a shot, free throw or turnover', () => {
    const rows = toRoleGameRows([box('z1', 20), box('z2', 20, { fieldGoalsAttempted: 4 })]);
    expect(rows[0].usg).toBe(0);
  });
});
