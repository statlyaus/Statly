// Shared Firebase/Firestore utilities

/**
 * Safely convert a Firestore Timestamp-like value to a JS Date.
 * Accepts Firestore Timestamp (with toDate), JS Date, or null/undefined.
 */
export function firestoreTimestampToDate(
  timestamp: { toDate(): Date } | Date | null | undefined
): Date | null {
  function hasToDate(value: unknown): value is { toDate(): Date } {
    return !!value && typeof (value as { toDate?: unknown }).toDate === 'function';
  }
  // Firestore Timestamp has a toDate method
  if (hasToDate(timestamp)) {
    return timestamp.toDate();
  }
  // Already a Date
  if (timestamp instanceof Date) {
    return timestamp;
  }
  // Invalid/null
  return null;
}

/**
 * Create runtime-safe base64url encoding helper
 */
function base64urlEncode(input: string): string {
  // Use Buffer if available (Node.js environment)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }

  // Fallback for edge runtimes using Web APIs
  if (typeof TextEncoder !== 'undefined') {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input);
    const base64 = btoa(String.fromCharCode(...bytes));
    // Convert to base64url format (replace + with -, / with _, remove padding =)
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  throw new Error('Neither Buffer nor TextEncoder is available for base64url encoding');
}

/**
 * Generate a deterministic member ID for a `(leagueId, userId)` pair.
 *
 * Returns two base64url-encoded UTF-8 strings (leagueId and userId) joined by an underscore
 * (e.g. "<base64url(leagueId)>_<base64url(userId)>"). Characters will be URL-safe (A-Z a-z 0-9 - _).
 * This format is Firestore-safe and deterministic to aid debugging and log inspection.
 *
 * Uses base64url encoding to ensure Firestore-safe, deterministic IDs that
 * prevent duplicates for the same pair and avoid collisions with special chars.
 *
 * Works in both Node.js and edge runtimes with automatic fallback.
 */
export function generateDeterministicMemberId(leagueId: string, userId: string): string {
  // Validate inputs
  if (!leagueId || typeof leagueId !== 'string') {
    throw new Error('leagueId must be a non-empty string');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId must be a non-empty string');
  }

  return `${base64urlEncode(leagueId)}_${base64urlEncode(userId)}`;
}
