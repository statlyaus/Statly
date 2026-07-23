import type { LeagueTradeOfferStatus, LeagueTradeThreadStatus } from '@prisma/client';

import type { TradeActionName, TradeReviewModeDto } from './tradeContracts';

export interface AcceptanceTransition {
  threadStatus: LeagueTradeThreadStatus;
  offerStatus: LeagueTradeOfferStatus;
  reviewEndsAt: Date | null;
  shouldFinalize: boolean;
}

export function determineAcceptanceTransition(
  reviewMode: TradeReviewModeDto,
  acceptedAt: Date,
  reviewHours: number
): AcceptanceTransition {
  if (reviewMode === 'none') {
    return {
      threadStatus: 'COMPLETED',
      offerStatus: 'COMPLETED',
      reviewEndsAt: null,
      shouldFinalize: true,
    };
  }

  if (reviewMode === 'admin') {
    return {
      threadStatus: 'PENDING_ADMIN_REVIEW',
      offerStatus: 'ACCEPTED',
      reviewEndsAt: null,
      shouldFinalize: false,
    };
  }

  return {
    threadStatus: 'PENDING_VETO_REVIEW',
    offerStatus: 'ACCEPTED',
    reviewEndsAt: new Date(acceptedAt.getTime() + normalizeHours(reviewHours) * 60 * 60 * 1000),
    shouldFinalize: false,
  };
}

export function getAllowedTradeActions({
  status,
  proposerMemberId,
  recipientMemberId,
  participantMemberIds,
  actorMemberId,
  isCommissioner,
}: {
  status: LeagueTradeThreadStatus;
  proposerMemberId: string;
  recipientMemberId: string;
  participantMemberIds: readonly string[];
  actorMemberId: string;
  isCommissioner: boolean;
}): TradeActionName[] {
  if (status === 'OPEN') {
    if (actorMemberId === proposerMemberId) return ['withdraw'];
    if (actorMemberId === recipientMemberId) return ['accept', 'decline', 'counter'];
    return [];
  }

  if (status === 'PENDING_ADMIN_REVIEW') {
    return isCommissioner ? ['approve', 'reject'] : [];
  }

  if (status === 'PENDING_VETO_REVIEW') {
    return participantMemberIds.includes(actorMemberId) ? [] : ['veto'];
  }

  return [];
}

export function validateTradePlayerSelection(
  sendingPlayerIds: readonly string[],
  receivingPlayerIds: readonly string[]
): { ok: true } | { ok: false; error: string } {
  if (sendingPlayerIds.length === 0 || receivingPlayerIds.length === 0) {
    return { ok: false, error: 'A trade must include at least one player from each team.' };
  }

  const sending = new Set(sendingPlayerIds);
  const receiving = new Set(receivingPlayerIds);
  if (sending.size !== sendingPlayerIds.length || receiving.size !== receivingPlayerIds.length) {
    return { ok: false, error: 'A player can appear only once on each side of a trade.' };
  }

  if ([...sending].some((playerId) => receiving.has(playerId))) {
    return { ok: false, error: 'A player cannot appear on both sides of a trade.' };
  }

  return { ok: true };
}

function normalizeHours(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 24 * 14) : 24;
}
