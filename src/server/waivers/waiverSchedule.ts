import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { IN_ACTIVE_SEASON } from '@/server/leagues/activeSeason';

import type { WaiverProcessingResult } from './WaiverProcessingService';

/** Waivers run once a day, at 6 am Melbourne time. */
export const WAIVER_RUN_TIME_ZONE = 'Australia/Melbourne';
export const WAIVER_RUN_HOUR = 6;

const HOUR_MS = 60 * 60 * 1000;

function melbourneHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: WAIVER_RUN_TIME_ZONE,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now)
  );
}

// The scheduler runs hourly in UTC, so daylight saving is handled here: the run that lands in the
// 6 am Melbourne hour is the daily run.
export function isWaiverRunHour(now: Date): boolean {
  return melbourneHour(now) === WAIVER_RUN_HOUR;
}

/**
 * The start of today's 6 am Melbourne run, or null before 6 am, when today's run has not come yet.
 * Melbourne's offset is a whole number of hours, so its hours start on UTC hours.
 */
export function todaysWaiverRunAt(now: Date): Date | null {
  if (melbourneHour(now) < WAIVER_RUN_HOUR) return null;
  const runAt = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  while (!isWaiverRunHour(runAt)) runAt.setTime(runAt.getTime() - HOUR_MS);
  return runAt;
}

export interface ScheduledWaiverRun {
  ran: boolean;
  leagues: Array<{ leagueId: string } & WaiverProcessingResult>;
  /** Leagues whose processing threw; their claims stay pending for a later run. */
  failedLeagueIds: string[];
}

const nothingRan = (): ScheduledWaiverRun => ({ ran: false, leagues: [], failedLeagueIds: [] });

/**
 * Processes every league with waiver claims due at today's 6 am Melbourne run. In the 6 am hour
 * that is the daily run. Any later hour the same Melbourne day catches up a run that failed or was
 * missed: it settles only claims due by 6 am, so a league whose run completed has none left and is
 * not touched, and claims due after 6 am wait for tomorrow's run.
 */
export async function processDueLeagueWaivers(
  now = new Date(),
  service?: Pick<import('./WaiverProcessingService').WaiverProcessingService, 'processLeague'>
): Promise<ScheduledWaiverRun> {
  const dueBy = isWaiverRunHour(now) ? now : todaysWaiverRunAt(now);
  if (!dueBy) return nothingRan();

  const due = await prisma.teamAction.findMany({
    where: {
      ...IN_ACTIVE_SEASON,
      actionType: 'WAIVER_CLAIM',
      status: 'PENDING',
      OR: [{ processingAt: null }, { processingAt: { lte: dueBy } }],
    },
    distinct: ['leagueId'],
    select: { leagueId: true },
  });
  // A catch-up hour with nothing left from 6 am is a no-op, not a run.
  if (due.length === 0 && dueBy !== now) return nothingRan();

  // Loaded only when a run happens, so the hour check stays free of the service's dependencies.
  const processor =
    service ?? new (await import('./WaiverProcessingService')).WaiverProcessingService();

  const leagues: ScheduledWaiverRun['leagues'] = [];
  const failedLeagueIds: string[] = [];
  // One league at a time, so a failure in one league never stops the others.
  for (const { leagueId } of due) {
    try {
      leagues.push({ leagueId, ...(await processor.processLeague({ leagueId, dueBy })) });
    } catch (error) {
      failedLeagueIds.push(leagueId);
      logger.error('Scheduled waiver processing failed for a league', {
        leagueId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ran: true, leagues, failedLeagueIds };
}
