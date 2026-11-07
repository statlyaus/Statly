import { authenticatedFetch } from '@/lib/authenticatedFetch';

/**
 * Calls a basketball league API route and reports what the server confirmed. Never throws: a
 * network failure or an error body comes back as `{ ok: false, message }` for the UI to show.
 */
export async function sendBasketballCommand(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  userId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await authenticatedFetch(
      url,
      { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      userId
    );
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      error?: { message?: string };
    } | null;
    if (response.ok && payload?.success) return { ok: true };
    return {
      ok: false,
      message: payload?.error?.message ?? `The server answered ${response.status}.`,
    };
  } catch {
    return { ok: false, message: 'Could not reach Statly. Check your connection and try again.' };
  }
}
