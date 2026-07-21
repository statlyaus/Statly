import { describe, expect, it } from 'vitest';

import {
  determineAcceptanceTransition,
  getAllowedTradeActions,
  validateTradePlayerSelection,
} from './tradePolicy';

describe('league trade policy', () => {
  const acceptedAt = new Date('2026-07-21T12:00:00.000Z');

  it('completes accepted offers immediately when review is disabled', () => {
    expect(determineAcceptanceTransition('none', acceptedAt, 24)).toEqual({
      threadStatus: 'COMPLETED',
      offerStatus: 'COMPLETED',
      reviewEndsAt: null,
      shouldFinalize: true,
    });
  });

  it('routes accepted offers through commissioner review', () => {
    expect(determineAcceptanceTransition('admin', acceptedAt, 24)).toEqual({
      threadStatus: 'PENDING_ADMIN_REVIEW',
      offerStatus: 'ACCEPTED',
      reviewEndsAt: null,
      shouldFinalize: false,
    });
  });

  it('opens a bounded veto window', () => {
    expect(determineAcceptanceTransition('veto', acceptedAt, 36)).toEqual({
      threadStatus: 'PENDING_VETO_REVIEW',
      offerStatus: 'ACCEPTED',
      reviewEndsAt: new Date('2026-07-23T00:00:00.000Z'),
      shouldFinalize: false,
    });
  });

  it('derives actions from the actor and current lifecycle state', () => {
    const common = {
      status: 'OPEN' as const,
      proposerMemberId: 'member-a',
      recipientMemberId: 'member-b',
      participantMemberIds: ['member-a', 'member-b'] as const,
    };

    expect(
      getAllowedTradeActions({ ...common, actorMemberId: 'member-a', isCommissioner: false })
    ).toEqual(['withdraw']);
    expect(
      getAllowedTradeActions({ ...common, actorMemberId: 'member-b', isCommissioner: false })
    ).toEqual(['accept', 'decline', 'counter']);
    expect(
      getAllowedTradeActions({
        ...common,
        status: 'PENDING_ADMIN_REVIEW',
        actorMemberId: 'commissioner',
        isCommissioner: true,
      })
    ).toEqual(['approve', 'reject']);
    expect(
      getAllowedTradeActions({
        ...common,
        status: 'PENDING_VETO_REVIEW',
        actorMemberId: 'member-c',
        isCommissioner: false,
      })
    ).toEqual(['veto']);
    expect(
      getAllowedTradeActions({
        ...common,
        status: 'PENDING_VETO_REVIEW',
        actorMemberId: 'member-a',
        isCommissioner: false,
      })
    ).toEqual([]);
  });

  it('rejects empty, duplicated, or cross-listed player selections', () => {
    expect(validateTradePlayerSelection(['a'], ['b'])).toEqual({ ok: true });
    expect(validateTradePlayerSelection([], ['b'])).toMatchObject({ ok: false });
    expect(validateTradePlayerSelection(['a', 'a'], ['b'])).toMatchObject({ ok: false });
    expect(validateTradePlayerSelection(['a'], ['a'])).toMatchObject({ ok: false });
  });
});
