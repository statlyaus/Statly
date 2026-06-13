import { describe, expect, it } from 'vitest';

import {
  calculateDraftCompletionPct,
  groupPicksByRound,
  parseDraftHistoryLimit,
  type DraftHistoryPick,
} from '@/server/draft/readModels/draftHistoryReadModel';

const basePick = {
  id: 'pick-1',
  slot: 1,
  auto: false,
  madeAt: '2026-06-13T00:00:00.000Z',
  player: {
    id: 'player-1',
    name: 'Caleb Daniel',
    position: 'DEF',
    club: 'North Melbourne',
  },
  member: {
    id: 'member-1',
    userId: 'user-1',
    displayName: 'Statly Dev Tester',
    teamName: 'Statly Dev Tester',
    role: 'OWNER',
    slot: 1,
  },
} satisfies Omit<DraftHistoryPick, 'overall' | 'round'>;

describe('draft history read model helpers', () => {
  it('groups picks into ordered round buckets without losing pick order', () => {
    const rounds = groupPicksByRound([
      { ...basePick, id: 'pick-3', overall: 3, round: 2 },
      { ...basePick, id: 'pick-1', overall: 1, round: 1 },
      { ...basePick, id: 'pick-2', overall: 2, round: 1 },
    ]);

    expect(rounds).toEqual([
      {
        round: 1,
        picks: [
          expect.objectContaining({ id: 'pick-1', overall: 1 }),
          expect.objectContaining({ id: 'pick-2', overall: 2 }),
        ],
      },
      {
        round: 2,
        picks: [expect.objectContaining({ id: 'pick-3', overall: 3 })],
      },
    ]);
  });

  it('bounds API history limits so archive loading stays deliberate', () => {
    expect(parseDraftHistoryLimit(null)).toBe(25);
    expect(parseDraftHistoryLimit('0')).toBe(1);
    expect(parseDraftHistoryLimit('12')).toBe(12);
    expect(parseDraftHistoryLimit('999')).toBe(50);
    expect(parseDraftHistoryLimit('not-a-number')).toBe(25);
  });

  it('calculates completion percentage defensively', () => {
    expect(calculateDraftCompletionPct(0, 0)).toBe(0);
    expect(calculateDraftCompletionPct(2, 4)).toBe(50);
    expect(calculateDraftCompletionPct(5, 4)).toBe(100);
  });
});
