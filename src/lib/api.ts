export interface ApiErrorShape {
  error?: string;
  message?: string;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as ApiErrorShape;
      if (typeof body?.error === 'string') message = body.error;
      else if (typeof body?.message === 'string') message = body.message;
    } catch {
      // ignore parse error; use default message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

// src/lib/api.ts

import type { TradeState, TradeStatus, TradeSummary } from '@/state/tradeReviewStore';

/**
 * A reusable fetch wrapper for making API calls.
 * This function should be exported so it can be used in other files.
 */
async function maybeAttachAuthHeader(
  headers: Record<string, string>
): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return headers;
  if (headers.Authorization || headers.authorization) return headers;
  try {
    // Avoid importing client SDK on the server; only in browser.
    const { getApps, getApp } = require('firebase/app') as typeof import('firebase/app');
    const { getAuth } = require('firebase/auth') as typeof import('firebase/auth');
    const app = getApps().length ? getApp() : null;
    if (!app) return headers;
    const auth = getAuth(app);
    const user = auth.currentUser;
    if (!user) return headers;
    const token = await user.getIdToken();
    if (!token) return headers;
    return { ...headers, Authorization: `Bearer ${token}` };
  } catch {
    return headers;
  }
}

function normalizeApiPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return clean.startsWith('/api/') ? clean : `/api${clean}`;
}

function buildApiUrl(path: string): string {
  const normalized = normalizeApiPath(path);

  // In the browser, always call relative /api/... to avoid port/CORS mismatch
  if (typeof window !== 'undefined') {
    return normalized;
  }

  // On the server, allow an absolute base URL if provided; otherwise stay relative
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}${normalized}` : normalized;
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  // Validate endpoint doesn't contain protocol or path traversal
  if (/^https?:\/\//i.test(endpoint) || endpoint.includes('..')) {
    throw new Error('Invalid endpoint format');
  }
  // Normalize endpoint: allow callers to pass 'users', '/users', 'api/users', or '/api/users'
  const url = buildApiUrl(endpoint);

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  const headers = await maybeAttachAuthHeader(baseHeaders);
  const { headers: _ignoredHeaders, credentials: optionCredentials, ...rest } = options;
  const credentials = optionCredentials ?? 'include';

  const response = await fetch(url, {
    ...rest,
    credentials,
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
    try {
      errorData = await response.json();
    } catch (_parseError) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const messages: string[] = [];
    const body = (errorData ?? {}) as Record<string, unknown>;
    const topLevelMessage = typeof body.message === 'string' ? body.message : undefined;
    const topLevelDetails = typeof body.details === 'string' ? body.details : undefined;
    const errorField = body.error as unknown;
    const nestedMessage =
      typeof errorField === 'object' &&
      errorField !== null &&
      typeof (errorField as any).message === 'string'
        ? String((errorField as any).message)
        : typeof errorField === 'string'
          ? errorField
          : undefined;
    const nestedCode =
      typeof errorField === 'object' &&
      errorField !== null &&
      typeof (errorField as any).code === 'string'
        ? String((errorField as any).code)
        : undefined;

    if (nestedMessage) messages.push(nestedMessage);
    if (topLevelMessage && topLevelMessage !== nestedMessage) messages.push(topLevelMessage);
    if (topLevelDetails) messages.push(topLevelDetails);
    if (nestedCode) messages.push(`code=${nestedCode}`);

    // Always include HTTP status and dedupe message parts
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    const parts = [status, ...Array.from(new Set(messages))];
    throw new Error(parts.join(' - '));
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
    const debug = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEBUG_API === '1';
    if (debug) {
      console.error(
        'Failed to parse JSON response (truncated):',
        responseText.slice(0, 1000)
      );
    }
    throw new Error('Invalid JSON response from server');
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
