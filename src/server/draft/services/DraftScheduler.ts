import { logger } from '@/lib/logger';
import { scheduleDraftPickExpiry } from '@/server/queue/draftQueue';

export class DraftScheduler {
  async schedulePickExpiry(input: {
    draftId: string;
    leagueId: string;
    schedulingVersion: number;
    pickDeadlineAt: Date;
  }): Promise<void> {
    await scheduleDraftPickExpiry(
      {
        kind: 'draft:pick-expiry',
        draftId: input.draftId,
        leagueId: input.leagueId,
        schedulingVersion: input.schedulingVersion,
      },
      input.pickDeadlineAt
    );

    logger.info('Scheduled draft pick expiry', {
      draftId: input.draftId,
      leagueId: input.leagueId,
      schedulingVersion: input.schedulingVersion,
      pickDeadlineAt: input.pickDeadlineAt.toISOString(),
    });
  }
}

export const draftScheduler = new DraftScheduler();
