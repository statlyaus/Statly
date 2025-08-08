import { useState, useEffect } from "react";

/**
 * A custom hook that debounces a value. This is useful for delaying an action
 * (like an API call) until the user has stopped typing for a specified time.
 * @param value The value to debounce.
 * @param delay The debounce delay in milliseconds.
 * @returns The debounced value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    // Set up a timer to update the debounced value after the delay.
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Clean up the timer if the value or delay changes before the timer fires.
    return () => clearTimeout(handler);
  }, [value, delay]); // This effect runs only when the value or delay changes.

  return debouncedValue;
}