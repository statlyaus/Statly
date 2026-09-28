import { describe, expect, it } from 'vitest';

import {
  buildMyTeamSpots,
  canPlacePlayer,
  countLineupChanges,
  placePlayer,
  positionSuitsSlot,
  summarizeLineup,
} from './myTeamLineup';

const slots = { DEF: 2, MID: 2, RUC: 1, FWD: 2, UTIL: 1 };

describe('buildMyTeamSpots', () => {
  it('orders spots defence to forward, then utility, then interchange', () => {
    expect(buildMyTeamSpots(slots, 2).map((spot) => spot.label)).toEqual([
      'DEF 1',
      'DEF 2',
      'MID 1',
      'MID 2',
      'RUC 1',
      'FWD 1',
      'FWD 2',
      'UTIL 1',
      'INT 1',
      'INT 2',
    ]);
  });
});

describe('placePlayer', () => {
  it('swaps two selected players', () => {
    const result = placePlayer(
      [
        { playerId: 'a', slot: 'DEF', slotIndex: 0 },
        { playerId: 'b', slot: 'MID', slotIndex: 1 },
      ],
      'a',
      { slot: 'MID', slotIndex: 1 }
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { playerId: 'a', slot: 'MID', slotIndex: 1 },
        { playerId: 'b', slot: 'DEF', slotIndex: 0 },
      ])
    );
    expect(result).toHaveLength(2);
  });

  it('sends the occupant back to the squad when a squad player takes the spot', () => {
    expect(
      placePlayer([{ playerId: 'b', slot: 'MID', slotIndex: 0 }], 'c', {
        slot: 'MID',
        slotIndex: 0,
      })
    ).toEqual([{ playerId: 'c', slot: 'MID', slotIndex: 0 }]);
  });
});

describe('positionSuitsSlot', () => {
  it('matches dual positions and lets anyone play utility or interchange', () => {
    expect(positionSuitsSlot('MID/FWD', 'FWD')).toBe(true);
    expect(positionSuitsSlot('Ruck', 'RUC')).toBe(true);
    expect(positionSuitsSlot('DEF', 'MID')).toBe(false);
    expect(positionSuitsSlot(null, 'UTIL')).toBe(true);
    expect(positionSuitsSlot(null, 'INTERCHANGE')).toBe(true);
  });
});

describe('canPlacePlayer', () => {
  const positions: Record<string, string> = { d: 'DEF', m: 'MID', dm: 'DEF/MID' };
  const positionOf = (playerId: string) => positions[playerId];

  it('only allows a player into a spot their position suits', () => {
    expect(canPlacePlayer([], 'd', { slot: 'DEF', slotIndex: 0 }, positionOf)).toBe(true);
    expect(canPlacePlayer([], 'd', { slot: 'MID', slotIndex: 0 }, positionOf)).toBe(false);
    expect(canPlacePlayer([], 'd', { slot: 'UTIL', slotIndex: 0 }, positionOf)).toBe(true);
  });

  it('checks the occupant can take the vacated spot on a swap', () => {
    const lineup = [
      { playerId: 'dm', slot: 'DEF' as const, slotIndex: 0 },
      { playerId: 'm', slot: 'MID' as const, slotIndex: 0 },
      { playerId: 'd', slot: 'UTIL' as const, slotIndex: 0 },
    ];
    // DEF/MID into MID would send the MID to DEF: not allowed.
    expect(canPlacePlayer(lineup, 'dm', { slot: 'MID', slotIndex: 0 }, positionOf)).toBe(false);
    // DEF from UTIL into DEF sends DEF/MID to UTIL: allowed.
    expect(canPlacePlayer(lineup, 'd', { slot: 'DEF', slotIndex: 0 }, positionOf)).toBe(true);
  });
});

describe('countLineupChanges', () => {
  it('counts spots whose player changed', () => {
    expect(
      countLineupChanges(
        [
          { playerId: 'a', slot: 'DEF', slotIndex: 0 },
          { playerId: 'b', slot: 'MID', slotIndex: 0 },
        ],
        [
          { playerId: 'b', slot: 'DEF', slotIndex: 0 },
          { playerId: 'a', slot: 'MID', slotIndex: 0 },
          { playerId: 'c', slot: 'UTIL', slotIndex: 0 },
        ]
      )
    ).toBe(3);
  });
});

describe('summarizeLineup', () => {
  it('counts on-field and interchange places separately', () => {
    const spots = buildMyTeamSpots(slots, 1);
    expect(
      summarizeLineup(
        [
          { playerId: 'a', slot: 'DEF', slotIndex: 0 },
          { playerId: 'b', slot: 'INTERCHANGE', slotIndex: 0 },
        ],
        spots
      )
    ).toEqual({
      onField: 1,
      fieldSpots: 8,
      interchange: 1,
      interchangeSpots: 1,
      emptyField: 7,
      emptyInterchange: 0,
    });
  });
});
