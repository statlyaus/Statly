// src/lib/api.ts

import type { TradeState, TradeStatus, TradeSummary } from "@/state/tradeReviewStore";

/**
 * A reusable fetch wrapper for making API calls.
 * This function should be exported so it can be used in other files.
 */
export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`/api/${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'API request failed');
  }
  return response.json();
}

// --- TRADING FUNCTIONS ---

export const fetchTrades = async (): Promise<TradeSummary[]> => {
  const data = await fetchApi('listTrades');
  return data.trades;
};

export const fetchTradeDetails = async (tradeId: string): Promise<{ state: TradeState; auditLog: any[]; notifications: string[] }> => {
    return fetchApi(`tradeReview?tradeId=${tradeId}`);
};

export const createTrade = async (tradeName: string): Promise<TradeSummary> => {
    return fetchApi('tradeReview', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', tradeName }),
    });
};

export const acceptTrade = (tradeId: string) => fetchApi('tradeReview', {
  method: 'POST',
  body: JSON.stringify({ action: 'accept', tradeId }),
});

export const vetoTrade = (tradeId: string) => fetchApi('tradeReview', {
  method: 'POST',
  body: JSON.stringify({ action: 'veto', tradeId }),
});

export const processTrade = (tradeId: string) => fetchApi('tradeReview', {
  method: 'POST',
  body: JSON.stringify({ action: 'process', tradeId }),
});

export const deleteTrade = (tradeId: string) => fetchApi('tradeReview', {
  method: 'POST',
  body: JSON.stringify({ action: 'reset', tradeId }),
});

export const archiveTrade = (tradeId: string) => fetchApi('tradeReview', {
  method: 'POST',
  body: JSON.stringify({ action: 'archive', tradeId }),
});

export const overrideTradeStatus = (tradeId: string, overrideStatus: TradeStatus) => fetchApi('tradeReview', {
  method: 'POST',
  body: JSON.stringify({ action: 'adminOverride', tradeId, overrideStatus }),
});