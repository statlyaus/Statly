/**
 * When the live guard re-reads Footywire results (#1290 NFR-3, #1315). Two cadences:
 *
 * - **recent**: in a live window, every RESULTS_REFRESH_MS (10 min), Footywire's last
 *   RESULTS_LAST_MATCHES (18) matches, which covers the latest two rounds, where a new result appears.
 * - **full**: every RESULTS_FULL_SWEEP_MS (6 h), live window or not, the whole season. A correction
 *   Footywire makes to an older game is ingested by the next sweep, so it reaches scoring (#1295)
 *   within about 6 hours. A sweep also counts as a recent refresh.
 *
 * Pure, so the schedule is tested without the guard's Firebase start-up.
 */
export type ResultRefreshKind = 'full' | 'recent';

export const RESULTS_REFRESH_MS = Number(process.env.RESULTS_REFRESH_MS) || 10 * 60 * 1000;
export const RESULTS_LAST_MATCHES = Number(process.env.RESULTS_LAST_MATCHES) || 18;
export const RESULTS_FULL_SWEEP_MS =
  Number(process.env.RESULTS_FULL_SWEEP_MS) || 6 * 60 * 60 * 1000;

export function dueResultRefresh(input: {
  now: number;
  live: boolean;
  lastRecentAt: number;
  lastFullSweepAt: number;
  refreshMs?: number;
  fullSweepMs?: number;
}): ResultRefreshKind | null {
  const refreshMs = input.refreshMs ?? RESULTS_REFRESH_MS;
  const fullSweepMs = input.fullSweepMs ?? RESULTS_FULL_SWEEP_MS;
  if (input.now - input.lastFullSweepAt >= fullSweepMs) return 'full';
  if (input.live && input.now - input.lastRecentAt >= refreshMs) return 'recent';
  return null;
}
