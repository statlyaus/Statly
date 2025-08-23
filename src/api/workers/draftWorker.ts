import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { draftQueue, type DraftJobData } from '../queues/draftQueue';
import { getWorkerClient } from '../queues/scalableConnection';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftStatus } from '@prisma/client';
import { openDraftLobby, startDraftCountdown } from '@/lib/draftLobby';

async function openLobby(job: Job<DraftJobData>): Promise<void> {
  const { leagueId, pickClock } = job.data;

  try {
    // Find the draft for this league
    const draft = await prisma.draft.findFirst({
      where: {
        leagueId,
        status: DraftStatus.SCHEDULED
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
      draftId: draft.id,
      jobId: job.id,
    });

    // Schedule the actual draft start (5 minutes from now)
    await draftQueue.add('start-draft', { leagueId, pickClock }, { delay: 5 * 60 * 1000 }); // 5 minutes

  } catch (error) {
    logger.error(`Failed to open lobby for league ${leagueId}`, {
      leagueId,
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function startDraft(job: Job<DraftJobData>): Promise<void> {
  const { leagueId, pickClock } = job.data;

  try {
    // Find the draft for this league
    const draft = await prisma.draft.findFirst({
      where: {
        leagueId,
        lobbyStatus: 'COUNTDOWN'
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
    await draftQueue.add('auto-pick', { leagueId, pickClock }, { delay: pickClock });

  } catch (error) {
    logger.error(`Failed to start draft for league ${leagueId}`, {
      leagueId,
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function advancePick(job: Job<DraftJobData>): Promise<void> {
  const { leagueId, pickClock } = job.data;

  logger.info(`Advancing pick for league ${leagueId} via job ${job.name}`, {
    leagueId,
    jobId: job.id,
    jobName: job.name,
    pickClock,
  });

  // In a real implementation, this would trigger auto-pick logic
  // For now, just schedule the next pick
  await draftQueue.add('auto-pick', { leagueId, pickClock }, { delay: pickClock });
}

export const draftWorker = new Worker<DraftJobData>(
  'draftQueue',
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
    }
  },
  { connection: getWorkerClient() }
);

draftWorker.on('failed', (job: Job<DraftJobData> | undefined, err: Error) => {
  logger.error(`Job ${job?.id ?? 'unknown'} failed`, err, {
    jobId: job?.id,
    jobName: job?.name,
    leagueId: job?.data?.leagueId,
  });
});
