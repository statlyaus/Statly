import { useEffect, useCallback, type DependencyList } from 'react';

//type DependencyList = readonly any[];

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
  deps: DependencyList = [],
  delay: number = 5000,
  pause: boolean = false
) {
  const memoizedCallback = useCallback(callback, [callback]);

  useEffect(() => {
    if (pause) return;
    const intervalId = setInterval(memoizedCallback, delay);
    return () => clearInterval(intervalId);
  }, [memoizedCallback, delay, pause, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
