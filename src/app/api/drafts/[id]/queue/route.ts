import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

const QueueRequestSchema = z.object({
  playerId: z.string().min(1),
  memberId: z.string().min(1),
  rank: z.coerce.number().int().positive().optional(),
});

type _QueueRequest = z.infer<typeof QueueRequestSchema>;

// Bulk update schema: full ordered queue for the authenticated member in this draft's league
const QueuePutSchema = z.object({
  queue: z.array(z.string().min(1)).default([]),
});

async function authenticateAndAuthorize(draftId: string, memberId: string) {
  // Verify user authentication
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('statly_session')?.value;
  if (!sessionCookie) {
    throw errorResponse('Unauthorized', 401);
  }

  let userId: string;
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    userId = decoded.uid;
  } catch {
    throw errorResponse('Unauthorized', 401);
  }

  // Verify draft exists
  const draft = await prisma.draft.findUnique({ where: { id: draftId } });
  if (!draft) {
    throw commonErrors.notFound('Draft not found');
  }

  // Verify member belongs to the draft's league and to the authenticated user
  const membership = await prisma.leagueMember.findFirst({
    where: { id: memberId, leagueId: draft.leagueId, userId },
  });
  if (!membership) {
    throw commonErrors.forbidden('Not a member of this draft');
  }

  return { draft, userId } as const;
}

// Resolve the authenticated user and their LeagueMember for this draft
async function authenticateAndResolveMember(draftId: string) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('statly_session')?.value;
  if (!sessionCookie) throw commonErrors.unauthorized();

  let userId: string;
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    userId = decoded.uid;
  } catch {
    throw commonErrors.unauthorized();
  }

  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    include: { league: { include: { members: true } } },
  });
  if (!draft) throw commonErrors.notFound('Draft not found');
  const member = draft.league?.members.find((m) => m.userId === userId);
  if (!member) throw commonErrors.forbidden('Not a member of this draft');
  return { draft, userId, member } as const;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const json = await request.json().catch(() => null);
    const parsed = QueueRequestSchema.safeParse(json);
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid request body', { issues: parsed.error.flatten() });
    }
    const { playerId, memberId } = parsed.data;
    let { rank } = parsed.data;

    // Authn + Authz
    const { draft } = await authenticateAndAuthorize(draftId, memberId);

    // Check if player already picked in this draft
    const alreadyPicked = await prisma.pick.findFirst({ where: { draftId: draft.id, playerId } });
    if (alreadyPicked) {
      return commonErrors.badRequest('Player already picked');
    }

    // Verify player exists and is active
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player || !player.active) {
      return commonErrors.badRequest('Player not found or not available');
    }

    // Determine and create rank atomically
    const queueItem = await prisma.$transaction(async (tx) => {
      if (!rank) {
        const maxRank = await tx.queueItem.aggregate({ _max: { rank: true }, where: { memberId } });
        const rankToUse = (maxRank._max.rank || 0) + 1;
        return tx.queueItem.create({ data: { memberId, playerId, rank: rankToUse } });
      }
      try {
        return await tx.queueItem.create({ data: { memberId, playerId, rank } });
      } catch (e) {
        const err = e as Prisma.PrismaClientKnownRequestError;
        if (err.code === 'P2002') {
          throw commonErrors.badRequest('Rank already in use');
        }
        throw e;
      }
    });

    logger.info('Player added to queue', { draftId, memberId, playerId, playerName: player.name, rank: queueItem.rank });

    return successResponse(queueItem, 201);
  } catch (error) {
    if (error instanceof Response) return error as Response; // early errorResponse from auth
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
) {
  try {
    const { id: draftId } = await params;
    const url = new URL(request.url);
    const QuerySchema = z.object({ playerId: z.string().min(1), memberId: z.string().min(1) });
    const parsed = QuerySchema.safeParse({
      playerId: url.searchParams.get('playerId'),
      memberId: url.searchParams.get('memberId'),
    });
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid query params', { issues: parsed.error.flatten() });
    }
    const { playerId, memberId } = parsed.data;

    await authenticateAndAuthorize(draftId, memberId);

    // Find and delete queue item
    const queueItem = await prisma.queueItem.findFirst({
      where: {
        memberId,
        playerId,
      },
    });

    if (!queueItem) {
      return commonErrors.notFound('Player not in queue');
    }

    await prisma.queueItem.delete({ where: { id: queueItem.id } });

    logger.info('Player removed from queue', {
      draftId,
      memberId,
      playerId,
    });

    return successResponse({ message: 'Player removed from queue' });
  } catch (error) {
    if (error instanceof Response) return error as Response;
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }
    const url = new URL(request.url);
    const QuerySchema = z.object({ memberId: z.string().min(1) });
    const parsed = QuerySchema.safeParse({ memberId: url.searchParams.get('memberId') });
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid query params', { issues: parsed.error.flatten() });
    }
    const { memberId } = parsed.data;

    await authenticateAndAuthorize(draftId, memberId);

    // Get member's queue
    const queueItems = await prisma.queueItem.findMany({
      where: { memberId },
      orderBy: { rank: 'asc' },
      select: { id: true, memberId: true, playerId: true, rank: true },
    });

    // Batch fetch player details to avoid N+1 queries
    const playerIds = Array.from(new Set(queueItems.map((q) => q.playerId)));
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, name: true, position: true, club: true, active: true },
    });
    const playerMap = new Map(players.map((p) => [p.id, p] as const));

    const queueWithPlayers = queueItems.map((item) => ({
      ...item,
      player: playerMap.get(item.playerId) || null,
    }));

    logger.info('Queue retrieved', { draftId, memberId, queueSize: queueWithPlayers.length });

    return successResponse(queueWithPlayers);
  } catch (error) {
    if (error instanceof Response) return error as Response;
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

// PUT /api/drafts/[id]/queue - Replace the user's queue with provided order
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return commonErrors.badRequest('Missing or invalid draftId');
    }

    // Authenticate and resolve member for this draft
    const { member } = await authenticateAndResolveMember(draftId);

    // Parse body
    const raw = await request.json().catch(() => ({}));
    const parsed = QueuePutSchema.safeParse(raw);
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid request body', { issues: parsed.error.flatten() });
    }
    const inputIds = Array.from(new Set(parsed.data.queue.map(String)));

    // Replace queue atomically
    const { created, failedIds } = await prisma.$transaction(async (tx) => {
      await tx.queueItem.deleteMany({ where: { memberId: member.id } });
      const created: Array<{ id: string; playerId: string; rank: number }> = [];
      const failedIds: string[] = [];
      for (let i = 0; i < inputIds.length; i++) {
        const pid = inputIds[i];
        try {
          const q = await tx.queueItem.create({
            data: { memberId: member.id, playerId: pid, rank: i + 1 },
            select: { id: true, playerId: true, rank: true },
          });
          created.push(q);
        } catch (_e) {
          failedIds.push(pid);
        }
      }
      return { created, failedIds };
    });

    logger.info('Queue replaced', { draftId, memberId: member.id, size: created.length, failed: failedIds.length });

    return successResponse({
      memberId: member.id,
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