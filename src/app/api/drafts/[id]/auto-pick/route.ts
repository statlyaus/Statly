import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftDirection, DraftStatus } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import { getLiveDraftEngine } from '@/services/liveDraftEngine';
import type { LiveDraftPick } from '@/services/liveDraftEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

// Make auto-pick atomic and idempotent

// Shared fields for auto-pick transaction result
type AutoPickBase = {
  pick: { player: { id: string; name: string } };
  isComplete: boolean;
  nextPick: number;
  wasQueued: boolean;
  round: number;
  slot: number;
  direction: DraftDirection;
};

// Variant returned when an existing pick already covers this turn
type IdempotentAutoPickResult = AutoPickBase & {
  idempotent: true;
  id: string; // existing pick id
};

// Variant returned when a new pick is created and an event should be emitted
type EventAutoPickResult = AutoPickBase & {
  eventPick: LiveDraftPick;
};

type TxResult = IdempotentAutoPickResult | EventAutoPickResult;

// Helper type for Prisma include
type PickWithRelations = {
  id: string;
  overall: number;
  round: number;
  slot: number;
  auto: boolean;
  memberId: string;
  player: { id: string; name: string; position: string | null; club: string | null };
  member: { id: string; user: { id: string; displayName: string | null; email: string | null } };
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: draftId } = params;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const result = await prisma.$transaction<TxResult>(async (tx) => {
      // Get draft state within transaction
      const draft = await tx.draft.findUnique({
        where: { id: draftId },
        include: {
          league: { include: { settings: true, members: true } },
          orders: { orderBy: { slot: 'asc' } },
          picks: { orderBy: { overall: 'asc' } },
        },
      });

      if (!draft) throw new Error('not_found:Draft not found');
      if (draft.status !== DraftStatus.LIVE) throw new Error('bad_request:Draft is not active');
      if (!draft.league?.settings) throw new Error('bad_request:Draft settings not found');
      if (!draft.league.settings.allowAutoPick) throw new Error('bad_request:Auto-pick is not allowed');

      const teamCount = draft.league.members.length;
      const rosterSize = draft.league.settings.rosterSize + draft.league.settings.benchSize;
      const totalPicks = teamCount * rosterSize;

      if (draft.currentPick > totalPicks) throw new Error('bad_request:Draft is already complete');

      // Calculate who should pick now
      const { round, direction, slot } = calculateSnakeLogic(draft.currentPick, teamCount);
      const draftOrder = draft.orders.find((order) => order.slot === slot);
      if (!draftOrder) throw new Error('bad_request:Invalid draft order');
      const memberId = draftOrder.memberId;

      // Gather picked players to exclude
      const pickedPlayerIds = draft.picks.map((pick) => pick.playerId);

      // Prefer queued player
      const queueItem = await tx.queueItem.findFirst({
        where: {
          memberId,
          playerId: { notIn: pickedPlayerIds },
        },
        orderBy: { rank: 'asc' },
      });

      let selectedPlayerId: string | null = null;
      if (queueItem) {
        const queuedPlayer = await tx.player.findUnique({ where: { id: queueItem.playerId } });
        if (queuedPlayer?.active) selectedPlayerId = queueItem.playerId;
      }

      // Otherwise best available
      if (!selectedPlayerId) {
        const bestAvailable = await tx.player.findFirst({
          where: { id: { notIn: pickedPlayerIds }, active: true },
          orderBy: [
            { position: 'asc' },
            { name: 'asc' },
          ],
        });
        if (!bestAvailable) throw new Error('bad_request:No available players to auto-pick');
        selectedPlayerId = bestAvailable.id;
      }

      // Create pick relying on DB unique constraints for safety/idempotency
      let pick: PickWithRelations;
      try {
        const created = await tx.pick.create({
          data: {
            draftId,
            overall: draft.currentPick,
            round,
            slot,
            memberId,
            playerId: selectedPlayerId,
            auto: true,
          },
          include: {
            player: { select: { id: true, name: true, position: true, club: true } },
            member: { include: { user: { select: { id: true, displayName: true, email: true } } } },
          },
        });
        pick = created as unknown as PickWithRelations;
      } catch (e) {
        if (e instanceof PrismaNS.PrismaClientKnownRequestError && e.code === 'P2002') {
          // If pick for this overall already exists, treat as idempotent
          const existing = await tx.pick.findUnique({
            where: { draftId_overall: { draftId, overall: draft.currentPick } },
            include: { player: { select: { id: true, name: true } }, member: { include: { user: { select: { id: true, displayName: true, email: true } } } } },
          });
          if (existing) {
            const idempotentResult: IdempotentAutoPickResult = {
              pick: { player: { id: existing.player!.id, name: existing.player!.name } },
              isComplete: draft.currentPick + 1 > totalPicks,
              nextPick: Math.min(draft.currentPick + 1, totalPicks + 1),
              wasQueued: Boolean(queueItem),
              idempotent: true as const,
              id: existing.id,
              round,
              slot,
              direction,
            };
            return idempotentResult;
          }
          throw new Error('bad_request:Player already picked');
        }
        throw e;
      }

      // Cleanup queue item if used
      if (queueItem) {
        await tx.queueItem.delete({ where: { id: queueItem.id } });
      }

      // Advance draft guarded by currentPick and status
      const nextPick = draft.currentPick + 1;
      const isComplete = nextPick > totalPicks;
      const updateData: { currentPick: number; status?: DraftStatus; completedAt?: Date; round?: number; direction?: DraftDirection } = {
        currentPick: nextPick,
      };
      if (isComplete) {
        updateData.status = DraftStatus.COMPLETED;
        updateData.completedAt = new Date();
      } else {
        const nextState = calculateSnakeLogic(nextPick, teamCount);
        updateData.round = nextState.round;
        updateData.direction = nextState.direction;
      }

      const updated = await tx.draft.updateMany({
        where: { id: draftId, status: DraftStatus.LIVE, currentPick: draft.currentPick },
        data: updateData,
      });
      if (updated.count !== 1) throw new Error('conflict:Another pick was made concurrently');

      // Build event payload
      const displayName = pick.member.user.displayName || pick.member.user.email || 'Unknown';
      const eventPick: LiveDraftPick = {
        id: pick.id,
        overall: draft.currentPick,
        round,
        slot,
        player: {
          id: pick.player.id,
          name: pick.player.name,
          position: pick.player.position ?? 'NA',
          club: pick.player.club ?? 'NA',
        },
        member: {
          id: memberId,
          displayName,
        },
        auto: true,
        madeAt: new Date().toISOString(),
        timestamp: new Date(),
      };

      const finalResult: EventAutoPickResult = {
        pick: { player: { id: pick.player.id, name: pick.player.name } },
        isComplete,
        nextPick,
        wasQueued: Boolean(queueItem),
        round,
        slot,
        direction,
        eventPick,
      };
      return finalResult;
    }, { timeout: 20000 });

    logger.info('Auto-pick made successfully', {
      draftId,
      pickNumber: result.nextPick - 1,
      round: result.round,
      slot: result.slot,
      direction: result.direction,
      playerId: result.pick.player.id,
      memberId: undefined,
      wasQueued: result.wasQueued,
      isComplete: result.isComplete,
      idempotent: 'idempotent' in result && result.idempotent,
    });

    // Emit real-time event when not idempotent
    if (!('idempotent' in result && result.idempotent)) {
      try {
        if ('eventPick' in result) {
          const withEvent = result as EventAutoPickResult;
          getLiveDraftEngine().emit('draft:auto-pick', draftId, withEvent.eventPick);
        }
      } catch (emitError) {
        logger.warn('Failed to emit live draft event for auto-pick', { draftId, error: emitError });
      }
    }

    return successResponse({
      pick: result.pick,
      currentPick: result.nextPick,
      isComplete: result.isComplete,
      nextTurn: result.isComplete ? null : undefined,
      wasQueued: result.wasQueued,
      idempotent: 'idempotent' in result && result.idempotent,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const [kind, detail] = msg.includes(':') ? msg.split(':', 2) : ['internal', msg];

    if (kind === 'not_found') return commonErrors.notFound(detail);
    if (kind === 'bad_request') return commonErrors.badRequest(detail);
    if (kind === 'conflict') return errorResponse(detail || 'Draft state changed', 409);

    logger.error('Failed to auto-pick', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: msg,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to auto-pick', 500);
  }
}
