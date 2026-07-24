import { z } from 'zod';

import type { TradeReviewMode } from '@/lib/trades/tradeAcceptancePath';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

export const TRADE_VIEWS = ['inbox', 'sent', 'history', 'review'] as const;
export type TradeView = (typeof TRADE_VIEWS)[number];

export type TradeReviewModeDto = TradeReviewMode;
export type TradeThreadStatusDto =
  | 'PENDING'
  | 'ACCEPTED_PENDING_REVIEW'
  | 'COMPLETED'
  | 'DECLINED'
  | 'WITHDRAWN'
  | 'COMMISSIONER_REJECTED'
  | 'VETOED'
  | 'EXPIRED'
  | 'FAILED';
export type TradeOfferStatusDto = TradeThreadStatusDto | 'COUNTERED';

export interface TradeRulesDto {
  limit: number;
  reviewMode: TradeReviewModeDto;
  deadline: string | null;
  offerExpiryHours: number;
  reviewHours: number;
  vetoThreshold: number;
}

export interface TradePlayerDto {
  id: string;
  name: string;
  club: string;
  position: string;
}

export interface TradeTeamDto {
  memberId: string;
  teamName: string;
  teamLogoUrl: string | null;
  isViewer: boolean;
  players: TradePlayerDto[];
}

export interface TradeOfferPlayerDto extends TradePlayerDto {
  fromMemberId: string;
  toMemberId: string;
}

export interface TradeOfferDto {
  id: string;
  sequence: number;
  proposerMemberId: string;
  recipientMemberId: string;
  status: TradeOfferStatusDto;
  message: string | null;
  expiresAt: string;
  reviewMode: TradeReviewModeDto;
  reviewEndsAt: string | null;
  vetoThreshold: number;
  vetoCount: number;
  players: TradeOfferPlayerDto[];
  createdAt: string;
  updatedAt: string;
}

export interface TradeEventDto {
  id: string;
  type: string;
  actorMemberId: string | null;
  previousStatus: string | null;
  nextStatus: string;
  reasonCode: string | null;
  reason: string | null;
  createdAt: string;
}

export interface LeagueTradeDto {
  id: string;
  status: TradeThreadStatusDto;
  version: number;
  memberOne: Pick<TradeTeamDto, 'memberId' | 'teamName' | 'teamLogoUrl'>;
  memberTwo: Pick<TradeTeamDto, 'memberId' | 'teamName' | 'teamLogoUrl'>;
  currentOffer: TradeOfferDto;
  offerHistory: TradeOfferDto[];
  events: TradeEventDto[];
  completedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  allowedActions: TradeActionName[];
}

export interface LeagueTradeCentreSnapshot {
  leagueId: string;
  viewerMemberId: string;
  isCommissioner: boolean;
  rules: TradeRulesDto;
  playerStats: LeaguePlayerStatDatasetDto;
  teams: TradeTeamDto[];
  trades: LeagueTradeDto[];
  counts: Record<TradeView, number>;
  activeView: TradeView;
  nextCursor: string | null;
}

export interface LeagueTradeDigest {
  actionRequired: number;
  pending: number;
  recent: Array<{
    id: string;
    status: TradeThreadStatusDto;
    teamNames: [string, string];
    playerNames: string[];
    updatedAt: string;
  }>;
}

const idSchema = z.string().trim().min(1).max(128);
const playerIdsSchema = z
  .array(idSchema)
  .min(1)
  .max(30)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Players must not be duplicated.' });
    }
  });
const idempotencyKeySchema = z.string().trim().min(8).max(128);

export const createTradeSchema = z
  .object({
    recipientMemberId: idSchema,
    sendingPlayerIds: playerIdsSchema,
    receivingPlayerIds: playerIdsSchema,
    message: z.string().trim().max(1000).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const versionedCommandSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
});

export const tradeActionSchema = z.discriminatedUnion('action', [
  versionedCommandSchema.extend({ action: z.literal('accept') }).strict(),
  versionedCommandSchema.extend({ action: z.literal('decline') }).strict(),
  versionedCommandSchema.extend({ action: z.literal('withdraw') }).strict(),
  versionedCommandSchema.extend({ action: z.literal('approve') }).strict(),
  versionedCommandSchema
    .extend({ action: z.literal('reject'), reason: z.string().trim().min(1).max(500) })
    .strict(),
  versionedCommandSchema.extend({ action: z.literal('veto') }).strict(),
  versionedCommandSchema
    .extend({
      action: z.literal('counter'),
      sendingPlayerIds: playerIdsSchema,
      receivingPlayerIds: playerIdsSchema,
      message: z.string().trim().max(1000).optional(),
    })
    .strict(),
]);

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type TradeActionInput = z.infer<typeof tradeActionSchema>;
export type TradeActionName = TradeActionInput['action'];

export type TradeServiceErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_STATE'
  | 'STALE_VERSION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'TRADE_DEADLINE_PASSED'
  | 'TRADE_LIMIT_REACHED'
  | 'ROSTER_CHANGED'
  | 'ROSTER_LIMIT_EXCEEDED';

export class TradeServiceError extends Error {
  constructor(
    public readonly code: TradeServiceErrorCode,
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 = 400
  ) {
    super(message);
    this.name = 'TradeServiceError';
  }
}
