import { logger } from '@/lib/logger';
import { incCounter, METRICS } from '@/server/metrics';

import { draftRepository, type LiveDraftPickExpirySchedule } from '../repository/DraftRepository';

export type DraftClockConvergenceResult = {
  schedule: LiveDraftPickExpirySchedule | null;
  repaired: boolean;
};

export type LiveDraftClockAnchors = {
  pickStartedAt: Date;
  pickDeadlineAt: Date;
  clockDurationSeconds: number;
};

export function hasValidLiveDraftClockAnchors(
  schedule: Pick<
    LiveDraftPickExpirySchedule,
    'pickStartedAt' | 'pickDeadlineAt' | 'pausedRemainingSeconds' | 'clockDurationSeconds'
  >
): schedule is LiveDraftPickExpirySchedule & LiveDraftClockAnchors {
  return Boolean(
    schedule.clockDurationSeconds &&
    Number.isInteger(schedule.clockDurationSeconds) &&
    schedule.clockDurationSeconds > 0 &&
    schedule.pickStartedAt &&
    schedule.pickDeadlineAt &&
    schedule.pausedRemainingSeconds === null &&
    schedule.pickDeadlineAt.getTime() >= schedule.pickStartedAt.getTime()
  );
}

function resolveClockDurationSeconds(schedule: LiveDraftPickExpirySchedule): number {
  if (
    schedule.clockDurationSeconds &&
    Number.isInteger(schedule.clockDurationSeconds) &&
    schedule.clockDurationSeconds > 0
  ) {
    return schedule.clockDurationSeconds;
  }

  if (
    schedule.pickStartedAt &&
    schedule.pickDeadlineAt &&
    schedule.pickDeadlineAt.getTime() > schedule.pickStartedAt.getTime()
  ) {
    return Math.max(
      1,
      Math.ceil((schedule.pickDeadlineAt.getTime() - schedule.pickStartedAt.getTime()) / 1000)
    );
  }

  if (!Number.isInteger(schedule.pickSeconds) || schedule.pickSeconds <= 0) {
    throw new Error(`LIVE draft has invalid pick duration: ${schedule.draftId}`);
  }

  return schedule.pickSeconds;
}

export function deriveLiveDraftClockAnchors(
  schedule: LiveDraftPickExpirySchedule,
  repairTime: Date
): LiveDraftClockAnchors {
  const clockDurationSeconds = resolveClockDurationSeconds(schedule);
  const durationMs = clockDurationSeconds * 1000;
  const latestTurnPickAt =
    schedule.lastPickOverall === schedule.currentPick - 1 ? schedule.lastPickMadeAt : null;

  if (schedule.pickStartedAt) {
    return {
      pickStartedAt: schedule.pickStartedAt,
      pickDeadlineAt:
        schedule.pickDeadlineAt &&
        schedule.pickDeadlineAt.getTime() >= schedule.pickStartedAt.getTime()
          ? schedule.pickDeadlineAt
          : new Date(schedule.pickStartedAt.getTime() + durationMs),
      clockDurationSeconds,
    };
  }

  if (schedule.pickDeadlineAt) {
    const durableStartedAt =
      latestTurnPickAt && latestTurnPickAt.getTime() <= schedule.pickDeadlineAt.getTime()
        ? latestTurnPickAt
        : new Date(schedule.pickDeadlineAt.getTime() - durationMs);

    return {
      pickStartedAt: durableStartedAt,
      pickDeadlineAt: schedule.pickDeadlineAt,
      clockDurationSeconds,
    };
  }

  const pickStartedAt = latestTurnPickAt ?? schedule.startedAt ?? repairTime;
  return {
    pickStartedAt,
    pickDeadlineAt: new Date(pickStartedAt.getTime() + durationMs),
    clockDurationSeconds,
  };
}

/**
 * Repairs malformed durable LIVE clock anchors without depending on Redis or BullMQ.
 * A compare-and-swap protects a newer pick or lifecycle transition; conflicts always
 * reload the winning Prisma state instead of applying a second repair.
 */
export class DraftClockConvergenceService {
  async convergeDraft(
    draftId: string,
    repairTime = new Date()
  ): Promise<DraftClockConvergenceResult> {
    try {
      const observed = await draftRepository.transaction((tx) =>
        draftRepository.getLiveDraftPickExpirySchedule(tx, draftId)
      );
      if (!observed) {
        incCounter(METRICS.draftClockConvergence, 1, { outcome: 'not_live' });
        return { schedule: observed, repaired: false };
      }
      if (hasValidLiveDraftClockAnchors(observed)) {
        incCounter(METRICS.draftClockConvergence, 1, { outcome: 'valid' });
        return { schedule: observed, repaired: false };
      }

      const anchors = deriveLiveDraftClockAnchors(observed, repairTime);
      const nextSchedulingVersion = observed.schedulingVersion + 1;
      const lifecyclePayload = {
        status: 'LIVE' as const,
        schedulingVersion: nextSchedulingVersion,
        durationSeconds: anchors.clockDurationSeconds,
        serverNow: repairTime.toISOString(),
        pickStartedAt: anchors.pickStartedAt.toISOString(),
        pickDeadlineAt: anchors.pickDeadlineAt.toISOString(),
        pausedRemainingSeconds: null,
      };
      const repair = await draftRepository.transaction((tx) =>
        draftRepository.transitionDraftClock(tx, {
          draftId: observed.draftId,
          leagueId: observed.leagueId,
          currentSchedulingVersion: observed.schedulingVersion,
          expectedStatus: 'LIVE',
          expectedCurrentPick: observed.currentPick,
          expectedPickStartedAt: observed.pickStartedAt,
          expectedPickDeadlineAt: observed.pickDeadlineAt,
          expectedPausedRemainingSeconds: observed.pausedRemainingSeconds,
          expectedClockDurationSeconds: observed.clockDurationSeconds,
          status: 'LIVE',
          currentPick: observed.currentPick,
          pickStartedAt: anchors.pickStartedAt,
          pickDeadlineAt: anchors.pickDeadlineAt,
          pausedRemainingSeconds: null,
          clockDurationSeconds: anchors.clockDurationSeconds,
          events: [
            {
              event: 'draft:clock-repaired',
              payload: lifecyclePayload,
              publishState: true,
            },
          ],
        })
      );
      const converged = await draftRepository.transaction((tx) =>
        draftRepository.getLiveDraftPickExpirySchedule(tx, draftId)
      );

      if (converged && !hasValidLiveDraftClockAnchors(converged)) {
        throw new Error(`LIVE draft clock did not converge: ${draftId}`);
      }

      const didRepair = repair.count === 1;
      incCounter(METRICS.draftClockConvergence, 1, {
        outcome: didRepair ? 'repaired' : 'concurrent',
      });
      logger.info(
        didRepair ? 'Repaired durable live draft clock' : 'Reloaded concurrent clock repair',
        {
          draftId,
          schedulingVersion: converged?.schedulingVersion,
        }
      );

      return { schedule: converged, repaired: didRepair };
    } catch (error) {
      incCounter(METRICS.draftClockConvergence, 1, { outcome: 'failed' });
      throw error;
    }
  }
}

export const draftClockConvergenceService = new DraftClockConvergenceService();
