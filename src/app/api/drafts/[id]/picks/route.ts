import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { handlePickCommand } from '@/server/draft/api/handlePickCommand';
import { buildDraftClockPayload } from '@/server/draft/services/DraftProjectionService';
import { z } from 'zod';
import { createHash } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return handlePickCommand(request, context.params);
}

// GET /api/drafts/[id]/picks
// Paginated picks list or incremental fetch by since timestamp
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string' || id.length < 10) {
      return errorResponse('Invalid draft id', 400);
    }

    const url = new URL(request.url);
    const queryObj = Object.fromEntries(url.searchParams.entries());
    const QuerySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(100),
      since: z.string().datetime().optional(), // ISO timestamp
      updatedSince: z.string().datetime().optional(),
    });

    // Strict validation: reject invalid queries with 400 and include issues
    const parsed = QuerySchema.safeParse(queryObj);
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400, 'BAD_REQUEST', {
        issues: parsed.error.issues,
      });
    }
    const { page, pageSize, since, updatedSince } = parsed.data;

    const skip = (page - 1) * pageSize;

    // Compute lastUpdated using latest pick and draft lifecycle
    const [latestPick, draftMeta] = await Promise.all([
      prisma.pick.findFirst({
        where: { draftId: id },
        select: { madeAt: true },
        orderBy: { madeAt: 'desc' },
      }),
      prisma.draft.findUnique({
        where: { id },
        select: {
          createdAt: true,
          startedAt: true,
          completedAt: true,
          currentPick: true,
          status: true,
          lobbyStatus: true,
          round: true,
          direction: true,
          pickStartedAt: true,
          pickDeadlineAt: true,
          pausedRemainingSeconds: true,
          schedulingVersion: true,
          league: {
            select: {
              settings: {
                select: { pickSeconds: true },
              },
            },
          },
        },
      }),
    ]);

    if (!draftMeta) {
      return errorResponse('Draft not found', 404);
    }

    const timestamps: number[] = [draftMeta.createdAt.getTime()];
    if (draftMeta.startedAt) timestamps.push(draftMeta.startedAt.getTime());
    if (draftMeta.completedAt) timestamps.push(draftMeta.completedAt.getTime());
    if (draftMeta.pickStartedAt) timestamps.push(draftMeta.pickStartedAt.getTime());
    if (draftMeta.pickDeadlineAt) timestamps.push(draftMeta.pickDeadlineAt.getTime());
    if (latestPick?.madeAt) timestamps.push(latestPick.madeAt.getTime());
    const lastUpdated = new Date(Math.max(...timestamps));

    // Timer state is part of the representation even when this page contains no new picks.
    const etagBase = [
      id,
      'picks',
      lastUpdated.toISOString(),
      draftMeta.status,
      draftMeta.lobbyStatus ?? '',
      draftMeta.schedulingVersion,
      draftMeta.pickStartedAt?.toISOString() ?? '',
      draftMeta.pickDeadlineAt?.toISOString() ?? '',
      draftMeta.pausedRemainingSeconds ?? '',
      page,
      pageSize,
      since || '',
    ].join('|');
    const etag = `W/"${createHash('sha1').update(etagBase).digest('hex')}"`;

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      const notModified = new Response(null, { status: 304 });
      notModified.headers.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      notModified.headers.set('ETag', etag);
      notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
      return notModified;
    }

    const conditionalSince = updatedSince || since;
    if (conditionalSince && draftMeta.status !== 'LIVE' && draftMeta.status !== 'PAUSED') {
      const sinceDate = new Date(conditionalSince);
      if (!Number.isNaN(sinceDate.getTime()) && lastUpdated <= sinceDate) {
        const notModified = new Response(null, { status: 304 });
        notModified.headers.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate'
        );
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
        return notModified;
      }
    }

    const where = since ? { draftId: id, madeAt: { gt: new Date(since) } } : { draftId: id };

    // Fetch list and total in parallel to avoid extra latency
    const [picks, totalCount] = await Promise.all([
      prisma.pick.findMany({
        where,
        include: {
          player: true,
          member: { include: { user: { select: { id: true, displayName: true } } } },
        },
        orderBy: { overall: 'asc' },
        skip,
        take: pageSize,
      }),
      prisma.pick.count({ where }),
    ]);

    const serverNow = new Date().toISOString();
    const clock = buildDraftClockPayload({
      status: draftMeta.status,
      lobbyStatus: draftMeta.lobbyStatus,
      revision: draftMeta.schedulingVersion,
      durationSeconds: draftMeta.league.settings.pickSeconds,
      serverNow,
      pickStartedAt: draftMeta.pickStartedAt,
      pickDeadlineAt: draftMeta.pickDeadlineAt,
      pausedRemainingSeconds: draftMeta.pausedRemainingSeconds,
    });
    const data = {
      draftId: id,
      serverNow,
      draftState: {
        currentPick: draftMeta.currentPick,
        status: draftMeta.status,
        round: draftMeta.round,
        direction: draftMeta.direction,
        pickStartedAt: draftMeta.pickStartedAt?.toISOString() ?? null,
        pickDeadlineAt: draftMeta.pickDeadlineAt?.toISOString() ?? null,
        pausedRemainingSeconds: draftMeta.pausedRemainingSeconds,
        schedulingVersion: draftMeta.schedulingVersion,
        clock,
      },
      picks: picks.map((pick) => ({
        id: pick.id,
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        auto: pick.auto,
        madeAt: pick.madeAt.toISOString(),
        player: {
          id: pick.player.id,
          name: pick.player.name,
          position: pick.player.position,
          club: pick.player.club,
        },
        member: { id: pick.member.id, displayName: pick.member.user.displayName },
      })),
      pagination: {
        page,
        pageSize,
        skip,
        totalCount,
        hasMore: picks.length === pageSize,
        since: since || null,
      },
      lastUpdated: lastUpdated.toISOString(),
    };

    const response = successResponse(data);
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');
    response.headers.set('ETag', etag);
    response.headers.set('Last-Modified', lastUpdated.toUTCString());

    logger.info('Draft picks retrieved', {
      draftId: id,
      page,
      pageSize,
      count: picks.length,
      totalCount,
      since,
    });
    return response;
  } catch (error) {
    logger.error('Failed to retrieve draft picks', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return errorResponse('Failed to retrieve draft picks', 500);
  }
}
