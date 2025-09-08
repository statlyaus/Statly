import 'server-only';
import { DraftStatus } from '@prisma/client';
import { Worker } from 'bullmq';

import { PRE_START_DELAY_MS, DRAFT_JOB_OPTIONS } from '@/lib/constants/draft';
import { openDraftLobby, startDraftCountdown } from '@/lib/draftLobby';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

import { draftQueue, DRAFT_QUEUE_NAME, type DraftJobData } from '../queue/draftQueue';
import { ScalableRedisConnection } from '../realtime/scalableConnection';

import type { Job } from 'bullmq';

async function openLobby(job: Job<DraftJobData>): Promise<void> {
  const { leagueId, pickClock } = job.data;

  try {
    // Find the draft for this league
    const draft = await prisma.draft.findFirst({
      where: {
        leagueId,
        status: DraftStatus.SCHEDULED,
      },
    });

    if (!draft) {
      logger.warn(`No scheduled draft found for league ${leagueId}`, {
        leagueId,
        jobId: job.id,
      });
      return;
    }

    // Open the lobby (5 minutes before draft)
    await openDraftLobby(draft.id);
    await startDraftCountdown(draft.id);

    logger.info(`Draft lobby opened for league ${leagueId}`, {
      leagueId,
    // Schedule the actual draft start (5 minutes from now)
    await draftQueue.add(
      'start-draft',
      { leagueId, pickClock, draftId: draft.id },
      {
        delay: 5 * 60 * 1000, // 5 minutes
        jobId: `start-draft:${draft.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  } catch (error) {
    logger.error(
      { err: error, leagueId, jobId: job.id },
      `Failed to open lobby for league ${leagueId}`
    );
    throw error;
        delay: PRE_START_DELAY_MS,
        jobId: `start-draft:${leagueId}`,
        ...DRAFT_JOB_OPTIONS,
      }
    );
  } catch (error) {
    logger.error(`Failed to open lobby for league ${leagueId}`, {
      leagueId,
    const draft = await prisma.draft.findFirst({
      where: {
        leagueId,
        status: DraftStatus.SCHEDULED,
        lobbyStatus: DraftLobbyStatus.COUNTDOWN,
      },
    });
}

async function startDraft(job: Job<DraftJobData>): Promise<void> {
  const { leagueId, pickClock } = job.data;

  try {
    // Find the draft for this league
    const draft = await prisma.draft.findFirst({
      where: {
        leagueId,
        status: DraftStatus.SCHEDULED,
        lobbyStatus: 'COUNTDOWN',
      },
    });

    if (!draft) {
      logger.warn(`No draft in countdown found for league ${leagueId}`, {
        leagueId,
        jobId: job.id,
      });
      return;
    }

    // Update draft status to LIVE and set start time
    await prisma.draft.update({
      where: { id: draft.id },
      data: {
        status: DraftStatus.LIVE,
        lobbyStatus: 'LIVE',
        startedAt: new Date(),
      },
    });

    logger.info(`Draft started for league ${leagueId}`, {
      leagueId,
      draftId: draft.id,
      jobId: job.id,
      jobName: job.name,
      pickClock,
    });

    // Start the first pick timer
    await draftQueue.add(
      'auto-pick',
      { leagueId, pickClock },
      {
        delay: pickClock,
        jobId: `auto-pick:${leagueId}:${Date.now()}`,
        ...DRAFT_JOB_OPTIONS,
      }
    );
  } catch (error) {
    logger.error(`Failed to start draft for league ${leagueId}`, {
      leagueId,
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    if (job.name === 'start') {
      // This opens the lobby 5 minutes before draft
      await openLobby(job);
    } else if (job.name === 'start-draft') {
      // This actually starts the draft after countdown
      await startDraft(job);
    } else if (job.name === 'auto-pick') {
      logger.info(`Auto-picking for league ${job.data.leagueId}`, {
  { connection: getWorkerClient(), concurrency: 5 }
);
      });
      await advancePick(job);
    } else {
      logger.warn(`Unknown job name '${job.name}' for league ${job.data.leagueId}`, {
        leagueId: job.data.leagueId,
        jobId: job.id,
        jobName: job.name,
      });
    }
  },

    // Fetch the current draft for this league
    const draft = await prisma.draft.findFirst({
      where: {
        leagueId,
      },
    });

    if (!draft) {
      logger.warn(`No draft found for league ${leagueId}, stopping auto-pick chain`, {
        leagueId,
        jobId: job.id,
      });
      return;
    }

    if (draft.status !== DraftStatus.LIVE) {
      logger.info(`Draft for league ${leagueId} is not LIVE (status: ${draft.status}), stopping auto-pick chain`, {
        leagueId,
        draftId: draft.id,
        draftStatus: draft.status,
        jobId: job.id,
      });
      return;
    }

    // TODO: compute next pick number from state and stop when draft ends.
    await draftQueue.add(
      'auto-pick',
      { leagueId, pickClock },
      {
        jobId: `auto-pick:${leagueId}:next`,
        delay: pickClock,
        ...DRAFT_JOB_OPTIONS,
      }
    );
  } catch (error) {
    logger.error(`Failed to advance pick for league ${leagueId}`, {
      leagueId,
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const draftWorker = new Worker<DraftJobData>(
  DRAFT_QUEUE_NAME,
  async (job: Job<DraftJobData>) => {
    if (job.name === 'start') {
      // This opens the lobby 5 minutes before draft
      await openLobby(job);
    } else if (job.name === 'start-draft') {
      // This actually starts the draft after countdown
      await startDraft(job);
    } else if (job.name === 'auto-pick') {
      logger.info(`Auto-picking for league ${job.data.leagueId}`, {
        leagueId: job.data.leagueId,
        jobId: job.id,
      });
      await advancePick(job);
    } else {
      // Handle unexpected job names
      logger.error(`Unexpected job name received in draft worker`, {
        jobName: job.name,
        jobId: job.id,
        leagueId: job.data?.leagueId,
        jobData: job.data,
      });
      throw new Error(`Unsupported job name: ${job.name}`);
    }
  },
  { connection: ScalableRedisConnection.getInstance().getWorkerClient() }
);

draftWorker.on('failed', (job: Job<DraftJobData> | undefined, err: Error) => {
  logger.error(`Job ${job?.id ?? 'unknown'} failed`, err, {
    jobId: job?.id,
    jobName: job?.name,
    leagueId: job?.data?.leagueId,
  });
});
