export interface ApiErrorShape {
  error?: string | { message?: unknown; code?: unknown; details?: unknown };
  message?: string;
  details?: unknown;
}

export function getApiErrorMessage(errorData: unknown, status: number, statusText: string): string {
  const body =
    typeof errorData === 'object' && errorData !== null
      ? (errorData as Record<string, unknown>)
      : {};
  const errorField = body.error;
  const nestedError =
    typeof errorField === 'object' && errorField !== null
      ? (errorField as Record<string, unknown>)
      : undefined;
  const nestedMessage =
    typeof nestedError?.message === 'string'
      ? nestedError.message
      : typeof errorField === 'string'
        ? errorField
        : undefined;
  const topLevelMessage = typeof body.message === 'string' ? body.message : undefined;
  const topLevelDetails = typeof body.details === 'string' ? body.details : undefined;
  const nestedCode = typeof nestedError?.code === 'string' ? nestedError.code : undefined;
  const messages = [
    nestedMessage,
    topLevelMessage !== nestedMessage ? topLevelMessage : undefined,
    topLevelDetails,
    nestedCode ? `code=${nestedCode}` : undefined,
  ].filter((message): message is string => Boolean(message));

  return Array.from(new Set(messages)).join(' - ') || `HTTP ${status}: ${statusText}`;
}

interface FetchJsonInit extends RequestInit {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit, userId?: string) => Promise<Response>;
  userId?: string;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: FetchJsonInit): Promise<T> {
  const { fetcher = fetch, userId, ...requestInit } = init ?? {};
  const response = await fetcher(input, requestInit, userId);
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      message = getApiErrorMessage(await response.json(), response.status, response.statusText);
    } catch {
      // ignore parse error; use default message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

// src/lib/api.ts

import { isDevelopmentAuthEnabled, readStoredDevelopmentAuthUserId } from '@/lib/devAuth';
import type { TradeState, TradeStatus, TradeSummary } from '@/state/tradeReviewStore';

/**
 * A reusable fetch wrapper for making API calls.
 * This function should be exported so it can be used in other files.
 */
export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const base =
    typeof window === 'undefined'
      ? (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '')
      : '';

  // Validate endpoint doesn't contain protocol or path traversal
  if (/^https?:\/\//i.test(endpoint) || endpoint.includes('..')) {
    throw new Error('Invalid endpoint format');
  }
  // Normalize endpoint: allow callers to pass 'users', '/users', 'api/users', or '/api/users'
  const normalized = String(endpoint)
    .replace(/^\/?api\/?/, '')
    .replace(/^\//, '');
  const path = `/api/${normalized}`;
  const url = base ? `${base}${path}` : path;
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('Authorization') && isDevelopmentAuthEnabled()) {
    const developmentUserId = readStoredDevelopmentAuthUserId();
    if (developmentUserId) {
      headers.set('Authorization', `Bearer dev:${developmentUserId}`);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // Accept a variety of error shapes:
    // - { error: string }
    // - { message: string }
    // - { details: string }
    // - { error: { message: string, code?: string } }
    // - { success: false, error: { message, code, details }, timestamp }
    let errorData: unknown = null;
    let responseText = '';
    try {
      responseText = await response.text();
      errorData = responseText.trim() ? JSON.parse(responseText) : null;
    } catch (_parseError) {
      const suffix = responseText.trim() ? ` - ${responseText.trim()}` : '';
      throw new Error(`HTTP ${response.status}: ${response.statusText}${suffix}`);
    }

    throw new Error(getApiErrorMessage(errorData, response.status, response.statusText));
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
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} - Invalid JSON response from server`
    );
  }
}

/**
 * Fetch all pages from a paginated endpoint that accepts `page` and `limit` query params.
 * - Calls the provided URL builder for each page starting at 1
 * - Uses `fetchJson` to perform the request
 * - Uses `extractItems` to pull an array of items from the response
 * - Continues until a page returns fewer than `perPage` items
 *
 * A `maxPages` safeguard prevents infinite loops if the API misbehaves.
 */
export async function fetchAllPages<T>(
  buildUrlForPage: (page: number) => string,
  extractItems: (response: unknown) => T[],
  perPage = 1000,
  maxPages = 100
): Promise<T[]> {
  const aggregated: T[] = [];
  let page = 1;
  while (page <= maxPages) {
    const url = buildUrlForPage(page);
    const data = await fetchJson<unknown>(url);
    const items = extractItems(data) ?? [];
    aggregated.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }
  return aggregated;
}

// --- TRADING FUNCTIONS ---

export const fetchTrades = async (): Promise<TradeSummary[]> => {
  const data = await fetchApi('listTrades');
  return data.trades;
};

export const fetchTradeDetails = async (
  tradeId: string
): Promise<{
  state: TradeState;
  auditLog: Array<{ timestamp: number; action: string; details?: unknown }>;
  notifications: string[];
}> => {
  return fetchApi(`tradeReview?tradeId=${tradeId}`);
};

export const createTrade = async (tradeName: string): Promise<TradeSummary> => {
  return fetchApi('tradeReview', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', tradeName }),
  });
};

export const acceptTrade = (tradeId: string) =>
  fetchApi('tradeReview', {
    method: 'POST',
    body: JSON.stringify({ action: 'accept', tradeId }),
  });

export const vetoTrade = (tradeId: string) =>
  fetchApi('tradeReview', {
    method: 'POST',
    body: JSON.stringify({ action: 'veto', tradeId }),
  });

export const processTrade = (tradeId: string) =>
  fetchApi('tradeReview', {
    method: 'POST',
    body: JSON.stringify({ action: 'process', tradeId }),
  });

export const deleteTrade = (tradeId: string) =>
  fetchApi('tradeReview', {
    method: 'POST',
    body: JSON.stringify({ action: 'reset', tradeId }),
  });

export const archiveTrade = (tradeId: string) =>
  fetchApi('tradeReview', {
    method: 'POST',
    body: JSON.stringify({ action: 'archive', tradeId }),
  });

export const overrideTradeStatus = (tradeId: string, overrideStatus: TradeStatus) =>
  fetchApi('tradeReview', {
    method: 'POST',
    body: JSON.stringify({ action: 'adminOverride', tradeId, overrideStatus }),
  });
