import { logger } from '@/lib/logger';
import {
  draftQueue,
  cancelDraftPickExpiry,
  getDraftPickExpiryVersionedJobId,
  scheduleDraftPickExpiry,
} from '@/server/queue/draftQueue';
import { DRAFT_BEHAVIOR_CONTRACT } from '@/server/draft/domain/draftTypes';

export class DraftScheduler {
  private async ensurePickExpiryScheduled(
    draftId: string,
    schedulingVersion: number
  ): Promise<boolean> {
    const job = await draftQueue.getJob(
      getDraftPickExpiryVersionedJobId(draftId, schedulingVersion)
    );

    return Boolean(job);
  }

  private async ensureNoPendingPickExpiry(draftId: string): Promise<boolean> {
    const jobs = await draftQueue.getJobs(
      ['delayed', 'waiting', 'active', 'prioritized'],
      0,
      200,
      true
    );

    return !jobs.some((job) => {
      if (job.name !== 'draft:pick-expiry') {
        return false;
      }

      return job.data?.draftId === draftId;
    });
  }

  async schedulePickExpiry(input: {
    draftId: string;
    leagueId: string;
    schedulingVersion: number;
    pickDeadlineAt: Date;
  }): Promise<void> {
    if (DRAFT_BEHAVIOR_CONTRACT.timing.timerAuthority !== 'SERVER_PICK_DEADLINE') {
      throw new Error('bad_state:Unsupported draft timer authority');
    }

    if (DRAFT_BEHAVIOR_CONTRACT.timing.schedulingGuard !== 'SCHEDULING_VERSION_MATCH_REQUIRED') {
      throw new Error('bad_state:Unsupported draft scheduling guard');
    }

    await scheduleDraftPickExpiry(
      {
        kind: 'draft:pick-expiry',
        draftId: input.draftId,
        leagueId: input.leagueId,
        schedulingVersion: input.schedulingVersion,
      },
      input.pickDeadlineAt
    );

    if (!(await this.ensurePickExpiryScheduled(input.draftId, input.schedulingVersion))) {
      logger.warn('Draft pick expiry missing after schedule, retrying once', {
        draftId: input.draftId,
        schedulingVersion: input.schedulingVersion,
      });

      await scheduleDraftPickExpiry(
        {
          kind: 'draft:pick-expiry',
          draftId: input.draftId,
          leagueId: input.leagueId,
          schedulingVersion: input.schedulingVersion,
        },
        input.pickDeadlineAt
      );
    }

    if (!(await this.ensurePickExpiryScheduled(input.draftId, input.schedulingVersion))) {
      throw new Error('conflict:Draft expiry scheduling not persisted');
    }

    logger.info('Scheduled draft pick expiry', {
      draftId: input.draftId,
      leagueId: input.leagueId,
      schedulingVersion: input.schedulingVersion,
      pickDeadlineAt: input.pickDeadlineAt.toISOString(),
    });
  }

  async cancelPickExpiry(draftId: string): Promise<void> {
    if (DRAFT_BEHAVIOR_CONTRACT.timing.pauseBehavior !== 'STOP_CLOCK_AND_SUPPRESS_AUTO_PICK') {
      throw new Error('bad_state:Unsupported draft cancellation behavior');
    }

    await cancelDraftPickExpiry(draftId);

    if (!(await this.ensureNoPendingPickExpiry(draftId))) {
      logger.warn('Draft pick expiry still present after cancel, retrying once', { draftId });
      await cancelDraftPickExpiry(draftId);
    }

    if (!(await this.ensureNoPendingPickExpiry(draftId))) {
      throw new Error('conflict:Draft expiry cancellation not persisted');
    }

    logger.info('Cancelled draft pick expiry', { draftId });
  }
}

export const draftScheduler = new DraftScheduler();
