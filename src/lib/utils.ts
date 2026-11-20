import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the theme's custom radius (src/index.css `--radius-cut`), so a caller's
// `rounded-none` replaces a recipe's `rounded-cut` instead of both being kept.
const twMerge = extendTailwindMerge({ extend: { theme: { radius: ['cut'] } } });

/** Joins class names and drops earlier Tailwind classes that a later one overrides. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Capitalizes the first letter of each word in a string.
 * @param str The input string.
 * @returns The capitalized string.
 */
export function capitalizeWords(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Capitalizes the first letter of a string and makes the rest lowercase.
 * @param str The input string.
 * @returns The formatted string.
 */
export function capitalizeFirstLetter(str: string | null | undefined): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Type guard for fetch AbortError instances from AbortController.
 * Returns true if the error is an Error with name === 'AbortError'.
 */
export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}
