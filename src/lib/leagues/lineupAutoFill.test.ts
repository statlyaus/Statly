import { describe, expect, it } from 'vitest';

import {
  autoFillLineup,
  buildDefaultLineup,
  positionSuitsSlot,
  scorePlayersByStats,
  type AutoFillPlayer,
} from './lineupAutoFill';

const player = (
  playerId: string,
  position: string | null,
  score = 0,
  available = true
): AutoFillPlayer => ({ playerId, position, score, available });

describe('lineupAutoFill', () => {
  it('checks positions, including dual positions', () => {
    expect(positionSuitsSlot('DEF/MID', 'MID')).toBe(true);
    expect(positionSuitsSlot('DEF/MID', 'FWD')).toBe(false);
    expect(positionSuitsSlot('Ruck', 'RUC')).toBe(true);
    expect(positionSuitsSlot(null, 'DEF')).toBe(false);
    expect(positionSuitsSlot(null, 'UTIL')).toBe(true);
    expect(positionSuitsSlot('FWD', 'INTERCHANGE')).toBe(true);
  });

  it('fills the scarcest position first so dual-position players go where they are needed', () => {
    const next = autoFillLineup({
      assignments: [],
      spots: [
        { slot: 'DEF', slotIndex: 0 },
        { slot: 'RUC', slotIndex: 0 },
      ],
      // The best player is the only ruck; a plain DEF-first fill would spend him on DEF.
      players: [player('def-ruc', 'DEF/RUC', 10), player('def', 'DEF', 5)],
    });
    expect(next).toEqual(
      expect.arrayContaining([
        { playerId: 'def-ruc', slot: 'RUC', slotIndex: 0 },
        { playerId: 'def', slot: 'DEF', slotIndex: 0 },
      ])
    );
  });

  it('never fills a position spot out of position, and gives UTIL and interchange the best left', () => {
    const next = autoFillLineup({
      assignments: [{ playerId: 'kept', slot: 'MID', slotIndex: 0 }],
      spots: [
        { slot: 'MID', slotIndex: 0 },
        { slot: 'RUC', slotIndex: 0 },
        { slot: 'UTIL', slotIndex: 0 },
        { slot: 'INTERCHANGE', slotIndex: 0 },
      ],
      players: [
        player('kept', 'MID', 1),
        player('fwd-best', 'FWD', 9),
        player('fwd-next', 'FWD', 4),
        player('hurt', 'RUC', 20, false),
      ],
    });
    expect(next).toEqual([
      { playerId: 'kept', slot: 'MID', slotIndex: 0 },
      { playerId: 'fwd-best', slot: 'UTIL', slotIndex: 0 },
      { playerId: 'fwd-next', slot: 'INTERCHANGE', slotIndex: 0 },
    ]);
  });

  it('keeps valid previous picks and marks where the default came from', () => {
    const spots = [
      { slot: 'DEF' as const, slotIndex: 0 },
      { slot: 'MID' as const, slotIndex: 0 },
    ];
    const players = [player('d', 'DEF', 1), player('m', 'MID', 1), player('m2', 'MID', 5)];
    const carried = buildDefaultLineup({
      spots,
      players,
      previous: [
        { playerId: 'm', slot: 'MID', slotIndex: 0 },
        { playerId: 'd', slot: 'MID', slotIndex: 1 },
      ],
    });
    expect(carried.source).toBe('CARRIED');
    expect(carried.assignments).toEqual([
      { playerId: 'm', slot: 'MID', slotIndex: 0 },
      { playerId: 'd', slot: 'DEF', slotIndex: 0 },
    ]);

    const fresh = buildDefaultLineup({ spots, players });
    expect(fresh.source).toBe('AUTO');
    expect(fresh.assignments).toEqual(
      expect.arrayContaining([
        { playerId: 'd', slot: 'DEF', slotIndex: 0 },
        { playerId: 'm2', slot: 'MID', slotIndex: 0 },
      ])
    );
  });

  it('scores players across categories, discounting few games and low-wins categories', () => {
    const scores = scorePlayersByStats(
      [{ key: 'goals' }, { key: 'turnovers', direction: 'LOW_WINS' }],
      {
        a: { gamesPlayed: 10, values: { goals: 3, turnovers: 2 } },
        b: { gamesPlayed: 10, values: { goals: 1, turnovers: 4 } },
        c: { gamesPlayed: 1, values: { goals: 3, turnovers: 2 } },
      }
    );
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!);
    expect(scores.get('a')!).toBeGreaterThan(scores.get('c')!);
  });
});
