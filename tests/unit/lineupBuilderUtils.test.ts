import { describe, expect, it } from 'vitest';

import {
  assignPlayerToSpot,
  buildLineupFieldSpots,
  getAvailableRosterPlayers,
  normalizeLineupBuilderSlots,
  removeAssignmentFromSpot,
} from '@/components/league/matchups/lineupBuilderUtils';

describe('lineup builder utils', () => {
  it('normalizes invalid lineup slot settings back to defaults', () => {
    expect(normalizeLineupBuilderSlots(null)).toMatchObject({
      FWD: 5,
      DEF: 5,
      MID: 5,
      RUC: 1,
      UTIL: 3,
    });
    expect(normalizeLineupBuilderSlots({ FWD: 4, MID: -1 })).toMatchObject({
      FWD: 4,
      MID: 5,
    });
  });

  it('builds stable AFL field spots from configured active slots', () => {
    const spots = buildLineupFieldSpots({ FWD: 2, MID: 1, RUC: 1, DEF: 2, UTIL: 1 });

    expect(spots.map((spot) => spot.id)).toEqual([
      'FWD:0',
      'FWD:1',
      'MID:0',
      'RUC:0',
      'DEF:0',
      'DEF:1',
      'UTIL:0',
    ]);
  });

  it('keeps roster players available until they are assigned', () => {
    const available = getAvailableRosterPlayers(
      [
        { playerId: 'p1', name: 'Player One', position: null, club: 'ADE' },
        { playerId: 'p2', name: 'Player Two', position: 'DEF', club: 'COL' },
      ],
      [{ playerId: 'p1', slot: 'FWD', slotIndex: 0 }]
    );

    expect(available.map((player) => player.playerId)).toEqual(['p2']);
  });

  it('moves a player between spots and clears any previous occupant', () => {
    const assignments = assignPlayerToSpot(
      [
        { playerId: 'p1', slot: 'FWD', slotIndex: 0 },
        { playerId: 'p2', slot: 'MID', slotIndex: 0 },
      ],
      'p1',
      { slot: 'MID', slotIndex: 0 }
    );

    expect(assignments).toEqual([{ playerId: 'p1', slot: 'MID', slotIndex: 0 }]);
  });

  it('removes a player from a field spot', () => {
    const assignments = removeAssignmentFromSpot(
      [
        { playerId: 'p1', slot: 'FWD', slotIndex: 0 },
        { playerId: 'p2', slot: 'MID', slotIndex: 0 },
      ],
      { slot: 'FWD', slotIndex: 0 }
    );

    expect(assignments).toEqual([{ playerId: 'p2', slot: 'MID', slotIndex: 0 }]);
  });
});
