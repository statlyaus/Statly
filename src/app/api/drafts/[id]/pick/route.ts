import { revalidateTag } from 'next/cache';

import { DraftDirection, DraftStatus } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import { z } from 'zod';

import type { NextRequest } from 'next/server';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { isValidLeagueId } from '@/lib/validation';
import { getLiveDraftEngine, type LiveDraftPick } from '@/services/liveDraftEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Snake Draft Logic Implementation
 * - N = team count; R = rosterSize + benchSize; totalPicks = N * R
 * - round = ceil(currentPick / N)
 * - direction = (round % 2 === 1) ? FORWARD : REVERSE
 * - slot = direction === FORWARD ? ((currentPick-1) % N) + 1 : N - ((currentPick-1) % N)
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

type TxResult =
  | {
      pick: { player: { id: string; name: string } };
      isComplete: boolean;
      nextPick: number;
      idempotent: true;
      leagueId: string;
    }
  | {
      pick: { player: { id: string; name: string } };
      isComplete: boolean;
      nextPick: number;
      eventPick: LiveDraftPick;
      leagueId: string;
    };

// Helper type for Prisma include
// Align with the exact include shape used in the query to avoid unsafe assertions
type PickWithRelations = PrismaNS.PickGetPayload<{
  include: {
    player: { select: { id: true; name: true; position: true; club: true } };
    member: { include: { user: { select: { id: true; displayName: true; email: true } } } };
  };
}>;

