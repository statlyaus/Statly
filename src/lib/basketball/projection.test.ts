import { describe, expect, it } from 'vitest';
import type { NbaStatLine } from '@/types/basketball';
import {
  blendProjection,
  ROOKIE_BASELINE_PER_GAME,
  seasonPerGame,
  type PlayerSeasonTotals,
} from './projection';

function line(values: Partial<NbaStatLine>): NbaStatLine {
  return {
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    ...values,
  };
}

function totals(
  gamesPlayed: number,
  minutesPerGame: number,
  perGame: Partial<NbaStatLine>
): PlayerSeasonTotals {
  const full = line(perGame);
  const scaled = Object.fromEntries(
    Object.entries(full).map(([key, value]) => [key, value * gamesPlayed])
  ) as NbaStatLine;
  return {
    playerId: 'p1',
    gamesPlayed,
    secondsPlayed: minutesPerGame * 60 * gamesPlayed,
    ...scaled,
  };
}

describe('seasonPerGame', () => {
  it('divides totals by games and converts seconds to minutes', () => {
    const result = seasonPerGame({
      playerId: 'p1',
      gamesPlayed: 4,
      secondsPlayed: 4 * 32.5 * 60,
      ...line({ points: 80, fieldGoalsMade: 30, fieldGoalsAttempted: 62 }),
    });
    expect(result).not.toBeNull();
    expect(result?.minutesPerGame).toBeCloseTo(32.5, 10);
    expect(result?.perGame.points).toBe(20);
    expect(result?.perGame.fieldGoalsMade).toBe(7.5);
    expect(result?.perGame.fieldGoalsAttempted).toBe(15.5);
  });

  it('returns null for a season with no games', () => {
    expect(seasonPerGame(totals(0, 0, {}))).toBeNull();
  });
});

describe('blendProjection', () => {
  it('weights this season by games over 15 and last season by the rest', () => {
    const now = totals(6, 30, { points: 20, rebounds: 10 });
    const last = totals(70, 25, { points: 10, rebounds: 5 });

    const result = blendProjection(now, last);

    // w = 6 / 15 = 0.4
    expect(result?.weightThisSeason).toBeCloseTo(0.4, 12);
    expect(result?.gamesThisSeason).toBe(6);
    expect(result?.gamesLastSeason).toBe(70);
    expect(result?.perGame.points).toBeCloseTo(14, 10);
    expect(result?.perGame.rebounds).toBeCloseTo(7, 10);
    expect(result?.minutesPerGame).toBeCloseTo(27, 10);
  });

  it('uses this season alone from 15 games on', () => {
    const result = blendProjection(totals(22, 34, { points: 30 }), totals(60, 20, { points: 12 }));
    expect(result?.weightThisSeason).toBe(1);
    expect(result?.perGame.points).toBeCloseTo(30, 10);
    expect(result?.minutesPerGame).toBeCloseTo(34, 10);
  });

  it('blends shooting through makes and attempts, not through the percentage', () => {
    // This season 10/20 (50 %), last season 4/10 (40 %), w = 6 / 15 = 0.4.
    const result = blendProjection(
      totals(6, 30, { fieldGoalsMade: 10, fieldGoalsAttempted: 20 }),
      totals(60, 30, { fieldGoalsMade: 4, fieldGoalsAttempted: 10 })
    );
    expect(result?.perGame.fieldGoalsMade).toBeCloseTo(6.4, 10);
    expect(result?.perGame.fieldGoalsAttempted).toBeCloseTo(14, 10);
    // 6.4 / 14 = 45.71 %; blending the rates would give 44 %.
    const pct = (result?.perGame.fieldGoalsMade ?? 0) / (result?.perGame.fieldGoalsAttempted ?? 1);
    expect(pct).toBeCloseTo(0.457143, 6);
  });

  it('blends a rookie with the league baseline row, keeping his own minutes', () => {
    // Sheet: a rookie with 3 games is 20 % his own stats and 80 % the baseline player.
    const rookie = totals(3, 18, {
      points: 10,
      fieldGoalsMade: 4,
      fieldGoalsAttempted: 9,
      threePointersAttempted: 4,
    });

    const result = blendProjection(rookie, undefined);

    expect(result?.weightThisSeason).toBeCloseTo(0.2, 12);
    expect(result?.gamesLastSeason).toBe(0);
    expect(result?.perGame.points).toBeCloseTo(0.2 * 10 + 0.8 * 8, 10);
    expect(result?.perGame.fieldGoalsMade).toBeCloseTo(0.2 * 4 + 0.8 * 3, 10);
    expect(result?.perGame.fieldGoalsAttempted).toBeCloseTo(0.2 * 9 + 0.8 * 7, 10);
    expect(result?.perGame.rebounds).toBeCloseTo(0.8 * 3.2, 10);
    expect(result?.perGame.turnovers).toBeCloseTo(0.8 * 1, 10);
    // No prior for minutes or three-point attempts: his own numbers.
    expect(result?.minutesPerGame).toBeCloseTo(18, 10);
    expect(result?.perGame.threePointersAttempted).toBeCloseTo(4, 10);
  });

  it('matches the sheet baseline row', () => {
    expect(ROOKIE_BASELINE_PER_GAME).toEqual({
      fieldGoalsMade: 3,
      fieldGoalsAttempted: 7,
      freeThrowsMade: 1.1,
      freeThrowsAttempted: 1.5,
      threePointersMade: 0.9,
      points: 8,
      rebounds: 3.2,
      assists: 1.6,
      steals: 0.6,
      blocks: 0.4,
      turnovers: 1,
    });
  });

  it('uses last season alone before the player has a game this season', () => {
    const last = totals(70, 25, { points: 10 });
    expect(blendProjection(undefined, last)).toMatchObject({
      playerId: 'p1',
      gamesThisSeason: 0,
      gamesLastSeason: 70,
      weightThisSeason: 0,
      minutesPerGame: 25,
      perGame: expect.objectContaining({ points: 10 }),
    });
    expect(blendProjection(totals(0, 0, {}), last)?.perGame.points).toBeCloseTo(10, 10);
  });

  it('returns null with no games in either season', () => {
    expect(blendProjection(undefined, undefined)).toBeNull();
    expect(blendProjection(totals(0, 0, {}), totals(0, 0, {}))).toBeNull();
  });
});
