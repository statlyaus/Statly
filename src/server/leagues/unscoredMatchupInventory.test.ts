import { describe, expect, it } from 'vitest';

import { classifyUnscoredSide } from '@/server/leagues/unscoredMatchupInventory';

const SET_AT = new Date('2026-04-22T10:00:00.000Z');
const BEFORE = new Date('2026-04-22T09:30:00.000Z');
const AFTER = new Date('2026-04-22T11:00:00.000Z');

function starts(entries: Record<string, Date>) {
  return new Map(Object.entries(entries));
}

describe('classifyUnscoredSide', () => {
  it('reports no lineup when the member never saved one for the round', () => {
    const result = classifyUnscoredSide({
      lineupCreatedAt: null,
      lineupUpdatedAt: null,
      players: [],
      gameStartsByPlayerId: starts({}),
    });

    expect(result.classification).toBe('NO_LINEUP');
  });

  it('marks a lineup saved after one player game started as late, counting that player as started', () => {
    const result = classifyUnscoredSide({
      lineupCreatedAt: SET_AT,
      lineupUpdatedAt: SET_AT,
      players: [{ playerId: 'early' }, { playerId: 'later' }],
      gameStartsByPlayerId: starts({ early: BEFORE, later: AFTER }),
    });

    expect(result).toMatchObject({
      classification: 'LATE_SET',
      startedBeforeSet: 1,
      notStarted: 1,
      unknownStart: 0,
      edited: false,
    });
  });

  it('marks a lineup saved before every game as pre-start, which should already have scored', () => {
    const result = classifyUnscoredSide({
      lineupCreatedAt: BEFORE,
      lineupUpdatedAt: BEFORE,
      players: [{ playerId: 'a' }],
      gameStartsByPlayerId: starts({ a: AFTER }),
    });

    expect(result.classification).toBe('PRE_START_SET');
  });

  it('flags a player with no known game start instead of guessing', () => {
    const result = classifyUnscoredSide({
      lineupCreatedAt: SET_AT,
      lineupUpdatedAt: SET_AT,
      players: [{ playerId: 'known' }, { playerId: 'unknown' }],
      gameStartsByPlayerId: starts({ known: BEFORE }),
    });

    expect(result).toMatchObject({ classification: 'UNKNOWN_START', unknownStart: 1 });
  });

  it('reports timing as unavailable without classifying the lineup', () => {
    const result = classifyUnscoredSide({
      lineupCreatedAt: SET_AT,
      lineupUpdatedAt: SET_AT,
      players: [{ playerId: 'a' }],
      gameStartsByPlayerId: null,
    });

    expect(result.classification).toBe('TIMING_UNAVAILABLE');
  });

  it('flags a lineup edited long after it was first saved', () => {
    const result = classifyUnscoredSide({
      lineupCreatedAt: BEFORE,
      lineupUpdatedAt: AFTER,
      players: [{ playerId: 'a' }],
      gameStartsByPlayerId: starts({ a: AFTER }),
    });

    expect(result.edited).toBe(true);
  });
});
