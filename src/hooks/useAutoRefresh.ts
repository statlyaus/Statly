import { useEffect, useRef, type DependencyList } from 'react';

/**
 * useAutoRefresh hook
 * @param callback - Function to be called on each interval.
 * @param deps - Dependency array, defaults to [].
 * @param delay - Interval delay in milliseconds, defaults to 5000.
 * @param pause - Whether to pause the interval, defaults to false.
 */
export function useAutoRefresh(
  callback: () => void,
  deps: DependencyList = [],
  delay = 5000,
  pause = false
) {
  const savedCallback = useRef(callback);

  // Save the latest callback function to a ref.
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (pause) return;

    const tick = () => savedCallback.current();

    const intervalId = setInterval(tick, delay);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, pause, ...deps]); // Spread deps to keep the interval in sync with individual dependency values.
}
