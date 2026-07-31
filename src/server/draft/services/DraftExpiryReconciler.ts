import { logger } from '@/lib/logger';

import { draftRepository, type LiveDraftPickExpirySchedule } from '../repository/DraftRepository';
import { draftScheduler } from './DraftScheduler';

export type DraftExpiryReconciliationResult = {
  scheduledCount: number;
  repairedCount: number;
  skippedCount: number;
};

type ReconciliationOutcome = 'scheduled' | 'repaired' | 'skipped';

function summarize(outcomes: ReconciliationOutcome[]): DraftExpiryReconciliationResult {
  return outcomes.reduce<DraftExpiryReconciliationResult>(
    (result, outcome) => ({
      scheduledCount: result.scheduledCount + (outcome === 'scheduled' ? 1 : 0),
      repairedCount: result.repairedCount + (outcome === 'repaired' ? 1 : 0),
      skippedCount: result.skippedCount + (outcome === 'skipped' ? 1 : 0),
    }),
    { scheduledCount: 0, repairedCount: 0, skippedCount: 0 }
  );
}

/**
 * Projects durable Prisma clock state into revision-addressed BullMQ wake-ups.
 * Callers never provide a deadline or revision, so delayed or retried outbox work cannot
 * recreate an obsolete timer from stale event data.
 */
export class DraftExpiryReconciler {
  private async reconcileSchedule(
    schedule: LiveDraftPickExpirySchedule
  ): Promise<ReconciliationOutcome> {
    let pickDeadlineAt = schedule.pickDeadlineAt;
    let schedulingVersion = schedule.schedulingVersion;
    let repaired = false;

    if (!pickDeadlineAt) {
      const pickStartedAt = schedule.pickStartedAt ?? schedule.startedAt ?? new Date();
      const repairedPickDeadlineAt = new Date(
        pickStartedAt.getTime() + schedule.pickSeconds * 1000
      );
      const updated = await draftRepository.transaction((tx) =>
        draftRepository.repairMissingLiveDraftPickDeadline(tx, {
          draftId: schedule.draftId,
          currentSchedulingVersion: schedule.schedulingVersion,
          pickStartedAt,
          pickDeadlineAt: repairedPickDeadlineAt,
        })
      );

      if (updated.count !== 1) {
        logger.warn('Skipped live draft timer repair because draft state changed', {
          draftId: schedule.draftId,
        });
        return 'skipped';
      }

      repaired = true;
      schedulingVersion += 1;
      pickDeadlineAt = repairedPickDeadlineAt;
    }

    await draftScheduler.schedulePickExpiry({
      draftId: schedule.draftId,
      leagueId: schedule.leagueId,
      schedulingVersion,
      pickDeadlineAt,
    });

    return repaired ? 'repaired' : 'scheduled';
  }

  async reconcileDraft(draftId: string): Promise<DraftExpiryReconciliationResult> {
    const schedule = await draftRepository.transaction((tx) =>
      draftRepository.getLiveDraftPickExpirySchedule(tx, draftId)
    );
    const result = summarize(schedule ? [await this.reconcileSchedule(schedule)] : ['skipped']);

    logger.info('Reconciled draft pick expiry job', { draftId, ...result });
    return result;
  }

  async reconcileAllLiveDrafts(): Promise<DraftExpiryReconciliationResult> {
    const schedules = await draftRepository.transaction((tx) =>
      draftRepository.listLiveDraftPickExpirySchedules(tx)
    );
    const outcomes: ReconciliationOutcome[] = [];

    for (const schedule of schedules) {
      outcomes.push(await this.reconcileSchedule(schedule));
    }

    const result = summarize(outcomes);
    logger.info('Reconciled live draft pick expiry jobs', result);
    return result;
  }
}

export const draftExpiryReconciler = new DraftExpiryReconciler();
