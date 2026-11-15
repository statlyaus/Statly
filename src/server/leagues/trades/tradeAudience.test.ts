import { describe, expect, it, vi } from 'vitest';

import type { SocialRealtimeEnvelope } from '@/types/social';

import { privateTradeAudience } from './tradeAudience';

type TradeAudienceClient = Parameters<typeof privateTradeAudience>[0];

function envelope(eventType: string): SocialRealtimeEnvelope {
  return {
    id: 'event-1',
    sequence: 1,
    leagueId: 'league-1',
    seasonId: 'season-1',
    channel: 'activity',
    event: 'trade:update',
    payload: { threadId: 'thread-1', offerId: 'offer-1', eventType, status: null },
    occurredAt: '2026-07-19T10:00:00.000Z',
  };
}

function client() {
  const findUnique = vi.fn().mockResolvedValue({
    memberOne: { userId: 'user-a' },
    memberTwo: { userId: 'user-b' },
  });
  return {
    findUnique,
    db: { leagueTradeThread: { findUnique } } as unknown as TradeAudienceClient,
  };
}

describe('privateTradeAudience', () => {
  it.each([
    'trade:proposed',
    'trade:countered',
    'trade:declined',
    'trade:withdrawn',
    'trade:expired',
  ])('limits %s to the two teams in the trade', async (eventType) => {
    await expect(privateTradeAudience(client().db, envelope(eventType))).resolves.toEqual(
      new Set(['user-a', 'user-b'])
    );
  });

  it.each([
    'trade:accepted',
    'trade:veto_cast',
    'trade:vetoed',
    'trade:completed',
    'trade:rejected',
  ])('leaves %s league-wide', async (eventType) => {
    const { db, findUnique } = client();
    await expect(privateTradeAudience(db, envelope(eventType))).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('delivers to nobody when the thread no longer exists', async () => {
    const { db, findUnique } = client();
    findUnique.mockResolvedValue(null);
    await expect(privateTradeAudience(db, envelope('trade:proposed'))).resolves.toEqual(new Set());
  });

  it('ignores events that are not trade updates', async () => {
    const { db } = client();
    await expect(
      privateTradeAudience(db, { ...envelope('trade:proposed'), event: 'social:message' })
    ).resolves.toBeNull();
  });
});
