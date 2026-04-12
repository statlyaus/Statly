import { fetchApi } from '@/lib/api';

export type TradeStatus =
  | 'PROPOSED'
  | 'REVIEW_PENDING'
  | 'REVIEW_REJECTED'
  | 'EXECUTED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'SUPERSEDED'
  | 'EXPIRED';

export type TradeReviewStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type TradeReviewMode = 'NONE' | 'ADMIN' | 'VETO';

export type TradeItem = {
  playerId: string;
  playerName: string;
  fromUserId: string;
  toUserId: string;
};

export type TradeSummary = {
  tradeId: string;
  proposerUserId: string;
  recipientUserId: string;
  status: TradeStatus;
  createdAt: string;
  acceptedAt?: string;
  executedAt?: string;
  reviewMode?: TradeReviewMode;
  reviewStatus?: TradeReviewStatus;
  reviewRequestedAt?: string;
  reviewWindowEndsAt?: string;
  reviewDecidedAt?: string;
  proposerViewedAt?: string;
  recipientViewedAt?: string;
  latestActivityAt?: string;
  latestActivityEvent?: string | null;
  latestActivityActorUserId?: string | null;
  items?: TradeItem[];
};

export type TradeDetails = TradeSummary & {
  items: TradeItem[];
  reviewVotes?: TradeReviewVote[];
  audit?: TradeAuditEntry[];
};

export type TradeReviewVote = {
  voterUserId: string;
  voteType: 'APPROVE' | 'VETO';
  createdAt: string;
};

export type TradeAuditEntry = {
  event: string;
  actorUserId: string | null;
  createdAt: string;
  errorCode: string | null;
  payloadJson: unknown;
};

export type TradeActionResult = {
  tradeId: string;
  status: TradeStatus;
  createdAt: string;
  acceptedAt?: string;
  executedAt?: string;
  reviewStatus?: TradeReviewStatus;
  reviewWindowEndsAt?: string;
};

type TradeListResponse = {
  data?: {
    trades?: TradeSummary[];
  };
};

type TradeDetailsResponse = {
  data?: TradeDetails;
};

type TradeActionResponse = {
  data?: TradeActionResult;
};

export async function listTrades(leagueId: string): Promise<TradeSummary[]> {
  const response = await fetchApi(`trades?leagueId=${encodeURIComponent(leagueId)}`);
  const list = (response as TradeListResponse)?.data?.trades ?? [];
  return list.map(normalizeTradeSummary);
}

export async function getTrade(tradeId: string): Promise<TradeDetails | null> {
  const response = await fetchApi(`trades/${tradeId}`);
  const trade = (response as TradeDetailsResponse)?.data;
  if (!trade) return null;
  return normalizeTradeDetails(trade);
}

export async function actOnTrade(
  tradeId: string,
  action: 'accept' | 'decline' | 'cancel',
  requestId: string
): Promise<TradeActionResult | null> {
  const response = await fetchApi(`trades/${tradeId}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
  const data = (response as TradeActionResponse)?.data;
  if (!data) return null;
  return {
    ...data,
    createdAt: String(data.createdAt),
    acceptedAt: data.acceptedAt ? String(data.acceptedAt) : undefined,
    executedAt: data.executedAt ? String(data.executedAt) : undefined,
    reviewStatus: data.reviewStatus ? (String(data.reviewStatus) as TradeReviewStatus) : undefined,
    reviewWindowEndsAt: data.reviewWindowEndsAt ? String(data.reviewWindowEndsAt) : undefined,
  };
}

export function normalizeTradeItems(items: unknown): TradeItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const playerId = String(raw.playerId ?? '');
      const fromUserId = String(raw.fromUserId ?? '');
      const toUserId = String(raw.toUserId ?? '');
      const playerName = String(raw.playerName ?? raw.name ?? 'Player');
      if (!playerId || !fromUserId || !toUserId) return null;
      return { playerId, playerName, fromUserId, toUserId };
    })
    .filter((item): item is TradeItem => Boolean(item));
}

export function normalizeTradeSummary(trade: TradeSummary): TradeSummary {
  return {
    ...trade,
    createdAt: String(trade.createdAt),
    acceptedAt: trade.acceptedAt ? String(trade.acceptedAt) : undefined,
    executedAt: trade.executedAt ? String(trade.executedAt) : undefined,
    reviewMode: trade.reviewMode ? (String(trade.reviewMode) as TradeReviewMode) : undefined,
    reviewStatus: trade.reviewStatus
      ? (String(trade.reviewStatus) as TradeReviewStatus)
      : undefined,
    reviewRequestedAt: trade.reviewRequestedAt ? String(trade.reviewRequestedAt) : undefined,
    reviewWindowEndsAt: trade.reviewWindowEndsAt ? String(trade.reviewWindowEndsAt) : undefined,
    reviewDecidedAt: trade.reviewDecidedAt ? String(trade.reviewDecidedAt) : undefined,
    proposerViewedAt: trade.proposerViewedAt ? String(trade.proposerViewedAt) : undefined,
    recipientViewedAt: trade.recipientViewedAt ? String(trade.recipientViewedAt) : undefined,
    latestActivityAt: trade.latestActivityAt ? String(trade.latestActivityAt) : undefined,
    latestActivityEvent:
      typeof trade.latestActivityEvent === 'string' ? trade.latestActivityEvent : null,
    latestActivityActorUserId:
      typeof trade.latestActivityActorUserId === 'string' ? trade.latestActivityActorUserId : null,
  };
}

export function normalizeTradeDetails(trade: unknown): TradeDetails | null {
  if (!trade || typeof trade !== 'object') return null;
  const raw = trade as Record<string, unknown>;
  const summary = normalizeTradeSummary(raw as TradeSummary);
  const audit = Array.isArray(raw.audit)
    ? raw.audit
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const value = entry as Record<string, unknown>;
          const event = String(value.event ?? '');
          const createdAt = String(value.createdAt ?? '');
          if (!event || !createdAt) return null;
          return {
            event,
            createdAt,
            actorUserId: typeof value.actorUserId === 'string' ? value.actorUserId : null,
            errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
            payloadJson: value.payloadJson,
          } satisfies TradeAuditEntry;
        })
        .filter((entry): entry is TradeAuditEntry => Boolean(entry))
    : undefined;
  const reviewVotes = Array.isArray(raw.reviewVotes)
    ? raw.reviewVotes
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const value = entry as Record<string, unknown>;
          const voterUserId = String(value.voterUserId ?? '');
          const voteType = String(value.voteType ?? '') as 'APPROVE' | 'VETO';
          const createdAt = String(value.createdAt ?? '');
          if (!voterUserId || !createdAt || (voteType !== 'APPROVE' && voteType !== 'VETO')) {
            return null;
          }
          return { voterUserId, voteType, createdAt } satisfies TradeReviewVote;
        })
        .filter((entry): entry is TradeReviewVote => Boolean(entry))
    : undefined;
  return {
    ...summary,
    items: normalizeTradeItems(raw.items),
    reviewVotes,
    audit,
  };
}
