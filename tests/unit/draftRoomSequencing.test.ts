import { describe, expect, it, vi } from 'vitest';

import { buildDraftRoomSequence, getDraftRoomTimerState } from '@/lib/draftRoomSequencing';

const participants = Array.from({ length: 6 }, (_, index) => ({
  id: `member-${index + 1}`,
  userId: `user-${index + 1}`,
  displayName: `Team ${index + 1}`,
  teamName: `Team ${index + 1}`,
  draftOrder: index + 1,
}));

describe('buildDraftRoomSequence', () => {
  it('returns current, completed, upcoming, and next user pick slots in snake order', () => {
    const sequence = buildDraftRoomSequence({
      currentPick: 7,
      totalPicks: 18,
      participants,
      picks: [
        {
          id: 'pick-6',
          overall: 6,
          round: 1,
          slot: 6,
          player: {
            id: 'player-6',
            name: 'Completed Player',
            position: 'MID',
            club: 'Collingwood',
          },
          member: { id: 'member-6', displayName: 'Team 6', teamName: 'Team 6' },
          auto: false,
          madeAt: new Date('2026-06-13T00:00:00.000Z'),
        },
      ],
      yourSlot: 1,
      windowBefore: 1,
      windowAfter: 4,
    });

    expect(sequence.current).toMatchObject({
      overall: 7,
      round: 2,
      slot: 6,
      displayName: 'Team 6',
      status: 'current',
    });
    expect(sequence.slots.map((slot) => slot.overall)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(sequence.slots.map((slot) => slot.slot)).toEqual([6, 6, 5, 4, 3, 2, 1]);
    expect(sequence.nextUserPick).toMatchObject({
      overall: 12,
      picksUntil: 5,
      estimatedSecondsUntil: 600,
    });
  });

  it('handles completed drafts without inventing a live current slot', () => {
    const sequence = buildDraftRoomSequence({
      currentPick: 19,
      totalPicks: 18,
      participants,
      picks: [],
      yourSlot: 1,
      status: 'COMPLETED',
    });

    expect(sequence.current).toBeNull();
    expect(sequence.nextUserPick).toBeNull();
    expect(sequence.phase).toBe('COMPLETED');
  });
});

describe('getDraftRoomTimerState', () => {
  it('derives remaining seconds and urgency from an authoritative deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T10:00:00.000Z'));

    expect(
      getDraftRoomTimerState({
        status: 'LIVE',
        timePerPick: 120,
        pickDeadlineAt: '2026-06-13T10:00:45.000Z',
      })
    ).toMatchObject({
      remainingSeconds: 45,
      percentRemaining: 38,
      tone: 'warning',
      label: 'Short clock',
      isRunning: true,
    });

    vi.useRealTimers();
  });

  it('freezes the clock for paused and completed states', () => {
    expect(
      getDraftRoomTimerState({
        status: 'PAUSED',
        timePerPick: 120,
        pickDeadlineAt: '2026-06-13T10:00:45.000Z',
      })
    ).toMatchObject({
      remainingSeconds: 120,
      percentRemaining: 100,
      tone: 'neutral',
      label: 'Paused',
      isRunning: false,
    });
  });
});
