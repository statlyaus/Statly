import { describe, expect, it } from 'vitest';

import {
  determineAcceptanceTransition,
  effectiveVetoThreshold,
  getAllowedTradeActions,
  isBloodsuckerInTrade,
  resolveTradeReviewMode,
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

  it("sends a commissioner's own trade to a veto vote instead of commissioner review", () => {
    expect(resolveTradeReviewMode('admin', true)).toBe('veto');
    expect(resolveTradeReviewMode('admin', false)).toBe('admin');
    expect(resolveTradeReviewMode('none', true)).toBe('none');
    expect(resolveTradeReviewMode('veto', true)).toBe('veto');
  });

  it('lets a commissioner in the trade reject it but never approve it', () => {
    expect(
      getAllowedTradeActions({
        status: 'PENDING_ADMIN_REVIEW',
        proposerMemberId: 'member-a',
        recipientMemberId: 'member-b',
        participantMemberIds: ['member-a', 'member-b'],
        actorMemberId: 'member-a',
        isCommissioner: true,
      })
    ).toEqual(['reject']);
  });

  it('caps the veto threshold at the teams able to vote', () => {
    expect(effectiveVetoThreshold(5, 2)).toBe(2);
    expect(effectiveVetoThreshold(2, 6)).toBe(2);
    expect(effectiveVetoThreshold(3, 0)).toBe(1);
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

  describe('Bloodsucker trade rules (#1285)', () => {
    it('finds the Bloodsucker on either side of a trade (BR-31)', () => {
      expect(isBloodsuckerInTrade(['a', 'bs'], 'bs')).toBe(true);
      expect(isBloodsuckerInTrade(['bs', 'a'], 'bs')).toBe(true);
      expect(isBloodsuckerInTrade(['a', 'b'], 'bs')).toBe(false);
      expect(isBloodsuckerInTrade(['a', 'b'], null)).toBe(false);
    });

    const bittenFrom = [{ playerId: 'bitten', victimMemberId: 'victim' }];

    it('refuses a trade that sends a bitten player back to his old team (BR-32)', () => {
      // The third team sends the bitten player to the victim.
      expect(
        validateTradePlayerSelection(['bitten'], ['v1'], {
          proposerMemberId: 'third',
          recipientMemberId: 'victim',
          bittenFrom,
        })
      ).toMatchObject({ ok: false, code: 'BITTEN_PLAYER_TRADE_BACK' });
      // The victim asks for him back.
      expect(
        validateTradePlayerSelection(['v1'], ['bitten'], {
          proposerMemberId: 'victim',
          recipientMemberId: 'third',
          bittenFrom,
        })
      ).toMatchObject({ ok: false, code: 'BITTEN_PLAYER_TRADE_BACK' });
    });

    it('allows the bitten player to go to any other team', () => {
      expect(
        validateTradePlayerSelection(['bitten'], ['o1'], {
          proposerMemberId: 'third',
          recipientMemberId: 'owner',
          bittenFrom,
        })
      ).toEqual({ ok: true });
      // The victim's own players still move freely.
      expect(
        validateTradePlayerSelection(['v1'], ['t1'], {
          proposerMemberId: 'victim',
          recipientMemberId: 'third',
          bittenFrom,
        })
      ).toEqual({ ok: true });
    });
  });
});
