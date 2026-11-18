/**
 * When the live guard re-reads Footywire results (#1290 NFR-3, #1315). Two cadences:
 *
 * - **recent**: in a live window, every RESULTS_REFRESH_MS (10 min), Footywire's last
 *   RESULTS_LAST_MATCHES (18) matches, which covers the latest two rounds, where a new result appears.
 * - **full**: every RESULTS_FULL_SWEEP_MS (6 h), outside live windows only, the whole season. It
 *   reads one Footywire page per match (about 10 minutes for a season) and the guard does nothing
 *   else meanwhile, so it never runs while stats are being fetched. A correction Footywire makes to
 *   an older game is ingested by the next sweep (within about 6 hours, or once a long live window
 *   ends) and then reaches scoring (#1295). A sweep also counts as a recent refresh.
 *
 * Pure, so the schedule is tested without the guard's Firebase start-up.
 */
export type ResultRefreshKind = 'full' | 'recent';

export const RESULTS_REFRESH_MS = Number(process.env.RESULTS_REFRESH_MS) || 10 * 60 * 1000;
export const RESULTS_LAST_MATCHES = Number(process.env.RESULTS_LAST_MATCHES) || 18;
export const RESULTS_FULL_SWEEP_MS =
  Number(process.env.RESULTS_FULL_SWEEP_MS) || 6 * 60 * 60 * 1000;
/** A season sweep runs only while a game started within this window (owner decision 2026-11-15). */
export const RESULTS_SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A full sweep's R pipeline limit; the default 5-minute limit fits only the recent refresh. */
export const RESULTS_FULL_SWEEP_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Whether the 6-hour sweep timer has run out. The guard checks it before asking Firestore whether a
 * game started in the last 7 days, so an off-live pass costs no Firestore read until a sweep could
 * actually be due.
 */
export function fullSweepTimerDue(input: {
  now: number;
  lastFullSweepAt: number;
  fullSweepMs?: number;
}): boolean {
  return input.now - input.lastFullSweepAt >= (input.fullSweepMs ?? RESULTS_FULL_SWEEP_MS);
}

export function dueResultRefresh(input: {
  now: number;
  live: boolean;
  lastRecentAt: number;
  lastFullSweepAt: number;
  /** A game started within RESULTS_SWEEP_WINDOW_MS; off-season and long breaks skip the sweep. */
  gameStartedWithinWindow: boolean;
  refreshMs?: number;
  fullSweepMs?: number;
}): ResultRefreshKind | null {
  const refreshMs = input.refreshMs ?? RESULTS_REFRESH_MS;
  const fullSweepMs = input.fullSweepMs ?? RESULTS_FULL_SWEEP_MS;
  if (!input.live) {
    if (!input.gameStartedWithinWindow) return null;
    return fullSweepTimerDue({ ...input, fullSweepMs }) ? 'full' : null;
  }
  return input.now - input.lastRecentAt >= refreshMs ? 'recent' : null;
}
