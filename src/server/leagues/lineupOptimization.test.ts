import { describe, expect, it } from 'vitest';

import {
  calculateLineupContributionValue,
  optimizeLineupAssignment,
  type LineupOptimizationCandidate,
} from './lineupOptimization';
import type { LineupSlotSettings } from './scoringTypes';

const SINGLE_SLOT_SETTINGS: LineupSlotSettings = { FWD: 1, DEF: 1, MID: 1, RUC: 0, UTIL: 0 };

function candidate(
  playerId: string,
  value: number,
  extra: Partial<LineupOptimizationCandidate> = {}
): LineupOptimizationCandidate {
  return { playerId, value, isLocked: false, ...extra };
}

function activeValueOf(
  candidates: readonly LineupOptimizationCandidate[],
  assignments: readonly { playerId: string; slot: string; slotIndex: number }[]
): number {
  const valueByPlayerId = new Map(candidates.map((item) => [item.playerId, item.value]));
  return assignments
    .filter((assignment) => assignment.slot !== 'BENCH' && assignment.slot !== 'INTERCHANGE')
    .reduce((total, assignment) => total + (valueByPlayerId.get(assignment.playerId) ?? 0), 0);
}

describe('optimizeLineupAssignment', () => {
  it('pins a locked player and fills the remaining active slots with the highest values', () => {
    const candidates = [
      candidate('locked-def', 1, {
        isLocked: true,
        lockedSlot: 'DEF',
        lockedSlotIndex: 0,
        previousSlot: 'DEF',
        previousSlotIndex: 0,
      }),
      candidate('high', 90),
      candidate('mid', 50),
      candidate('low', 10),
    ];

    const result = optimizeLineupAssignment({
      candidates,
      lineupSlots: SINGLE_SLOT_SETTINGS,
      interchangeSlots: 1,
    });

    const slotByPlayerId = new Map(result.assignments.map((a) => [a.playerId, a.slot]));

    expect(slotByPlayerId.get('locked-def')).toBe('DEF');
    expect(slotByPlayerId.get('high')).toBe('FWD');
    expect(slotByPlayerId.get('mid')).toBe('MID');
    expect(slotByPlayerId.get('low')).not.toBe('FWD');
    expect(activeValueOf(candidates, result.assignments)).toBe(141);
  });

  it('matches an exhaustive search of every legal active assignment', () => {
    const candidates = [
      candidate('a', 12),
      candidate('b', 7, { isLocked: true, lockedSlot: 'MID', lockedSlotIndex: 0 }),
      candidate('c', 40),
      candidate('d', 3),
      candidate('e', 18),
    ];

    const result = optimizeLineupAssignment({
      candidates,
      lineupSlots: SINGLE_SLOT_SETTINGS,
      interchangeSlots: 2,
    });

    // MID is pinned to the locked candidate, so only FWD and DEF remain contestable.
    const lockedValues = candidates
      .filter((item) => item.isLocked)
      .reduce((total, item) => total + item.value, 0);
    const unlocked = candidates.filter((item) => !item.isLocked);
    let best = lockedValues;
    for (const first of unlocked) {
      for (const second of unlocked) {
        if (first.playerId === second.playerId) continue;
        best = Math.max(best, lockedValues + first.value + second.value);
      }
    }

    expect(best).toBe(65);
    expect(activeValueOf(candidates, result.assignments)).toBe(best);
  });

  it('fills interchange up to the configured count and benches the remainder', () => {
    const candidates = [1, 2, 3, 4, 5].map((value, index) => candidate(`p${index}`, value));

    const result = optimizeLineupAssignment({
      candidates,
      lineupSlots: SINGLE_SLOT_SETTINGS,
      interchangeSlots: 1,
    });

    const bySlot = result.assignments.reduce<Record<string, string[]>>((groups, assignment) => {
      groups[assignment.slot] = [...(groups[assignment.slot] ?? []), assignment.playerId];
      return groups;
    }, {});

    expect(bySlot.INTERCHANGE).toHaveLength(1);
    expect(bySlot.BENCH).toHaveLength(1);
    expect(bySlot.FWD).toHaveLength(1);
    expect(bySlot.DEF).toHaveLength(1);
    expect(bySlot.MID).toHaveLength(1);
    expect(result.assignments).toHaveLength(candidates.length);
  });

  it('assigns every player and slot at most once and is stable for equal values', () => {
    const candidates = [candidate('zulu', 5), candidate('alpha', 5), candidate('mike', 5), candidate('kilo', 5)];

    const first = optimizeLineupAssignment({
      candidates,
      lineupSlots: SINGLE_SLOT_SETTINGS,
      interchangeSlots: 0,
    });
    const second = optimizeLineupAssignment({
      candidates,
      lineupSlots: SINGLE_SLOT_SETTINGS,
      interchangeSlots: 0,
    });

    expect(second.assignments).toEqual(first.assignments);
    expect(new Set(first.assignments.map((a) => a.playerId)).size).toBe(candidates.length);
    expect(
      new Set(first.assignments.map((a) => `${a.slot}:${a.slotIndex}`)).size
    ).toBe(candidates.length);
    expect(first.assignments.slice(0, 3).map((a) => a.playerId)).toEqual([
      'alpha',
      'kilo',
      'mike',
    ]);
  });

  it('rejects duplicate player ids and incomplete lock placement', () => {
    expect(() =>
      optimizeLineupAssignment({
        candidates: [candidate('dup', 1), candidate('dup', 2)],
        lineupSlots: SINGLE_SLOT_SETTINGS,
        interchangeSlots: 0,
      })
    ).toThrowError(/duplicate/i);

    expect(() =>
      optimizeLineupAssignment({
        candidates: [candidate('locked', 1, { isLocked: true })],
        lineupSlots: SINGLE_SLOT_SETTINGS,
        interchangeSlots: 0,
      })
    ).toThrowError(/locked/i);
  });
});

describe('calculateLineupContributionValue', () => {
  it('adds HIGH_WINS categories, subtracts LOW_WINS categories, and ignores missing values', () => {
    const value = calculateLineupContributionValue({
      categories: ['goals', 'tackles', 'clangers', 'intercepts'],
      categoryDirections: { clangers: 'LOW_WINS' },
      valuesByCategory: { goals: 2, tackles: 6, clangers: 1.5, intercepts: null },
    });

    expect(value).toBe(2 + 6 - 1.5);
  });

  it('treats an absent direction as HIGH_WINS', () => {
    expect(
      calculateLineupContributionValue({
        categories: ['goals'],
        categoryDirections: {},
        valuesByCategory: { goals: 3 },
      })
    ).toBe(3);
  });
});
