// src/lib/api.ts

import type { TradeState, TradeStatus, TradeSummary } from "@/state/tradeReviewStore";

/**
 * A reusable fetch wrapper for making API calls.
 * This function should be exported so it can be used in other files.
 */
export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const url = `/api/${endpoint}`;
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  
  if (!response.ok) {
    type ErrorBody = { error?: string; details?: string; message?: string } | null;
    let errorData: ErrorBody = null;
    try {
      errorData = (await response.json()) as ErrorBody;
    } catch (_parseError) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const detail = errorData?.error || errorData?.details || errorData?.message;
    throw new Error(detail || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  // Check if response has content
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('Expected JSON response but received: ' + contentType);
  }
  
  // Get response text first to check if it's empty
  const responseText = await response.text();
  if (!responseText.trim()) {
    throw new Error('Received empty response from server');
  }
  
  try {
    return JSON.parse(responseText);
  } catch (_parseError) {
    console.error('Failed to parse JSON response:', responseText);
    throw new Error('Invalid JSON response from server');
  }
}

// --- TRADING FUNCTIONS ---

export const fetchTrades = async (): Promise<TradeSummary[]> => {
  const data = await fetchApi('listTrades');
  return data.trades;
};

export const fetchTradeDetails = async (tradeId: string): Promise<{ state: TradeState; auditLog: Array<{ timestamp: number; action: string; details?: unknown }>; notifications: string[] }> => {
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