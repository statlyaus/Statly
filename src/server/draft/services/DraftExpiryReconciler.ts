import { logger } from '@/lib/logger';

import { draftRepository } from '../repository/DraftRepository';
import { draftClockCoordinator } from './DraftClockCoordinator';

export type DraftExpiryReconciliationResult = {
  scheduledCount: number;
  repairedCount: number;
  skippedCount: number;
  failedCount: number;
};

type ReconciliationOutcome = 'scheduled' | 'repaired' | 'skipped' | 'failed';

function summarize(outcomes: ReconciliationOutcome[]): DraftExpiryReconciliationResult {
  return outcomes.reduce<DraftExpiryReconciliationResult>(
    (result, outcome) => ({
      scheduledCount: result.scheduledCount + (outcome === 'scheduled' ? 1 : 0),
      repairedCount: result.repairedCount + (outcome === 'repaired' ? 1 : 0),
      skippedCount: result.skippedCount + (outcome === 'skipped' ? 1 : 0),
      failedCount: result.failedCount + (outcome === 'failed' ? 1 : 0),
    }),
    { scheduledCount: 0, repairedCount: 0, skippedCount: 0, failedCount: 0 }
  );
}

/**
 * Projects durable Prisma clock state into revision-addressed BullMQ wake-ups.
 * Callers never provide a deadline or revision, so delayed or retried outbox work cannot
 * recreate an obsolete timer from stale event data.
 */
export class DraftExpiryReconciler {
  private async reconcileDraftSchedule(draftId: string): Promise<ReconciliationOutcome> {
    const { receipt, repaired } = await draftClockCoordinator.ensureReady(draftId);
    if (repaired) return 'repaired';
    return receipt ? 'scheduled' : 'skipped';
  }

  async reconcileDraft(draftId: string): Promise<DraftExpiryReconciliationResult> {
    const result = summarize([await this.reconcileDraftSchedule(draftId)]);

    logger.info('Reconciled draft pick expiry job', { draftId, ...result });
    return result;
  }

  async reconcileAllLiveDrafts(): Promise<DraftExpiryReconciliationResult> {
    const schedules = await draftRepository.transaction((tx) =>
      draftRepository.listLiveDraftPickExpirySchedules(tx)
    );
    const outcomes: ReconciliationOutcome[] = [];

    // One broken draft must not leave every later live draft without a pick timer.
    for (const schedule of schedules) {
      try {
        outcomes.push(await this.reconcileDraftSchedule(schedule.draftId));
      } catch (error) {
        logger.warn('Failed to reconcile draft pick expiry job', {
          draftId: schedule.draftId,
          error: error instanceof Error ? error.message : String(error),
        });
        outcomes.push('failed');
      }
    }

    const result = summarize(outcomes);
    logger.info('Reconciled live draft pick expiry jobs', result);
    return result;
  }
}

export const draftExpiryReconciler = new DraftExpiryReconciler();
