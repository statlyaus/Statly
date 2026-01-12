import { fetchApi } from '@/lib/api';

export type TradeStatus =
  | 'PROPOSED'
  | 'EXECUTED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'SUPERSEDED'
  | 'EXPIRED';

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
  executedAt?: string;
  items?: TradeItem[];
};

export type TradeDetails = TradeSummary & {
  items: TradeItem[];
};

export type TradeActionResult = {
  tradeId: string;
  status: TradeStatus;
  createdAt: string;
  executedAt?: string;
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
    executedAt: data.executedAt ? String(data.executedAt) : undefined,
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
    executedAt: trade.executedAt ? String(trade.executedAt) : undefined,
  };
}

export function normalizeTradeDetails(trade: unknown): TradeDetails | null {
  if (!trade || typeof trade !== 'object') return null;
  const raw = trade as Record<string, unknown>;
  const summary = normalizeTradeSummary(raw as TradeSummary);
  return {
    ...summary,
    items: normalizeTradeItems(raw.items),
  };
}
