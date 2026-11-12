import type { Prisma } from '@prisma/client';

/**
 * Locks the League row until the transaction ends. Writers that must not interleave with a draft
 * start (the settings save, the draft start itself) take it first, so each sees the other's commit.
 */
export async function lockLeagueRow(tx: Prisma.TransactionClient, leagueId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "League" WHERE id = ${leagueId} FOR UPDATE`;
}
