import { useState, useEffect } from "react";

/**
 * A custom hook that debounces a value. This is useful for delaying an
 * action (like an API call) until the user has stopped typing for a specified
 * time.
 *
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearchTerm = useDebounce(searchTerm, 500);
 *
 * useEffect(() => {
 *   if (debouncedSearchTerm) {
 *     // Perform search API call with debouncedSearchTerm
 *   }
 * }, [debouncedSearchTerm]);
 * ```
 *
 * @template T The type of the value to debounce.
 * @param value The value to debounce. Can be of any type.
 * @param delay The debounce delay in milliseconds.
 * @returns The debounced value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    // Set up a timer to update the debounced value after the delay.
    const handler = setTimeout(() => {
      // Use the functional update form of setState. This is safer because it
      // prevents issues if the `value` to be debounced is a function.
      setDebouncedValue(() => value);
    }, delay);

    // Clean up the timer if the value or delay changes before the timer fires.
    return () => clearTimeout(handler);
  }, [value, delay]); // This effect runs only when the value or delay changes.

  return debouncedValue;
}