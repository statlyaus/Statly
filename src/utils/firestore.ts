// Shared Firebase/Firestore utilities

/**
 * Safely convert a Firestore Timestamp-like value to a JS Date.
 * Accepts Firestore Timestamp (with toDate), JS Date, or null/undefined.
 */
export function firestoreTimestampToDate(
  timestamp:
    | { toDate(): Date }
    | Date
    | null
    | undefined
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
 * Generate a deterministic member ID for a `(leagueId, userId)` pair.
 *
 * Uses base64url encoding to ensure Firestore-safe, deterministic IDs that
 * prevent duplicates for the same pair and avoid collisions with special chars.
 *
 * Note: Relies on Node's `Buffer`; use in routes with `runtime = 'nodejs'` or
 * environments where `Buffer` is available.
 */
export function generateDeterministicMemberId(leagueId: string, userId: string): string {
  return `${Buffer.from(leagueId, 'utf8').toString('base64url')}_${Buffer.from(userId, 'utf8').toString('base64url')}`;
}
