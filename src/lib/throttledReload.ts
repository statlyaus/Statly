/**
 * Utility for throttled page reloads to prevent reload loops
 * @param key - Unique identifier for this reload operation
 * @param thresholdMs - Minimum time between reloads (default: 5000ms)
 */
export function throttledReload(key: string, thresholdMs: number = 5000): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return;
  }

  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(key) || '0');
    
    if (now - last > thresholdMs) {
      sessionStorage.setItem(key, String(now));
      window.location.reload();
    }
  } catch {
    // Fallback to immediate reload if sessionStorage fails
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }
}
