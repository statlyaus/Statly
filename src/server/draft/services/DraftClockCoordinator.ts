import { logger } from '@/lib/logger';
import { getDraftPickExpiryVersionedJobId } from '@/server/queue/draftQueue';

import type { DraftClockScheduleReceipt, LiveDraftClockToken } from '../domain/draftTypes';
import { draftRepository, type LiveDraftPickExpirySchedule } from '../repository/DraftRepository';
import {
  draftClockConvergenceService,
  hasValidLiveDraftClockAnchors,
} from './DraftClockConvergenceService';
import { draftScheduler } from './DraftScheduler';

export type DraftClockReadyResult = {
  receipt: DraftClockScheduleReceipt | null;
  repaired: boolean;
};

const MAX_COORDINATION_ATTEMPTS = 3;

function toLiveClockToken(
  schedule: LiveDraftPickExpirySchedule & {
    pickStartedAt: Date;
    pickDeadlineAt: Date;
    clockDurationSeconds: number;
  }
): LiveDraftClockToken {
  return {
    draftId: schedule.draftId,
    leagueId: schedule.leagueId,
    currentPick: schedule.currentPick,
    status: 'LIVE',
    stateRevision: schedule.schedulingVersion,
    durationSeconds: schedule.clockDurationSeconds,
    startedAt: schedule.pickStartedAt,
    deadlineAt: schedule.pickDeadlineAt,
    pausedRemainingSeconds: null,
  };
}

function scheduleMatchesToken(
  schedule: LiveDraftPickExpirySchedule,
  token: LiveDraftClockToken
): boolean {
  return Boolean(
    hasValidLiveDraftClockAnchors(schedule) &&
    schedule.draftId === token.draftId &&
    schedule.leagueId === token.leagueId &&
    schedule.currentPick === token.currentPick &&
    schedule.schedulingVersion === token.stateRevision &&
    schedule.clockDurationSeconds === token.durationSeconds &&
    schedule.pickStartedAt.getTime() === token.startedAt.getTime() &&
    schedule.pickDeadlineAt.getTime() === token.deadlineAt.getTime()
  );
}

/**
 * Sole hot-path boundary for making the current durable LIVE clock schedulable. Repairs are
 * committed through Prisma first, and BullMQ accepts an immutable revision-addressed job before a
 * receipt is returned. Reconciliation callers can safely retry after any process crash.
 */
export class DraftClockCoordinator {
  async ensureReady(draftId: string): Promise<DraftClockReadyResult> {
    let repaired = false;

    for (let attempt = 1; attempt <= MAX_COORDINATION_ATTEMPTS; attempt += 1) {
      const convergence = await draftClockConvergenceService.convergeDraft(draftId);
      repaired ||= convergence.repaired;
      const schedule = convergence.schedule;

      if (!schedule) {
        return { receipt: null, repaired };
      }
      if (!hasValidLiveDraftClockAnchors(schedule)) {
        throw new Error(`Cannot schedule unconverged LIVE draft clock: ${draftId}`);
      }

      const token = toLiveClockToken(schedule);
      await draftScheduler.schedulePickExpiry({
        draftId: token.draftId,
        leagueId: token.leagueId,
        schedulingVersion: token.stateRevision,
        pickDeadlineAt: token.deadlineAt,
      });
      const acceptedAt = new Date();

      const current = await draftRepository.transaction((tx) =>
        draftRepository.getLiveDraftPickExpirySchedule(tx, draftId)
      );
      if (!current) {
        return { receipt: null, repaired };
      }
      if (scheduleMatchesToken(current, token)) {
        const receipt: DraftClockScheduleReceipt = {
          token,
          jobId: getDraftPickExpiryVersionedJobId(token.draftId, token.stateRevision),
          acceptedAt,
          repaired,
        };
        logger.info('Draft clock revision is ready', {
          draftId: token.draftId,
          leagueId: token.leagueId,
          currentPick: token.currentPick,
          schedulingVersion: token.stateRevision,
          jobId: receipt.jobId,
          repaired,
        });
        return { receipt, repaired };
      }

      logger.info('Retrying draft clock coordination after a concurrent transition', {
        draftId,
        attempt,
        scheduledRevision: token.stateRevision,
        currentRevision: current.schedulingVersion,
      });
    }

    throw new Error(`Draft clock changed during ${MAX_COORDINATION_ATTEMPTS} scheduling attempts`);
  }
}

export const draftClockCoordinator = new DraftClockCoordinator();
