/**
 * Utility functions for handling common error scenarios
 */

/**
 * Checks if an error is related to network connectivity issues
 * @param error - The error to check
 * @returns true if the error indicates a connectivity problem
 */
export function isConnectivityError(error: Error): boolean {
  return error.message.includes('Failed to fetch');
}

/**
 * Returns a standard error message for connectivity issues
 * @returns A user-friendly error message for connectivity problems
 */
export function getConnectivityErrorMessage(): string {
  return 'Unable to connect to server. Please ensure the development server is running.';
}

/**
 * Checks if an error is a 404 error for test leagues (expected behavior)
 * @param error - The error to check
 * @param leagueId - The league ID to check if it's a test league
 * @returns true if this is an expected 404 for a test league
 */
export function isExpectedTestLeague404(error: Error, leagueId: string): boolean {
  return error.message.includes('404') && leagueId.includes('test');
}
