import { describe, expect, it } from 'vitest';

import { classifyUnscoredSide } from '@/server/leagues/unscoredMatchupInventory';

const SET_AT = new Date('2026-04-22T10:00:00.000Z');
const BEFORE = new Date('2026-04-22T09:30:00.000Z');
const AFTER = new Date('2026-04-22T11:00:00.000Z');

function starts(entries: Record<string, Date>) {
  return new Map(Object.entries(entries));
}

const lineup = {
  lineupCreatedAt: SET_AT,
  lineupUpdatedAt: SET_AT,
  lineupScopeAmbiguous: false,
};

describe('classifyUnscoredSide', () => {
  it('reports no lineup when the member never saved one for the round', () => {
    const result = classifyUnscoredSide({
      lineupCreatedAt: null,
      lineupUpdatedAt: null,
      players: [],
      lineupScopeAmbiguous: false,
      gameStartsByPlayerId: starts({}),
    });

    expect(result.classification).toBe('NO_LINEUP');
  });

  it('reports a saved lineup with no players as empty, not as missing', () => {
    const result = classifyUnscoredSide({
      ...lineup,
      players: [],
      gameStartsByPlayerId: starts({}),
    });

    expect(result.classification).toBe('EMPTY_LINEUP');
  });

  it('does not classify a lineup whose round number is shared by another round of the league', () => {
    const result = classifyUnscoredSide({
      ...lineup,
      lineupScopeAmbiguous: true,
      players: [{ playerId: 'a', setAt: SET_AT }],
      gameStartsByPlayerId: starts({ a: BEFORE }),
    });

    expect(result).toMatchObject({ classification: 'LINEUP_SCOPE_AMBIGUOUS', startedBeforeSet: 0 });
  });

  it('marks a player set after its game started as late, counting the others as not started', () => {
    const result = classifyUnscoredSide({
      ...lineup,
      players: [
        { playerId: 'early', setAt: SET_AT },
        { playerId: 'later', setAt: SET_AT },
      ],
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

  it('judges each player by its own set time, not the lineup first save', () => {
    // The lineup was first saved before every game; the second player was added after its game started.
    const result = classifyUnscoredSide({
      lineupCreatedAt: BEFORE,
      lineupUpdatedAt: AFTER,
      lineupScopeAmbiguous: false,
      players: [
        { playerId: 'kept', setAt: BEFORE },
        { playerId: 'added', setAt: AFTER },
      ],
      gameStartsByPlayerId: starts({ kept: SET_AT, added: SET_AT }),
    });

    expect(result).toMatchObject({
      classification: 'LATE_SET',
      startedBeforeSet: 1,
      notStarted: 1,
      edited: true,
    });
  });

  it('marks a lineup whose players were all set before their games as pre-start', () => {
    const result = classifyUnscoredSide({
      ...lineup,
      players: [{ playerId: 'a', setAt: BEFORE }],
      gameStartsByPlayerId: starts({ a: AFTER }),
    });

    expect(result.classification).toBe('PRE_START_SET');
  });

  it('flags a player with no known game start instead of guessing', () => {
    const result = classifyUnscoredSide({
      ...lineup,
      players: [
        { playerId: 'known', setAt: SET_AT },
        { playerId: 'unknown', setAt: SET_AT },
      ],
      gameStartsByPlayerId: starts({ known: BEFORE }),
    });

    expect(result).toMatchObject({ classification: 'UNKNOWN_START', unknownStart: 1 });
  });

  it('reports timing as unavailable without classifying the lineup', () => {
    const result = classifyUnscoredSide({
      ...lineup,
      players: [{ playerId: 'a', setAt: SET_AT }],
      gameStartsByPlayerId: null,
    });

    expect(result.classification).toBe('TIMING_UNAVAILABLE');
  });
});
