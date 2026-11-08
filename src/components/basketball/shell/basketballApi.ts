import { authenticatedFetch } from '@/lib/authenticatedFetch';

/**
 * Calls a basketball leagues API route and reads its `{ success, data | error }` envelope. A failure
 * carries the API's message and its per-field errors (`rosterSlots.PG`, `entries.2.playerId`), so
 * forms can show each one next to its field. Success is only ever what the server confirmed.
 */

export type BasketballApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      message: string;
      formErrors: string[];
      fieldErrors: Record<string, string[]>;
    };

interface ErrorBody {
  error?: {
    message?: string;
    details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
  };
}

export async function callBasketballApi<T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<BasketballApiResult<T>> {
  let response: Response;
  try {
    response = await authenticatedFetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Could not reach Statly. Check your connection and try again.',
      formErrors: [],
      fieldErrors: {},
    };
  }

  const payload = (await response.json().catch(() => null)) as ({ data?: T } & ErrorBody) | null;
  if (response.ok && payload && 'data' in payload) return { ok: true, data: payload.data as T };
  return {
    ok: false,
    status: response.status,
    message:
      payload?.error?.message ??
      (response.status === 401 ? 'Sign in again to continue.' : 'Something went wrong. Try again.'),
    formErrors: payload?.error?.details?.formErrors ?? [],
    fieldErrors: payload?.error?.details?.fieldErrors ?? {},
  };
}
