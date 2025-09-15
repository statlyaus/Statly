// Lightweight adapter for Firebase Data Connect SDK usage.
// Tries to detect whether generated SDK is present and expose helpers.

export async function dcAvailable(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@/lib/dataconnect/generated');
    return true;
  } catch {
    return false;
  }
}

export type DCListResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Placeholder. After generating operations, map to the correct function here.
export async function listLivePlayerStatsDC(): Promise<DCListResult<unknown[]>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@/lib/dataconnect/generated');
    // Replace 'listLivePlayerStats' with your generated operation function name
    const fn = (mod as any).listLivePlayerStats ?? (mod as any).ListLivePlayerStats;
    if (typeof fn !== 'function') {
      return { ok: false, error: 'Data Connect SDK present but operation listLivePlayerStats is not found. Update dataConnectClient.ts.' };
    }
    const res = await fn();
    const data = Array.isArray(res?.data) ? res.data : res;
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown Data Connect error' };
  }
}

