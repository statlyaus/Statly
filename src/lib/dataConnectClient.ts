// Lightweight adapter for Firebase Data Connect SDK usage.
// Tries to detect whether generated SDK is present and expose helpers.

export async function dcAvailable(): Promise<boolean> {
  try {
     
    const mod = require('@/lib/dataconnect/generated');
    const resolved = mod?.default ?? mod;
    if (resolved?.__STATLY_DC_PLACEHOLDER__) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type DCListResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Placeholder. After generating operations, map to the correct function here.
export async function listLivePlayerStatsDC(): Promise<DCListResult<unknown[]>> {
  try {
     
    const mod = require('@/lib/dataconnect/generated');
    const resolved = (mod?.default ?? mod) as any;
    if (resolved?.__STATLY_DC_PLACEHOLDER__) {
      return {
        ok: false,
        error: 'Data Connect is not configured. This feature is optional and the app will use standard Firestore queries instead.',
      };
    }
    // Use the generated operation function
    const fn = resolved.listLivePlayerStats ?? resolved.ListLivePlayerStats;
    if (typeof fn !== 'function') {
      return { 
        ok: false, 
        error: 'Data Connect SDK is present but the operation is not available. This feature will fall back to standard queries.' 
      };
    }
    const res = await fn();
    const data = Array.isArray(res?.data) ? res.data : res;
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown Data Connect error' };
  }
}
