/**
 * How long a No Losers round may wait to be re-scored after an AFL result correction before the
 * scoring job reports it as failed (owner decision 2026-11-15, process map platform-27 and
 * players-data-34). The same 12 hours a round may stall on missing stats.
 */
export const RESULT_CORRECTION_GRACE_HOURS = 12;

/** True once more than the grace period has passed since the correcting result arrived. */
export function correctionIsOverdue(correctedAt: Date, now: Date): boolean {
  return now.getTime() - correctedAt.getTime() > RESULT_CORRECTION_GRACE_HOURS * 60 * 60 * 1000;
}
