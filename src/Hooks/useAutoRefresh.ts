import { useEffect } from "react";

/**
 * useAutoRefresh hook
 * @param callback - Function to be called on each interval. 
 *   It is recommended to memoize this function (e.g., with useCallback) to avoid unnecessary interval resets.
 * @param deps - Dependency array, defaults to [].
 * @param delay - Interval delay in milliseconds, defaults to 5000.
 * @param pause - Whether to pause the interval, defaults to false.
 */
export function useAutoRefresh(
  callback: () => void,
  deps: any[] = [],
  delay: number = 5000,
  pause: boolean = false
) {
  useEffect(() => {
    if (pause) return;
    const interval = setInterval(callback, delay);
    return () => clearInterval(interval);
  }, [pause, delay, ...deps]);
}