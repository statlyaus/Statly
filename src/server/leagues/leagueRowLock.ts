import type { Prisma } from '@prisma/client';

/**
 * Locks the League row until the transaction ends. Writers that must not interleave with a draft
 * start (the settings save, the draft start itself) take it first, so each sees the other's commit.
 */
export async function lockLeagueRow(tx: Prisma.TransactionClient, leagueId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "League" WHERE id = ${leagueId} FOR UPDATE`;
}

/**
 * Round scoring holds the League row for up to its 30-second transaction timeout, far longer than
 * Prisma's default 5-second interactive transaction. A writer that waits for the row therefore
 * bounds the wait itself and gets `LeagueBusyError` when another writer still holds it, instead of
 * a bare transaction-timeout 500 (#1343).
 */
export class LeagueBusyError extends Error {
  readonly code = 'LEAGUE_BUSY' as const;
  readonly status = 503 as const;
  constructor(readonly leagueId: string) {
    super('The league is being updated (scores or another move). Try again in a moment.');
    this.name = 'LeagueBusyError';
  }
}

/** A person is waiting on the answer: wait a few seconds, then say the league is busy. */
export const INTERACTIVE_LEAGUE_LOCK = { waitMs: 8_000, transaction: { timeout: 20_000 } } as const;

/** A scheduled job waits longer; one that still cannot get the row leaves the work for its next run. */
export const SCHEDULED_LEAGUE_LOCK = { waitMs: 20_000, transaction: { timeout: 45_000 } } as const;

/**
 * `lockLeagueRow` with a bounded wait: throws `LeagueBusyError` when the row is still locked after
 * `waitMs`. The failed statement aborts the transaction, so let the error leave the transaction.
 * Run the transaction with the matching `transaction` options above, so Prisma's own timeout is
 * longer than the wait.
 */
export async function lockLeagueRowOrBusy(
  tx: Prisma.TransactionClient,
  leagueId: string,
  waitMs: number
): Promise<void> {
  // `SET LOCAL` takes no bind parameter; set_config(..., true) is the transaction-local equivalent.
  await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${Math.round(waitMs)}ms`}, true)`;
  try {
    await lockLeagueRow(tx, leagueId);
  } catch (error) {
    if (isLockTimeout(error)) throw new LeagueBusyError(leagueId);
    throw error;
  }
  await tx.$queryRaw`SELECT set_config('lock_timeout', '0', true)`;
}

/** PostgreSQL 55P03 (lock_not_available), as Prisma's raw-query error carries it. */
function isLockTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { meta, message } = error as { meta?: { code?: unknown }; message?: unknown };
  return meta?.code === '55P03' || (typeof message === 'string' && message.includes('55P03'));
}