export async function POST(request: NextRequest, context: any) {
  // Capture request-scoped context for error logs
  const requestContext: { draftId?: string; userId?: string; hasSessionCookie?: boolean } = {};
  const headerRequestId =
    request.headers.get('x-request-id') ?? request.headers.get('x-requestid') ?? undefined;
  const headerCorrelationId = request.headers.get('x-correlation-id') ?? undefined;

  try {
    const draftId = ((await context?.params)?.id ??
      (Array.isArray((await context?.params)?.id) ? (await context.params).id[0] : undefined)) as
      | string
      | undefined;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }
    requestContext.draftId = draftId;

    // Derive user from request using standardized auth helper
    let userId = await getUserIdFromRequest(request);
    requestContext.hasSessionCookie = Boolean(request.cookies.get('statly_session')?.value);

    // In development, allow override using x-dev-user-id header to facilitate local testing
    if (!userId && process.env.NODE_ENV !== 'production') {
      const devUser = request.headers.get('x-dev-user-id');
      if (devUser) {
        userId = devUser;
      }
    }

    if (!userId) {
      logger.warn('Draft pick request failed (unauthorized)', {
        method: request.method,
        url: request.url,
        draftId: requestContext.draftId,
        requestId: headerRequestId,
        correlationId: headerCorrelationId,
        kind: 'unauthorized',
        detail: 'Missing or invalid authentication',
      });
      return errorResponse('Unauthorized', 401);
    }

    requestContext.userId = userId;

    // Validate body
    const body = await request.json();
    const Schema = z.object({
      playerId: z.string().min(1),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid request body');
    }
    const { playerId } = parsed.data;

    // Perform the entire operation atomically in a transaction
    const result = await prisma.$transaction<TxResult>(
      async (tx) => {
        // Re-read the draft within the transaction for up-to-date state
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

        // Map authenticated user -> league memberId
        const devOverrideUserId =
          process.env.NODE_ENV !== 'production'
            ? request.headers.get('x-dev-user-id') || undefined
            : undefined;
        const effectiveUserId = devOverrideUserId || userId;
        const actingMember = draft.league.members.find((m) => m.userId === effectiveUserId);
        if (!actingMember) throw new Error('forbidden:Not a member of this league');

        const teamCount = draft.league.members.length;
        const rosterSize = draft.league.settings.rosterSize + draft.league.settings.benchSize;
        const totalPicks = teamCount * rosterSize;
        if (draft.currentPick > totalPicks)
          throw new Error('bad_request:Draft is already complete');

        const { round, slot } = calculateSnakeLogic(draft.currentPick, teamCount);
        const draftOrder = draft.orders.find((order) => order.slot === slot);
        if (!draftOrder) throw new Error('bad_request:Invalid draft order');
        if (draftOrder.memberId !== actingMember.id)
          throw new Error('bad_request:Not your turn to pick');

        // Validate player exists and is active
        const player = await tx.player.findUnique({ where: { id: playerId } });
        if (!player || !player.active)
          throw new Error('bad_request:Player not found or not available');

        // Validate roster size (soft check; DB unique constraints enforce conflicts too)
        const memberPicks = draft.picks.filter((p) => p.memberId === actingMember.id);
        if (memberPicks.length >= rosterSize) throw new Error('bad_request:Roster is full');

        // Attempt to create the pick. Rely on unique constraints for idempotency and race-safety.
        let pick: PickWithRelations;
        try {
          const created = await tx.pick.create({
            data: {
              draftId,
              overall: draft.currentPick,
              round,
              slot,
              memberId: actingMember.id,
              playerId,
              auto: false,
            },
            include: {
              player: { select: { id: true, name: true, position: true, club: true } },
              member: {
                include: { user: { select: { id: true, displayName: true, email: true } } },
              },
            },
          });
          pick = created;
        } catch (e) {
          if (e instanceof PrismaNS.PrismaClientKnownRequestError && e.code === 'P2002') {
            // Unique constraint violation -> idempotency or player already picked.
            const existing = await tx.pick.findUnique({
              where: { draftId_overall: { draftId, overall: draft.currentPick } },
              include: { player: { select: { id: true, name: true } } },
            });
            if (existing && existing.player) {
              const minimal = {
                pick: { player: { id: existing.player.id, name: existing.player.name } },
              } as const;
              return {
                ...minimal,
                isComplete: draft.currentPick + 1 > totalPicks,
                nextPick: Math.min(draft.currentPick + 1, totalPicks + 1),
                idempotent: true as const,
                leagueId: draft.leagueId ?? draft.league?.id ?? '',
              };
            }
            throw new Error('bad_request:Player already picked');
          }
          throw e;
        }

        // Remove from queue if it was queued
        const queueItem = await tx.queueItem.findFirst({
          where: { memberId: actingMember.id, playerId },
        });
        if (queueItem) {
          await tx.queueItem.delete({ where: { id: queueItem.id } });
        }

        // Calculate and persist next pick state guarded on currentPick and status
        const nextPick = draft.currentPick + 1;
        const isComplete = nextPick > totalPicks;
        const updateData: {
          currentPick: number;
          status?: DraftStatus;
          completedAt?: Date;
          round?: number;
          direction?: DraftDirection;
        } = {
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

        if (updated.count !== 1) {
          throw new Error('conflict:Draft state changed');
        }

        // Build event payload for real-time broadcasting
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
            id: actingMember.id,
            displayName,
          },
          auto: false,
          madeAt: new Date().toISOString(),
          timestamp: new Date(),
        };

        return {
          pick: { player: { id: pick.player.id, name: pick.player.name } },
          isComplete,
          nextPick,
          eventPick,
          leagueId: draft.leagueId ?? draft.league?.id ?? '',
        };
      },
      { timeout: 20000 }
    );

    async function revalidateDraftAndLeague(leagueId?: string) {
      if (!isValidLeagueId(leagueId)) return;
      await Promise.allSettled([
        revalidateTag(`draft:${draftId}`),
        revalidateTag(tags.league(leagueId!)),
      ]);
    }

    if ('idempotent' in result && result.idempotent) {
      logger.info('Pick request idempotently satisfied', {
        draftId: requestContext.draftId,
        pickNumber: result.nextPick - 1,
        playerId: result.pick.player.id,
        userId: requestContext.userId,
      });
      try {
        const leagueId = result.leagueId;
        await revalidateDraftAndLeague(leagueId);
      } catch (revalErr) {
        logger.warn('Failed to revalidate tags for draft pick (idempotent)', {
          draftId: requestContext.draftId,
          leagueId: result.leagueId,
          error:
            revalErr instanceof Error
              ? { name: revalErr.name, message: revalErr.message, stack: revalErr.stack }
              : undefined,
        });
      }
      return successResponse({
        pick: result.pick,
        currentPick: result.nextPick,
        isComplete: result.isComplete,
        nextTurn: result.isComplete ? null : undefined,
        idempotent: true,
      });
    }

    // Emit real-time event via Live Draft Engine listeners
    try {
      if ('eventPick' in result && result.eventPick) {
        if (requestContext.draftId) {
          getLiveDraftEngine().emit('draft:pick-made', requestContext.draftId, result.eventPick);
        } else {
          logger.error('Missing draftId in request context for event emission');
        }
      }
    } catch (emitError) {
      logger.warn('Failed to emit live draft event for pick', {
        draftId: requestContext.draftId,
        error: emitError,
      });
    }

    logger.info('Pick made successfully', {
      draftId: requestContext.draftId,
      pickNumber: result.nextPick - 1,
      playerId,
      playerName: result.pick.player.name,
      userId: requestContext.userId,
      isComplete: result.isComplete,
    });

    try {
      const leagueId = result.leagueId;
      await revalidateDraftAndLeague(leagueId);
    } catch (revalErr) {
      logger.warn('Failed to revalidate tags for draft pick', {
        draftId: requestContext.draftId,
        leagueId: result.leagueId,
        error:
          revalErr instanceof Error
            ? { name: revalErr.name, message: revalErr.message, stack: revalErr.stack }
            : undefined,
      });
    }
    return successResponse({
      pick: result.pick,
      currentPick: result.nextPick,
      isComplete: result.isComplete,
      nextTurn: result.isComplete ? null : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const [kind, detail] = msg.includes(':') ? msg.split(':', 2) : ['internal', msg];

    // Structured error context for searchability
    const logBase = {
      method: request.method,
      url: request.url,
      draftId: requestContext.draftId,
      userId: requestContext.userId,
      hasSessionCookie: requestContext.hasSessionCookie,
      requestId: headerRequestId,
      correlationId: headerCorrelationId,
      kind,
      detail,
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: msg,
        stack: error instanceof Error ? error.stack : undefined,
      },
    } as const;

    if (kind === 'not_found') {
      logger.warn('Draft pick request failed (not_found)', logBase);
      return commonErrors.notFound(detail);
    }
    if (kind === 'bad_request') {
      logger.warn('Draft pick request failed (bad_request)', logBase);
      return commonErrors.badRequest(detail);
    }
    if (kind === 'conflict') {
      logger.warn('Draft pick request failed (conflict)', logBase);
      return errorResponse(detail || 'Draft state changed', 409);
    }
    if (kind === 'forbidden') {
      logger.warn('Draft pick request failed (forbidden)', logBase);
      return errorResponse(detail || 'Forbidden', 403);
    }

    logger.error('Failed to make pick', logBase);

    return errorResponse('Failed to make pick', 500);
  }
}
