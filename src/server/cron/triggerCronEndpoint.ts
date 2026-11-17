// Calls a protected cron API route from a hosting scheduler (see netlify/functions/cron-*.mts).
// Kept free of `@/` imports so Netlify's function bundler can include it by relative path.

import { isTradesOnlyMode } from '../../lib/tradesOnlyMode';

export interface TriggerCronEndpointOptions {
  baseUrl: string | undefined;
  secret: string | undefined;
  fetchImpl?: typeof fetch;
}

/**
 * Returns the route's status, or `null` when the call is skipped. Trades-only mode answers every
 * cron route with a 404, so calling them only spends hosting credits: each run returns at once.
 */
export async function triggerCronEndpoint(
  path: string,
  { baseUrl, secret, fetchImpl = fetch }: TriggerCronEndpointOptions
): Promise<number | null> {
  if (isTradesOnlyMode({ STATLY_TRADES_ONLY: process.env.STATLY_TRADES_ONLY })) return null;

  const token = secret?.trim();
  if (!token) {
    throw new Error(`[cron] CRON_SECRET is not set; refusing to call ${path}`);
  }
  if (!baseUrl) {
    throw new Error(`[cron] Site URL is not set; cannot call ${path}`);
  }

  const response = await fetchImpl(new URL(path, baseUrl), {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`[cron] ${path} responded with ${response.status}`);
  }
  return response.status;
}
