import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { createHash } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    // Strict id validation (Draft IDs are CUIDs per Prisma schema)
    if (!z.string().cuid().safeParse(id).success) {
      return errorResponse('Invalid draft id', 400);
    }

    // Parse query params (lean meta only cares about updatedSince)
    const url = new URL(request.url);
    const queryObj = Object.fromEntries(url.searchParams.entries());
    const QuerySchema = z.object({
      updatedSince: z.string().datetime().optional(),
    });
    const parsedQuery = QuerySchema.safeParse(queryObj);
    const updatedSince = parsedQuery.success ? parsedQuery.data.updatedSince : undefined;

    // Preflight: compute lastUpdated cheaply (no heavy includes)
    const [draftTimes, latestPick] = await Promise.all([
      prisma.draft.findUnique({
        where: { id },
        select: { createdAt: true, startedAt: true, completedAt: true },
      }),
      prisma.pick.findFirst({
        where: { draftId: id },
        select: { madeAt: true, overall: true },
        orderBy: { madeAt: 'desc' },
      }),
    ]);

    if (!draftTimes) {
      return errorResponse('Draft not found', 404);
    }

    const timestamps: number[] = [draftTimes.createdAt.getTime()];
    if (draftTimes.startedAt) timestamps.push(draftTimes.startedAt.getTime());
    if (draftTimes.completedAt) timestamps.push(draftTimes.completedAt.getTime());
    if (latestPick?.madeAt) timestamps.push(latestPick.madeAt.getTime());
    const lastUpdated = new Date(Math.max(...timestamps));

    // Build weak ETag from minimal state
    const etagBase = `${id}|meta|${lastUpdated.toISOString()}`;
    const etag = `W/"${createHash('sha1').update(etagBase).digest('hex')}"`;

    // Conditional: If-None-Match (supports comma-separated ETags and wildcard "*")
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch) {
      const raw = ifNoneMatch.trim();
      let isMatch = false;
      if (raw === '*') {
        isMatch = true;
      } else {
        const normalize = (t: string) => t.replace(/^W\/\s*/i, '').replace(/^"/, '').replace(/"$/, '');
        const clientTags = raw.split(',').map((t) => t.trim()).filter(Boolean);
        const computedTag = normalize(etag);
        isMatch = clientTags.some((t) => normalize(t) === computedTag);
      }
      if (isMatch) {
        const notModified = new Response(null, { status: 304 });
        notModified.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        notModified.headers.set('Pragma', 'no-cache');
        notModified.headers.set('Expires', '0');
        // Removed Surrogate-Control: no-store to allow client revalidation
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
        return notModified;
      }
    }

    // Conditional: updatedSince
    if (updatedSince) {
      const sinceDate = new Date(updatedSince);
      if (!Number.isNaN(sinceDate.getTime()) && lastUpdated <= sinceDate) {
        const notModified = new Response(null, { status: 304 });
        notModified.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        notModified.headers.set('Pragma', 'no-cache');
        notModified.headers.set('Expires', '0');
        // Removed Surrogate-Control: no-store to allow client revalidation
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
        return notModified;
      }
    }

    // Fetch lean meta (no players list, no picks list)
    const draft = await prisma.draft.findUnique({
      where: { id },
      include: {
        league: {
          select: {
            name: true,
            settings: { select: { draftType: true, pickSeconds: true } },
          },
        },
        orders: {
          select: {
            slot: true,
            member: {
              select: {
                id: true,
                userId: true,
                user: { select: { displayName: true } },
              },
            },
          },
          orderBy: { slot: 'asc' },
        },
      },
    });

    if (!draft) {
      return errorResponse('Draft not found', 404);
    }

    const picksCount = await prisma.pick.count({ where: { draftId: id } });

    const draftData = {
      id: draft.id,
      name: `${draft.league?.name || 'Draft'} - ${draft.status}`,
      leagueSize: draft.orders.length,
      draftType: draft.league?.settings?.draftType || 'SNAKE',
      timePerPick: draft.league?.settings?.pickSeconds || 120,
      status: draft.status,
      currentPick: draft.currentPick,
      totalPicks: draft.totalPicks,
      round: draft.round,
      direction: draft.direction,
      createdAt: draft.createdAt.toISOString(),
      startedAt: draft.startedAt?.toISOString(),
      completedAt: draft.completedAt?.toISOString(),
      participants: draft.orders.map((order) => ({
        slot: order.slot,
        member: {
          id: order.member.id,
          userId: order.member.userId,
          displayName: order.member.user.displayName,
        },
      })),
      // Summaries instead of heavy arrays
      picksSummary: {
        count: picksCount,
        latestOverall: latestPick?.overall ?? null,
      },
      lastUpdated: lastUpdated.toISOString(),
    } as const;

    logger.info('Draft meta retrieved', {
      draftId: id,
      status: draft.status,
      currentPick: draft.currentPick,
      totalPicks: draft.totalPicks,
      picksCount,
      lastUpdated: lastUpdated.toISOString(),
    });

    const response = successResponse(draftData);

    // Cache control + validators
    response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    // Removed Surrogate-Control: no-store to allow client revalidation
    response.headers.set('ETag', etag);
    response.headers.set('Last-Modified', lastUpdated.toUTCString());

    return response;
  } catch (error) {
    logger.error('Failed to retrieve draft', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to retrieve draft', 500);
  }
}
