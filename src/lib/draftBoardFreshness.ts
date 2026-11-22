/** How often the draft room reads persisted picks and the clock back from the database. */
export const PERSISTED_PICK_BACKFILL_INTERVAL_MS = 5000;

export interface DraftBoardConnection {
  status: 'connected' | 'reconnecting' | 'disconnected';
  needsResync?: boolean;
  /** When a persisted baseline (snapshot or pick backfill) was last applied, in ms. */
  lastPersistedSyncAt?: number;
}

/**
 * The board may be out of date when a resync is pending, or when the live socket is down and no
 * database read has landed within two poll intervals. A board kept current by polling is safe to
 * pick from: the server rejects an out-of-turn or taken pick.
 */
export function isDraftBoardStale(
  connection: DraftBoardConnection,
  nowMs: number,
  pollIntervalMs: number
): boolean {
  if (connection.needsResync) return true;
  if (connection.status === 'connected') return false;
  if (connection.lastPersistedSyncAt === undefined) return true;
  return nowMs - connection.lastPersistedSyncAt > 2 * pollIntervalMs;
}
