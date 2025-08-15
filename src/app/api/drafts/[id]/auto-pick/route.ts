import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftDirection, DraftStatus } from '@prisma/client';

/**
 * Auto-pick endpoint for timer expiry
 * Priority: 1. Queue item, 2. Best available player
 */

function calculateSnakeLogic(currentPick: number, teamCount: number) {
  const round = Math.ceil(currentPick / teamCount);
  const direction = round % 2 === 1 ? DraftDirection.FORWARD : DraftDirection.REVERSE;

  let slot: number;
  if (direction === DraftDirection.FORWARD) {
    slot = ((currentPick - 1) % teamCount) + 1;
  } else {
    slot = teamCount - ((currentPick - 1) % teamCount);
  }

  return { round, direction, slot };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;

    // Get draft with all necessary data
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
            members: true,
          },
        },
        orders: {
          orderBy: { slot: 'asc' },
        },
        picks: {
          orderBy: { overall: 'asc' },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    if (draft.status !== DraftStatus.LIVE) {
      return commonErrors.badRequest('Draft is not active');
    }

    const { league } = draft;
    if (!league?.settings) {
      return commonErrors.badRequest('Draft settings not found');
    }

    // Check if auto-pick is allowed
    if (!league.settings.allowAutoPick) {
      return commonErrors.badRequest('Auto-pick is not allowed');
    }

    const teamCount = league.members.length;
    const rosterSize = league.settings.rosterSize + league.settings.benchSize;
    const totalPicks = teamCount * rosterSize;

    // Validate draft is not complete
    if (draft.currentPick > totalPicks) {
      return commonErrors.badRequest('Draft is already complete');
    }

    // Calculate snake logic for current pick
    const { round, direction, slot } = calculateSnakeLogic(draft.currentPick, teamCount);

    // Find the member who should be picking
    const draftOrder = draft.orders.find((order) => order.slot === slot);
    if (!draftOrder) {
      return commonErrors.badRequest('Invalid draft order');
    }

    const memberId = draftOrder.memberId;

    // Get picked player IDs to exclude
    const pickedPlayerIds = draft.picks.map((pick) => pick.playerId);

    // Try to find a queued player first
    let selectedPlayerId: string | null = null;
    const queueItem = await prisma.queueItem.findFirst({
      where: {
        memberId,
        playerId: {
          notIn: pickedPlayerIds,
        },
      },
    });

    if (queueItem) {
      // Verify the queued player is still active
      const queuedPlayer = await prisma.player.findUnique({
        where: { id: queueItem.playerId },
      });

      if (queuedPlayer && queuedPlayer.active) {
        selectedPlayerId = queueItem.playerId;
      }
    }

    // If no queue item, pick best available player
    if (!selectedPlayerId) {
      const bestAvailable = await prisma.player.findFirst({
        where: {
          id: {
            notIn: pickedPlayerIds,
          },
          active: true,
        },
        orderBy: [
          { position: 'asc' }, // Priority order: MID, FWD, DEF, RUC
          { name: 'asc' }, // Then alphabetical
        ],
      });

      if (!bestAvailable) {
        return commonErrors.badRequest('No available players to auto-pick');
      }

      selectedPlayerId = bestAvailable.id;
    }

    // Execute the auto-pick in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the pick
      const pick = await tx.pick.create({
        data: {
          draftId,
          overall: draft.currentPick,
          round,
          slot,
          memberId,
          playerId: selectedPlayerId!,
          auto: true, // Auto-pick
        },
        include: {
          player: true,
          member: {
            include: {
              user: true,
            },
          },
        },
      });

      // Remove from queue if it was queued
      if (queueItem) {
        await tx.queueItem.delete({
          where: { id: queueItem.id },
        });
      }

      // Calculate next pick state
      const nextPick = draft.currentPick + 1;
      const isComplete = nextPick > totalPicks;

      interface DraftUpdateData {
        currentPick: number;
        status?: DraftStatus;
        completedAt?: Date;
        round?: number;
        direction?: DraftDirection;
      }

      let updateData: DraftUpdateData = {
        currentPick: nextPick,
      };

      if (isComplete) {
        updateData.status = DraftStatus.COMPLETED;
        updateData.completedAt = new Date();
      } else {
        // Calculate next round/direction for the upcoming pick
        const nextState = calculateSnakeLogic(nextPick, teamCount);
        updateData.round = nextState.round;
        updateData.direction = nextState.direction;
      }

      // Update draft state
      await tx.draft.update({
        where: { id: draftId },
        data: updateData,
      });

      return { pick, isComplete, nextPick };
    });

    logger.info('Auto-pick made successfully', {
      draftId,
      pickNumber: draft.currentPick,
      round,
      slot,
      direction,
      playerId: selectedPlayerId,
      playerName: result.pick.player.name,
      memberId,
      wasQueued: !!queueItem,
      isComplete: result.isComplete,
    });

    return successResponse({
      pick: result.pick,
      currentPick: result.nextPick,
      isComplete: result.isComplete,
      nextTurn: result.isComplete ? null : calculateSnakeLogic(result.nextPick, teamCount),
      wasQueued: !!queueItem,
    });
  } catch (error) {
    logger.error('Failed to auto-pick', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to auto-pick', 500);
  }
}
