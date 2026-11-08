import type { NbaIngestJob, Prisma, PrismaClient } from '@prisma/client';

import { NbaIngestRejected, type NbaStatsProvider } from './nbaStatsProvider';

/**
 * Shared plumbing for the NBA ingest jobs: the Prisma surface they use, their options, the
 * production licensing guard and the `NbaIngestRun` audit row every invocation writes.
 */

export type NbaIngestPrisma = Pick<
  PrismaClient,
  | 'nbaTeam'
  | 'nbaPlayer'
  | 'nbaPlayerIdentity'
  | 'nbaGame'
  | 'nbaPlayerGameStat'
  | 'nbaPlayerInjury'
  | 'nbaIngestRun'
  | '$transaction'
>;

export interface NbaIngestJobOptions {
  prisma: NbaIngestPrisma;
  provider: NbaStatsProvider;
  /** The year the season ends: 2026-27 is 2027. */
  season: number;
  now?: Date;
  limits?: {
    /** Box scores fetched per run. Default 8. */
    games?: number;
  };
}

export interface NbaIngestResult<Summary> {
  runId: string;
  summary: Summary;
}

/**
 * ESPN (and any other provider whose terms forbid commercial use) must not feed production unless
 * the owner deliberately sets `NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true`. Applies to the cron route
 * and the CLI scripts alike, because both run every job through `recordNbaIngestRun`.
 */
export function assertNbaProviderAllowed(provider: NbaStatsProvider): void {
  if (
    process.env.NODE_ENV === 'production' &&
    !provider.commercialUseLicensed &&
    process.env.NBA_STATS_ALLOW_UNLICENSED_PROVIDER !== 'true'
  ) {
    throw new NbaIngestRejected(
      'unlicensed_provider',
      `Provider ${provider.id} is not licensed for commercial use; set NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true to run it in production`
    );
  }
}

const MAX_REASON_LENGTH = 500;

/**
 * Writes the run row, checks the guard, runs `work` and finishes the row: SUCCEEDED with the
 * summary, REJECTED with the rejection reason, or FAILED with the error message. Errors are
 * rethrown. A job that rejects must do so before its first write, so the run row is its only write.
 */
export async function recordNbaIngestRun<Summary>(
  job: NbaIngestJob,
  { prisma, provider, now = new Date() }: Pick<NbaIngestJobOptions, 'prisma' | 'provider' | 'now'>,
  work: () => Promise<Summary>
): Promise<NbaIngestResult<Summary>> {
  const run = await prisma.nbaIngestRun.create({
    data: { job, provider: provider.id, startedAt: now },
    select: { id: true },
  });

  try {
    assertNbaProviderAllowed(provider);
    const summary = await work();
    await prisma.nbaIngestRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        outcome: 'SUCCEEDED',
        reason: null,
        summaryJson: summary as Prisma.InputJsonValue,
      },
    });
    return { runId: run.id, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rejected = error instanceof NbaIngestRejected;
    await prisma.nbaIngestRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        outcome: rejected ? 'REJECTED' : 'FAILED',
        reason: rejected ? error.reason : message.slice(0, MAX_REASON_LENGTH),
        summaryJson: { message },
      },
    });
    throw error;
  }
}
