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
