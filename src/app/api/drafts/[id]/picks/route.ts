import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { createHash } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/drafts/[id]/picks
// Paginated picks list or incremental fetch by since timestamp
export async function GET(request: Request, context: any) {
  try {
    const id = (context?.params?.id ?? (Array.isArray(context?.params?.id) ? context.params.id[0] : undefined)) as string | undefined;

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
      return errorResponse('Invalid query parameters', 400, 'BAD_REQUEST', { issues: parsed.error.issues });
    }
    const { page, pageSize, since, updatedSince } = parsed.data;

    const skip = (page - 1) * pageSize;

    // Compute lastUpdated using latest pick and draft lifecycle
    const [latestPick, draftMeta] = await Promise.all([
      prisma.pick.findFirst({ where: { draftId: id }, select: { madeAt: true }, orderBy: { madeAt: 'desc' } }),
      prisma.draft.findUnique({ where: { id }, select: { createdAt: true, startedAt: true, completedAt: true } }),
    ]);

    if (!draftMeta) {
      return errorResponse('Draft not found', 404);
    }

    const timestamps: number[] = [draftMeta.createdAt.getTime()];
    if (draftMeta.startedAt) timestamps.push(draftMeta.startedAt.getTime());
    if (draftMeta.completedAt) timestamps.push(draftMeta.completedAt.getTime());
    if (latestPick?.madeAt) timestamps.push(latestPick.madeAt.getTime());
    const lastUpdated = new Date(Math.max(...timestamps));

    // ETag includes pagination window and since filter
    const etagBase = `${id}|picks|${lastUpdated.toISOString()}|${page}|${pageSize}|${since || ''}`;
    const etag = `W/"${createHash('sha1').update(etagBase).digest('hex')}"`;

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      const notModified = new Response(null, { status: 304 });
      notModified.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      notModified.headers.set('ETag', etag);
      notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
      return notModified;
    }

    const conditionalSince = updatedSince || since;
    if (conditionalSince) {
      const sinceDate = new Date(conditionalSince);
      if (!Number.isNaN(sinceDate.getTime()) && lastUpdated <= sinceDate) {
        const notModified = new Response(null, { status: 304 });
        notModified.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
        return notModified;
      }
    }

    const where = since
      ? { draftId: id, madeAt: { gt: new Date(since) } }
      : { draftId: id };

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

    const data = {
      draftId: id,
      picks: picks.map((pick) => ({
        id: pick.id,
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        auto: pick.auto,
        madeAt: pick.madeAt.toISOString(),
        player: { id: pick.player.id, name: pick.player.name, position: pick.player.position, club: pick.player.club },
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

    logger.info('Draft picks retrieved', { draftId: id, page, pageSize, count: picks.length, totalCount, since });
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
