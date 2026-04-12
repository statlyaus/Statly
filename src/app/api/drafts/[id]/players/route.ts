import { createHash } from 'crypto';

import type { NextRequest } from 'next/server';

import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Allowed AFL positions for validation
const VALID_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;

// GET /api/drafts/[id]/players
// Paginated available players for a draft with filtering
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string' || id.length < 10) {
      return errorResponse('Invalid draft id', 400);
    }

    const url = new URL(request.url);
    const queryObj = Object.fromEntries(url.searchParams.entries());
    const QuerySchema = z.object({
      q: z.string().trim().min(1).max(100).optional(),
      position: z.enum(VALID_POSITIONS).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      updatedSince: z.string().datetime().optional(),
    });

    const parsedQuery = QuerySchema.safeParse(queryObj);
    if (!parsedQuery.success) {
      const issues = parsedQuery.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      }));
      logger.warn('Invalid draft players query parameters', {
        draftId: id,
        query: queryObj,
        issues,
      });
      return errorResponse('Invalid query parameters', 400, 'BAD_REQUEST', {
        query: queryObj,
        issues,
      });
    }
    const { q, position, page, pageSize, updatedSince } = parsedQuery.data;

    const skip = (page - 1) * pageSize;

    // Compute lastUpdated using latest pick in this draft and draft lifecycle timestamps
    const [latestPick, draftMeta] = await Promise.all([
      prisma.pick.findFirst({
        where: { draftId: id },
        select: { madeAt: true },
        orderBy: { madeAt: 'desc' },
      }),
      prisma.draft.findUnique({
        where: { id },
        select: { createdAt: true, startedAt: true, completedAt: true },
      }),
    ]);

    if (!draftMeta) {
      return errorResponse('Draft not found', 404);
    }

    const timestamps: number[] = [draftMeta.createdAt.getTime()];
    if (draftMeta.startedAt) timestamps.push(draftMeta.startedAt.getTime());
    if (draftMeta.completedAt) timestamps.push(draftMeta.completedAt.getTime());
    if (latestPick?.madeAt) timestamps.push(latestPick.madeAt.getTime());
    const lastUpdated = new Date(Math.max(...timestamps));

    // Build weak ETag including filters and pagination window
    const etagBase = `${id}|players|${lastUpdated.toISOString()}|${q || ''}|${position || ''}|${page}|${pageSize}`;
    const etag = `W/"${createHash('sha1').update(etagBase).digest('hex')}"`;

    // Fast 304 on If-None-Match (supports comma-separated ETags and wildcard "*")
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch) {
      const raw = ifNoneMatch.trim();
      let isMatch = false;
      if (raw === '*') {
        isMatch = true;
      } else {
        const normalize = (t: string) =>
          t
            .replace(/^W\/\s*/i, '')
            .replace(/^"/, '')
            .replace(/"$/, '');
        const clientTags = raw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const computedTag = normalize(etag);
        isMatch = clientTags.some((t) => normalize(t) === computedTag);
      }
      if (isMatch) {
        const notModified = new Response(null, { status: 304 });
        notModified.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        notModified.headers.set('Pragma', 'no-cache');
        notModified.headers.set('Expires', '0');
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
        return notModified;
      }
    }

    // Optional updatedSince conditional 304
    if (updatedSince) {
      const sinceDate = new Date(updatedSince);
      if (!Number.isNaN(sinceDate.getTime()) && lastUpdated <= sinceDate) {
        const notModified = new Response(null, { status: 304 });
        notModified.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
        notModified.headers.set('Pragma', 'no-cache');
        notModified.headers.set('Expires', '0');
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
        return notModified;
      }
    }

    const nameFilter = q ? { contains: q, mode: 'insensitive' as const } : undefined;

    // Relational anti-join to exclude players already picked in this draft
    const where = {
      active: true,
      ...(position ? { position } : {}),
      ...(nameFilter ? { name: nameFilter } : {}),
      picks: { none: { draftId: id } },
    } as const;

    const playersFetched = await prisma.player.findMany({
      where,
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      skip,
      take: pageSize + 1, // over-fetch by one to determine hasMore without a separate count
    });

    const hasMore = playersFetched.length > pageSize;
    const players = hasMore ? playersFetched.slice(0, pageSize) : playersFetched;

    const data = {
      draftId: id,
      players: players.map((p) => ({ id: p.id, name: p.name, position: p.position, club: p.club })),
      pagination: {
        page,
        pageSize,
        hasMore,
        q: q || null,
        position: position || null,
      },
      lastUpdated: lastUpdated.toISOString(),
    };

    const response = successResponse(data);
    response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('ETag', etag);
    response.headers.set('Last-Modified', lastUpdated.toUTCString());

    logger.info('Draft players retrieved', { draftId: id, page, pageSize, count: players.length });
    return response;
  } catch (error) {
    logger.error('Failed to retrieve draft players', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return errorResponse('Failed to retrieve draft players', 500);
  }
}
