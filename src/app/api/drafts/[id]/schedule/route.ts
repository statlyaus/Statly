import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftStatus } from '@prisma/client';
import { scheduleDraftStart } from '@/api/queues/draftQueue';
import { localToUtc, isValidTimeZone } from '@/lib/timezone';
import { updateDraftReminders } from '@/lib/reminders';
import type { LeagueParams } from '@/types/api';

interface UpdateScheduleRequest {
  scheduledTime: string;
  timePerPick?: number;
  timeZone?: string;
  enableReminders?: boolean;
}

export async function PUT(
  request: NextRequest,
  { params }: LeagueParams
) {
  const { id: draftId } = await Promise.resolve(params);
  try {
    const body: UpdateScheduleRequest = await request.json();

    // Validation
    if (!body.scheduledTime) {
      return errorResponse('Scheduled time is required', 400);
    }

    // Timezone validation
    const timeZone = body.timeZone || 'UTC';
    if (!isValidTimeZone(timeZone)) {
      return errorResponse('Invalid timezone', 400);
    }

    // Convert scheduled time from user's timezone to UTC
    let scheduledDate: Date;
    try {
      scheduledDate = localToUtc(body.scheduledTime, timeZone);
    } catch (_error) {
      return errorResponse('Invalid scheduled time format', 400);
    }

    if (scheduledDate <= new Date()) {
      return errorResponse('Scheduled time must be in the future', 400);
    }

    // Find the draft
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
            members: true, // Include members for reminders
          },
        },
      },
    });

    if (!draft) {
      return errorResponse('Draft not found', 404);
    }

    if (draft.status !== DraftStatus.SCHEDULED && draft.status !== DraftStatus.LIVE) {
      return errorResponse('Can only reschedule pending or live drafts', 400);
    }

    // Update the draft and league settings
    const timePerPick = body.timePerPick || draft.league?.settings?.pickSeconds || 120;

    await prisma.$transaction(async (tx) => {
      // Update league settings
      if (draft.league?.settings) {
        await tx.leagueSettings.update({
          where: { id: draft.league.settings.id },
          data: {
            startAt: scheduledDate,
            pickSeconds: timePerPick,
            timeZone,
          },
        });
      }

      // Update draft status
      await tx.draft.update({
        where: { id: draftId },
        data: {
          status: DraftStatus.SCHEDULED,
          startedAt: null, // Clear any existing start time
        },
      });
    });

    // Schedule the draft start
    try {
      await scheduleDraftStart(
        draft.leagueId,
        scheduledDate,
        timePerPick * 1000 // Convert seconds to milliseconds
      );

      // Update reminders if enabled
      if (body.enableReminders !== false) { // Default to true
        const participantIds = draft.league?.members?.map(member => member.userId) || [];
        if (participantIds.length > 0) {
          await updateDraftReminders(draftId, scheduledDate, participantIds);
        }
      }

      logger.info('Draft rescheduled successfully', {
        draftId,
        leagueId: draft.leagueId,
        scheduledTime: scheduledDate.toISOString(),
        timeZone,
        timePerPick,
        remindersEnabled: body.enableReminders !== false,
      });
    } catch (error) {
      logger.error('Failed to schedule draft start', {
        draftId,
        leagueId: draft.leagueId,
        scheduledTime: body.scheduledTime,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse('Failed to schedule draft', 500);
    }

    return successResponse({
      id: draftId,
      scheduledTime: scheduledDate.toISOString(),
      timePerPick,
      status: 'scheduled',
      message: 'Draft rescheduled successfully',
    });
  } catch (error) {
    logger.error('Failed to update draft schedule', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to update draft schedule', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: LeagueParams
) {
  const { id: draftId } = params;
  try {

    // Find the draft
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!draft) {
      return errorResponse('Draft not found', 404);
    }

    if (draft.status !== DraftStatus.SCHEDULED) {
      return errorResponse('Can only cancel scheduled drafts', 400);
    }

    // Update draft to remove scheduling
    await prisma.$transaction(async (tx) => {
      // Update league settings to remove scheduled time
      if (draft.league?.settings) {
        await tx.leagueSettings.update({
          where: { id: draft.league.settings.id },
          data: {
            startAt: new Date(), // Set to now (immediate start)
          },
        });
      }

      // Update draft status to live
      await tx.draft.update({
        where: { id: draftId },
        data: {
          status: DraftStatus.LIVE,
          startedAt: new Date(),
        },
      });
    });

    logger.info('Draft schedule cancelled, draft started immediately', {
      draftId,
      leagueId: draft.leagueId,
    });

    return successResponse({
      id: draftId,
      status: 'live',
      message: 'Draft schedule cancelled, draft started immediately',
    });
  } catch (error) {
    logger.error('Failed to cancel draft schedule', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to cancel draft schedule', 500);
  }
}
