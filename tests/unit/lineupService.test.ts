import { describe, expect, it } from 'vitest';

import {
  canAssignPlayerToSlot,
  isLineupPlayerLocked,
  validateLineupSubmission,
} from '@/server/leagues/lineupService';
import { DEFAULT_ACTIVE_LINEUP_SLOTS } from '@/server/leagues/lineupSettings';

describe('lineup service', () => {
  it('allows utility and bench slots to accept any AFL position', () => {
    expect(canAssignPlayerToSlot('DEF', 'UTIL')).toBe(true);
    expect(canAssignPlayerToSlot('MID', 'UTIL')).toBe(true);
    expect(canAssignPlayerToSlot('RUC', 'BENCH')).toBe(true);
    expect(canAssignPlayerToSlot('FWD', 'UTIL')).toBe(true);
  });

  it('requires matching position for fixed active slots', () => {
    expect(canAssignPlayerToSlot('DEF', 'DEF')).toBe(true);
    expect(canAssignPlayerToSlot('DEF', 'MID')).toBe(false);
    expect(canAssignPlayerToSlot('RUC', 'FWD')).toBe(false);
  });

  it('locks a player once their AFL game has started', () => {
    const now = new Date('2026-07-04T10:10:00.000Z');
    expect(isLineupPlayerLocked(new Date('2026-07-04T10:00:00.000Z'), now)).toBe(true);
    expect(isLineupPlayerLocked(new Date('2026-07-04T10:30:00.000Z'), now)).toBe(false);
  });

  it('rejects duplicate players, ineligible slots, and non-roster players', () => {
    const result = validateLineupSubmission({
      now: new Date('2026-07-04T10:00:00.000Z'),
      lineupSlots: DEFAULT_ACTIVE_LINEUP_SLOTS,
      rosterPlayers: [
        { playerId: 'p1', position: 'DEF' },
        { playerId: 'p2', position: 'FWD' },
      ],
      existingLockedPlayers: [],
      submittedPlayers: [
        { playerId: 'p1', slot: 'MID', slotIndex: 0 },
        { playerId: 'p1', slot: 'DEF', slotIndex: 0 },
        { playerId: 'p3', slot: 'FWD', slotIndex: 0 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate'),
        expect.stringContaining('eligible'),
        expect.stringContaining('roster'),
      ])
    );
  });
});
