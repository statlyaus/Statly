// Shared Firebase/Firestore utilities

/**
 * Safely convert a Firestore Timestamp-like value to a JS Date.
 * Accepts Firestore Timestamp (with toDate), JS Date, or null/undefined.
 */
export function firestoreTimestampToDate(
  v: { toDate?: () => Date } | Date | null | undefined
): Date | undefined {
  if (!v) return undefined;
  // Firestore Timestamp has a toDate method
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return undefined;
    }
  }
  // Already a JS Date
  if (v instanceof Date) return v;
  return undefined;
}
