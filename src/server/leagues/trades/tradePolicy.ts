import type { LeagueTradeOfferStatus, LeagueTradeThreadStatus } from '@prisma/client';

import { getTradeAcceptancePath } from '@/lib/trades/tradeAcceptancePath';

import type { TradeActionName, TradeReviewModeDto } from './tradeContracts';

export interface AcceptanceTransition {
  threadStatus: LeagueTradeThreadStatus;
  offerStatus: LeagueTradeOfferStatus;
  reviewEndsAt: Date | null;
  shouldFinalize: boolean;
}

/**
 * A trade with a commissioner (the owner or a co-commissioner) on either side goes to a veto vote
 * instead of commissioner review, so no commissioner approves their own trade. Decided when the
 * trade is accepted, so a later change of commissioner cannot strand it.
 */
export function resolveTradeReviewMode(
  reviewMode: TradeReviewModeDto,
  commissionerIsParty: boolean
): TradeReviewModeDto {
  return reviewMode === 'admin' && commissionerIsParty ? 'veto' : reviewMode;
}

/**
 * The vetoes that block a trade: the league setting, capped at the teams able to vote (active
 * members other than the two in the trade) so a veto can always pass. Counted when a veto is cast.
 */
export function effectiveVetoThreshold(setting: number, eligibleVoters: number): number {
  return Math.max(1, Math.min(setting, eligibleVoters));
}

export function determineAcceptanceTransition(
  reviewMode: TradeReviewModeDto,
  acceptedAt: Date,
  reviewHours: number
): AcceptanceTransition {
  const acceptancePath = getTradeAcceptancePath(reviewMode);

  if (acceptancePath.kind === 'immediate') {
    return {
      threadStatus: 'COMPLETED',
      offerStatus: 'COMPLETED',
      reviewEndsAt: null,
      shouldFinalize: true,
    };
  }

  if (acceptancePath.kind === 'commissioner-review') {
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
    if (!isCommissioner) return [];
    // A commissioner never approves their own trade; rejecting it is always allowed.
    return participantMemberIds.includes(actorMemberId) ? ['reject'] : ['approve', 'reject'];
  }

  if (status === 'PENDING_VETO_REVIEW') {
    return participantMemberIds.includes(actorMemberId) ? [] : ['veto'];
  }

  return [];
}

export const BLOODSUCKER_CANNOT_TRADE_MESSAGE = 'The Bloodsucker cannot be part of a trade.';
export const BITTEN_PLAYER_TRADE_BACK_MESSAGE =
  'A player taken in a bite cannot be traded back to the team he was bitten from this season.';

/** BR-31: the Bloodsucker cannot propose, accept or be part of any trade. */
export function isBloodsuckerInTrade(
  participantMemberIds: readonly string[],
  bloodsuckerMemberId: string | null
): boolean {
  return bloodsuckerMemberId !== null && participantMemberIds.includes(bloodsuckerMemberId);
}

/** A player taken in a bite this season and the member he was taken from. */
export interface BittenPlayer {
  playerId: string;
  victimMemberId: string;
}

export function validateTradePlayerSelection(
  sendingPlayerIds: readonly string[],
  receivingPlayerIds: readonly string[],
  bites?: {
    proposerMemberId: string;
    recipientMemberId: string;
    bittenFrom: readonly BittenPlayer[];
  }
): { ok: true } | { ok: false; code: 'INVALID_INPUT' | 'BITTEN_PLAYER_TRADE_BACK'; error: string } {
  if (sendingPlayerIds.length === 0 || receivingPlayerIds.length === 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      error: 'A trade must include at least one player from each team.',
    };
  }

  const sending = new Set(sendingPlayerIds);
  const receiving = new Set(receivingPlayerIds);
  if (sending.size !== sendingPlayerIds.length || receiving.size !== receivingPlayerIds.length) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      error: 'A player can appear only once on each side of a trade.',
    };
  }

  if ([...sending].some((playerId) => receiving.has(playerId))) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      error: 'A player cannot appear on both sides of a trade.',
    };
  }

  // BR-32: a bitten player cannot go back to a member he was bitten from this season. He can go to
  // any other team.
  if (bites) {
    const sendsBack = (playerIds: readonly string[], toMemberId: string) =>
      playerIds.some((playerId) =>
        bites.bittenFrom.some(
          (bite) => bite.playerId === playerId && bite.victimMemberId === toMemberId
        )
      );
    if (
      sendsBack(sendingPlayerIds, bites.recipientMemberId) ||
      sendsBack(receivingPlayerIds, bites.proposerMemberId)
    ) {
      return {
        ok: false,
        code: 'BITTEN_PLAYER_TRADE_BACK',
        error: BITTEN_PLAYER_TRADE_BACK_MESSAGE,
      };
    }
  }

  return { ok: true };
}

function normalizeHours(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 24 * 14) : 24;
}
