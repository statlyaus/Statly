import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

import type { WaiverProcessingResult } from './WaiverProcessingService';

/** Waivers run once a day, at 6 am Melbourne time. */
export const WAIVER_RUN_TIME_ZONE = 'Australia/Melbourne';
export const WAIVER_RUN_HOUR = 6;

// The scheduler runs hourly in UTC, so daylight saving is handled here: only the run that lands in
// the 6 am Melbourne hour does any work.
export function isWaiverRunHour(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: WAIVER_RUN_TIME_ZONE,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now)
  );
  return hour === WAIVER_RUN_HOUR;
}

export interface ScheduledWaiverRun {
  ran: boolean;
  leagues: Array<{ leagueId: string } & WaiverProcessingResult>;
}

/** Processes every league that has waiver claims due, if it is the daily run hour. */
export async function processDueLeagueWaivers(
  now = new Date(),
  service?: Pick<import('./WaiverProcessingService').WaiverProcessingService, 'processLeague'>
): Promise<ScheduledWaiverRun> {
  if (!isWaiverRunHour(now)) return { ran: false, leagues: [] };
  // Loaded only when a run happens, so the hour check stays free of the service's dependencies.
  const processor =
    service ?? new (await import('./WaiverProcessingService')).WaiverProcessingService();

  const due = await prisma.teamAction.findMany({
    where: {
      actionType: 'WAIVER_CLAIM',
      status: 'PENDING',
      OR: [{ processingAt: null }, { processingAt: { lte: now } }],
    },
    distinct: ['leagueId'],
    select: { leagueId: true },
  });

  const leagues: ScheduledWaiverRun['leagues'] = [];
  // One league at a time, so a failure in one league never stops the others.
  for (const { leagueId } of due) {
    try {
      leagues.push({ leagueId, ...(await processor.processLeague({ leagueId })) });
    } catch (error) {
      logger.error('Scheduled waiver processing failed for a league', {
        leagueId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ran: true, leagues };
}
