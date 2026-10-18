import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { draftRepository } from '@/server/draft/repository/DraftRepository';

describe('DraftRepository.toEventPick', () => {
  it('reports the persisted pick time, not the time of the replay', () => {
    const madeAt = new Date('2024-01-01T00:00:00.000Z');
    const pick = {
      id: 'pick-1',
      memberId: 'member-1',
      auto: false,
      madeAt,
      player: { id: 'player-1', name: 'Jordan Example', position: 'MID', club: 'SYD' },
      member: { user: { displayName: 'Robbie', email: 'robbie@example.com' } },
    } as never;

    const event = draftRepository.toEventPick(pick, 5, 1, 5);

    expect(event.madeAt).toBe('2024-01-01T00:00:00.000Z');
    expect(event.timestamp).toEqual(madeAt);
  });
});
