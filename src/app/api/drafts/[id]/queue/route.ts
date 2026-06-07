import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getDraftMembershipAccess } from '@/server/leagues/membership';

const QueuePostSchema = z.object({
  playerId: z.string().min(1),
  rank: z.coerce.number().int().positive().optional(),
});

const QueueDeleteQuerySchema = z.object({
  playerId: z.string().min(1),
});

const QueuePutSchema = z.object({
  queue: z.array(z.string().min(1)).default([]),
});

const queueEntrySelect = {
  id: true,
  draftId: true,
  memberId: true,
  playerId: true,
  rank: true,
  notes: true,
} as const;

async function resolveQueueMember(
  request: NextRequest,
  draftId: string
): Promise<{ memberId: string; userId: string } | Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return commonErrors.unauthorized();
  }

  const access = await getDraftMembershipAccess(draftId, userId);
  if (!access.isMember || !access.memberId) {
    return commonErrors.forbidden('Not a member of this draft');
  }

  return { memberId: access.memberId, userId };
}

function isInvalidDraftId(draftId: string): boolean {
  return typeof draftId !== 'string' || draftId.trim().length === 0;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id: draftId } = await params;
    if (isInvalidDraftId(draftId)) {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const access = await resolveQueueMember(request, draftId);
    if (access instanceof Response) {
      return access;
    }

    const json = await request.json().catch(() => null);
    const parsed = QueuePostSchema.safeParse(json);
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid request body', {
        issues: parsed.error.flatten(),
      });
    }

    const { playerId } = parsed.data;
    const memberId = access.memberId;

    const alreadyPicked = await prisma.pick.findFirst({
      where: { draftId, playerId },
      select: { id: true },
    });
    if (alreadyPicked) {
      return commonErrors.badRequest('Player already picked');
    }

    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, name: true, active: true },
    });
    if (!player?.active) {
      return commonErrors.badRequest('Player not found or not available');
    }

    const entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.preDraftQueue.findUnique({
        where: {
          draftId_memberId_playerId: {
            draftId,
            memberId,
            playerId,
          },
        },
        select: queueEntrySelect,
      });

      if (existing && parsed.data.rank === undefined) {
        return existing;
      }

      const rank =
        parsed.data.rank ??
        ((await tx.preDraftQueue.aggregate({
          where: { draftId, memberId },
          _max: { rank: true },
        }))._max.rank ?? 0) +
          1;

      return tx.preDraftQueue.upsert({
        where: {
          draftId_memberId_playerId: {
            draftId,
            memberId,
            playerId,
          },
        },
        update: { rank },
        create: { draftId, memberId, playerId, rank },
        select: queueEntrySelect,
      });
    });

    logger.info('Player added to queue', {
      draftId,
      memberId,
      playerId,
      playerName: player.name,
      rank: entry.rank,
    });

    return successResponse(entry, 201);
  } catch (error) {
    logger.error('Failed to add player to queue', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return errorResponse('Failed to add player to queue', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id: draftId } = await params;
    if (isInvalidDraftId(draftId)) {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const access = await resolveQueueMember(request, draftId);
    if (access instanceof Response) {
      return access;
    }

    const url = new URL(request.url);
    const parsed = QueueDeleteQuerySchema.safeParse({
      playerId: url.searchParams.get('playerId'),
    });
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid query params', {
        issues: parsed.error.flatten(),
      });
    }

    const { memberId } = access;
    const { playerId } = parsed.data;
    const deleted = await prisma.preDraftQueue.deleteMany({
      where: { draftId, memberId, playerId },
    });

    if (deleted.count === 0) {
      return commonErrors.notFound('Player not in queue');
    }

    logger.info('Player removed from queue', {
      draftId,
      memberId,
      playerId,
    });

    return successResponse({ message: 'Player removed from queue' });
  } catch (error) {
    logger.error('Failed to remove player from queue', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to remove player from queue', 500);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id: draftId } = await params;
    if (isInvalidDraftId(draftId)) {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const access = await resolveQueueMember(request, draftId);
    if (access instanceof Response) {
      return access;
    }

    const queueEntries = await prisma.preDraftQueue.findMany({
      where: { draftId, memberId: access.memberId },
      orderBy: { rank: 'asc' },
      include: {
        player: {
          select: { id: true, name: true, position: true, club: true, active: true },
        },
      },
    });

    logger.info('Queue retrieved', {
      draftId,
      memberId: access.memberId,
      queueSize: queueEntries.length,
    });

    return successResponse(queueEntries);
  } catch (error) {
    logger.error('Failed to get queue', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to get queue', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id: draftId } = await params;
    if (isInvalidDraftId(draftId)) {
      return commonErrors.badRequest('Missing or invalid draftId');
    }

    const access = await resolveQueueMember(request, draftId);
    if (access instanceof Response) {
      return access;
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = QueuePutSchema.safeParse(raw);
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid request body', {
        issues: parsed.error.flatten(),
      });
    }

    const memberId = access.memberId;
    const inputIds = Array.from(new Set(parsed.data.queue.map(String)));

    const { created, failedIds } = await prisma.$transaction(async (tx) => {
      const [activePlayers, alreadyPicked] = await Promise.all([
        tx.player.findMany({
          where: { id: { in: inputIds }, active: true },
          select: { id: true },
        }),
        tx.pick.findMany({
          where: { draftId, playerId: { in: inputIds } },
          select: { playerId: true },
        }),
      ]);

      const activeIds = new Set(activePlayers.map((player) => player.id));
      const pickedIds = new Set(alreadyPicked.map((pick) => pick.playerId));
      const availableIds = new Set(
        inputIds.filter((playerId) => activeIds.has(playerId) && !pickedIds.has(playerId))
      );

      await tx.preDraftQueue.deleteMany({ where: { draftId, memberId } });

      const created: Array<{
        id: string;
        draftId: string;
        memberId: string;
        playerId: string;
        rank: number;
        notes: string | null;
      }> = [];
      const failedIds: string[] = [];

      for (const playerId of inputIds) {
        if (!availableIds.has(playerId)) {
          failedIds.push(playerId);
          continue;
        }

        const entry = await tx.preDraftQueue.create({
          data: {
            draftId,
            memberId,
            playerId,
            rank: created.length + 1,
          },
          select: queueEntrySelect,
        });
        created.push(entry);
      }

      return { created, failedIds };
    });

    logger.info('Queue replaced', {
      draftId,
      memberId,
      size: created.length,
      failed: failedIds.length,
    });

    return successResponse({
      memberId,
      queue: created,
      failedIds,
    });
  } catch (error) {
    logger.error('Failed to replace queue', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to update queue', 500);
  }
}
