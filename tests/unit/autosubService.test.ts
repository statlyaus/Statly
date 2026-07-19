import { describe, expect, it } from 'vitest';

import {
  resolveAutosubs,
  type AutosubActiveAssignment,
  type AutosubInterchangeAssignment,
  type ResolveAutosubsInput,
} from '@/server/leagues/autosubService';

function active(
  playerId: string,
  slot: AutosubActiveAssignment['slot'],
  slotIndex: number
): AutosubActiveAssignment {
  return { playerId, slot, slotIndex };
}

function interchange(playerId: string, slotIndex: number): AutosubInterchangeAssignment {
  return { playerId, slot: 'INTERCHANGE', slotIndex };
}

describe('resolveAutosubs', () => {
  it('swaps a confirmed non-player with the first interchange player', () => {
    const resolution = resolveAutosubs({
      activeAssignments: [active('def-out', 'DEF', 0), active('mid-playing', 'MID', 0)],
      interchangeAssignments: [interchange('replacement', 0), interchange('reserve', 1)],
      confirmedDidNotPlayPlayerIds: ['def-out'],
    });

    expect(resolution).toEqual({
      activeAssignments: [active('replacement', 'DEF', 0), active('mid-playing', 'MID', 0)],
      interchangeAssignments: [interchange('def-out', 0), interchange('reserve', 1)],
      decisions: [
        {
          outgoingPlayerId: 'def-out',
          originalSlot: 'DEF',
          originalSlotIndex: 0,
          replacementPlayerId: 'replacement',
          reason: 'CONFIRMED_DID_NOT_PLAY',
          interchangeIndex: 0,
        },
      ],
    });
  });

  it('resolves outgoing players in DEF, MID, RUC, FWD, UTIL order', () => {
    const resolution = resolveAutosubs({
      activeAssignments: [
        active('util-out', 'UTIL', 0),
        active('fwd-out', 'FWD', 0),
        active('ruc-out', 'RUC', 0),
        active('mid-out', 'MID', 0),
        active('def-out', 'DEF', 0),
      ],
      interchangeAssignments: [
        interchange('bench-4', 4),
        interchange('bench-2', 2),
        interchange('bench-0', 0),
        interchange('bench-3', 3),
        interchange('bench-1', 1),
      ],
      confirmedDidNotPlayPlayerIds: ['util-out', 'fwd-out', 'ruc-out', 'mid-out', 'def-out'],
    });

    expect(resolution.activeAssignments).toEqual([
      active('bench-0', 'DEF', 0),
      active('bench-1', 'MID', 0),
      active('bench-2', 'RUC', 0),
      active('bench-3', 'FWD', 0),
      active('bench-4', 'UTIL', 0),
    ]);
    expect(resolution.decisions.map((decision) => decision.outgoingPlayerId)).toEqual([
      'def-out',
      'mid-out',
      'ruc-out',
      'fwd-out',
      'util-out',
    ]);
    expect(resolution.decisions.map((decision) => decision.interchangeIndex)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('uses slot index as the stable order within an active slot', () => {
    const resolution = resolveAutosubs({
      activeAssignments: [
        active('def-2-out', 'DEF', 2),
        active('def-0-out', 'DEF', 0),
        active('def-1-out', 'DEF', 1),
      ],
      interchangeAssignments: [
        interchange('bench-2', 2),
        interchange('bench-0', 0),
        interchange('bench-1', 1),
      ],
      confirmedDidNotPlayPlayerIds: ['def-2-out', 'def-0-out', 'def-1-out'],
    });

    expect(resolution.decisions.map((decision) => decision.originalSlotIndex)).toEqual([0, 1, 2]);
    expect(resolution.activeAssignments.map((assignment) => assignment.playerId)).toEqual([
      'bench-0',
      'bench-1',
      'bench-2',
    ]);
  });

  it('skips confirmed non-playing interchange candidates', () => {
    const resolution = resolveAutosubs({
      activeAssignments: [active('def-out', 'DEF', 0)],
      interchangeAssignments: [interchange('bench-dnp', 0), interchange('bench-playing', 1)],
      confirmedDidNotPlayPlayerIds: ['def-out', 'bench-dnp'],
    });

    expect(resolution.activeAssignments).toEqual([active('bench-playing', 'DEF', 0)]);
    expect(resolution.interchangeAssignments).toEqual([
      interchange('bench-dnp', 0),
      interchange('def-out', 1),
    ]);
    expect(resolution.decisions[0]).toMatchObject({
      replacementPlayerId: 'bench-playing',
      interchangeIndex: 1,
    });
  });

  it('uses each replacement once and leaves excess non-players unresolved', () => {
    const resolution = resolveAutosubs({
      activeAssignments: [
        active('def-out', 'DEF', 0),
        active('mid-out', 'MID', 0),
        active('fwd-out', 'FWD', 0),
      ],
      interchangeAssignments: [
        interchange('bench-0', 0),
        interchange('bench-dnp', 1),
        interchange('bench-2', 2),
      ],
      confirmedDidNotPlayPlayerIds: ['def-out', 'mid-out', 'fwd-out', 'bench-dnp'],
    });

    expect(resolution.activeAssignments).toEqual([
      active('bench-0', 'DEF', 0),
      active('bench-2', 'MID', 0),
      active('fwd-out', 'FWD', 0),
    ]);
    expect(resolution.interchangeAssignments).toEqual([
      interchange('def-out', 0),
      interchange('bench-dnp', 1),
      interchange('mid-out', 2),
    ]);
    expect(resolution.decisions).toHaveLength(2);
    expect(new Set(resolution.decisions.map((decision) => decision.replacementPlayerId)).size).toBe(
      2
    );
  });

  it('returns stable sorted copies when no autosubs are required', () => {
    const input: ResolveAutosubsInput = {
      activeAssignments: [
        active('util', 'UTIL', 0),
        active('def-1', 'DEF', 1),
        active('def-0', 'DEF', 0),
      ],
      interchangeAssignments: [interchange('bench-2', 2), interchange('bench-0', 0)],
      confirmedDidNotPlayPlayerIds: ['unknown-player'],
    };

    const resolution = resolveAutosubs(input);

    expect(resolution).toEqual({
      activeAssignments: [
        active('def-0', 'DEF', 0),
        active('def-1', 'DEF', 1),
        active('util', 'UTIL', 0),
      ],
      interchangeAssignments: [interchange('bench-0', 0), interchange('bench-2', 2)],
      decisions: [],
    });
    expect(resolution.activeAssignments).not.toBe(input.activeAssignments);
    expect(resolution.interchangeAssignments).not.toBe(input.interchangeAssignments);
  });

  it('does not mutate its input assignments or confirmed non-player list', () => {
    const input: ResolveAutosubsInput = {
      activeAssignments: [active('def-out', 'DEF', 0)],
      interchangeAssignments: [interchange('replacement', 0)],
      confirmedDidNotPlayPlayerIds: ['def-out'],
    };
    const snapshot = structuredClone(input);

    resolveAutosubs(input);

    expect(input).toEqual(snapshot);
  });

  it.each([
    {
      label: 'duplicate active slot',
      activeAssignments: [active('one', 'DEF', 0), active('two', 'DEF', 0)],
      interchangeAssignments: [],
      message: 'Duplicate autosub assignment slot: DEF:0.',
    },
    {
      label: 'duplicate interchange slot',
      activeAssignments: [],
      interchangeAssignments: [interchange('one', 0), interchange('two', 0)],
      message: 'Duplicate autosub assignment slot: INTERCHANGE:0.',
    },
    {
      label: 'player assigned twice',
      activeAssignments: [active('one', 'DEF', 0)],
      interchangeAssignments: [interchange('one', 0)],
      message: 'Duplicate autosub player assignment: one.',
    },
    {
      label: 'player assigned to two active slots',
      activeAssignments: [active('one', 'DEF', 0), active('one', 'MID', 0)],
      interchangeAssignments: [],
      message: 'Duplicate autosub player assignment: one.',
    },
  ])('rejects a $label', ({ activeAssignments, interchangeAssignments, message }) => {
    expect(() =>
      resolveAutosubs({
        activeAssignments,
        interchangeAssignments,
        confirmedDidNotPlayPlayerIds: [],
      })
    ).toThrow(message);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid slot index %s', (slotIndex) => {
    expect(() =>
      resolveAutosubs({
        activeAssignments: [active('one', 'DEF', slotIndex)],
        interchangeAssignments: [],
        confirmedDidNotPlayPlayerIds: [],
      })
    ).toThrow('Autosub assignment slotIndex must be a non-negative safe integer.');
  });

  it('rejects empty player IDs and unsupported runtime slots', () => {
    expect(() =>
      resolveAutosubs({
        activeAssignments: [active('  ', 'DEF', 0)],
        interchangeAssignments: [],
        confirmedDidNotPlayPlayerIds: [],
      })
    ).toThrow('Autosub assignments require a non-empty playerId.');

    expect(() =>
      resolveAutosubs({
        activeAssignments: [
          {
            playerId: 'one',
            slot: 'BENCH',
            slotIndex: 0,
          } as unknown as AutosubActiveAssignment,
        ],
        interchangeAssignments: [],
        confirmedDidNotPlayPlayerIds: [],
      })
    ).toThrow('Unsupported active autosub slot: BENCH.');

    expect(() =>
      resolveAutosubs({
        activeAssignments: [],
        interchangeAssignments: [
          {
            playerId: 'one',
            slot: 'BENCH',
            slotIndex: 0,
          } as unknown as AutosubInterchangeAssignment,
        ],
        confirmedDidNotPlayPlayerIds: [],
      })
    ).toThrow('Unsupported interchange autosub slot: BENCH.');
  });

  it('validates interchange player IDs and slot indexes', () => {
    expect(() =>
      resolveAutosubs({
        activeAssignments: [],
        interchangeAssignments: [interchange('', 0)],
        confirmedDidNotPlayPlayerIds: [],
      })
    ).toThrow('Autosub assignments require a non-empty playerId.');

    expect(() =>
      resolveAutosubs({
        activeAssignments: [],
        interchangeAssignments: [interchange('one', -1)],
        confirmedDidNotPlayPlayerIds: [],
      })
    ).toThrow('Autosub assignment slotIndex must be a non-negative safe integer.');
  });
});
