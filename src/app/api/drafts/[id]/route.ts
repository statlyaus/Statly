import { createHash } from 'crypto';

import type { NextRequest } from 'next/server';

import { z } from 'zod';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { buildDraftClockPayload } from '@/server/draft/services/DraftProjectionService';
import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';
import { getDraftMembershipAccess } from '@/server/leagues/membership';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseSelectedCategories(raw: unknown): FantasyCategoryKey[] {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw.split(',').map((value) => value.trim());
    }
  }

  if (!Array.isArray(parsed)) return [];

  const validKeys = new Set(Object.keys(FANTASY_CATEGORIES));
  return parsed.map(String).filter((value): value is FantasyCategoryKey => validKeys.has(value));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Strict id validation (Draft IDs are CUIDs per Prisma schema)
    if (!z.string().cuid().safeParse(id).success) {
      return errorResponse('Invalid draft id', 400);
    }

    const authenticatedUserId = await getAuthenticatedUserId(request);
    if (!authenticatedUserId) {
      return commonErrors.unauthorized();
    }

    const access = await getDraftMembershipAccess(id, authenticatedUserId);
    if (!access.isMember) {
      return commonErrors.forbidden('Not a member of this draft');
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
        select: {
          createdAt: true,
          startedAt: true,
          completedAt: true,
          pickStartedAt: true,
          pickDeadlineAt: true,
          pausedRemainingSeconds: true,
          schedulingVersion: true,
          status: true,
          lobbyStatus: true,
          leagueId: true,
        },
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

    const draftReadiness = await getLeagueDraftOperationalReadiness(prisma, {
      leagueId: draftTimes.leagueId,
    });

    const timestamps: number[] = [draftTimes.createdAt.getTime()];
    if (draftTimes.startedAt) timestamps.push(draftTimes.startedAt.getTime());
    if (draftTimes.completedAt) timestamps.push(draftTimes.completedAt.getTime());
    if (draftTimes.pickStartedAt) timestamps.push(draftTimes.pickStartedAt.getTime());
    if (draftTimes.pickDeadlineAt) timestamps.push(draftTimes.pickDeadlineAt.getTime());
    if (latestPick?.madeAt) timestamps.push(latestPick.madeAt.getTime());
    const lastUpdated = new Date(Math.max(...timestamps));

    // Include every durable clock discriminator so timer-only transitions cannot return 304.
    const etagBase = [
      id,
      'meta',
      lastUpdated.toISOString(),
      draftTimes.status,
      draftTimes.lobbyStatus ?? '',
      draftTimes.schedulingVersion,
      draftTimes.pickStartedAt?.toISOString() ?? '',
      draftTimes.pickDeadlineAt?.toISOString() ?? '',
      draftTimes.pausedRemainingSeconds ?? '',
      draftReadiness.playerPool.availableCount,
      draftReadiness.status,
    ].join('|');
    const etag = `W/"${createHash('sha1').update(etagBase).digest('hex')}"`;

    // Conditional: If-None-Match (supports comma-separated ETags and wildcard "*")
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
        // Removed Surrogate-Control: no-store to allow client revalidation
        notModified.headers.set('ETag', etag);
        notModified.headers.set('Last-Modified', lastUpdated.toUTCString());
        return notModified;
      }
    }

    // Conditional: updatedSince
    if (updatedSince && draftTimes.status !== 'LIVE' && draftTimes.status !== 'PAUSED') {
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
            categoriesJson: true,
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
    const selectedCategories = parseSelectedCategories(draft.league?.categoriesJson);
    const serverNow = new Date().toISOString();
    const clock = buildDraftClockPayload({
      status: draft.status,
      lobbyStatus: draft.lobbyStatus,
      revision: draft.schedulingVersion,
      durationSeconds: draft.league?.settings?.pickSeconds || 120,
      serverNow,
      pickStartedAt: draft.pickStartedAt,
      pickDeadlineAt: draft.pickDeadlineAt,
      pausedRemainingSeconds: draft.pausedRemainingSeconds,
    });

    const draftData = {
      id: draft.id,
      leagueId: draft.leagueId,
      name: `${draft.league?.name || 'Draft'} - ${draft.status}`,
      leagueSize: draft.orders.length,
      draftType: draft.league?.settings?.draftType || 'SNAKE',
      timePerPick: draft.league?.settings?.pickSeconds || 120,
      status: draft.status,
      currentPick: draft.currentPick,
      totalPicks: draft.totalPicks,
      round: draft.round,
      direction: draft.direction,
      schedulingVersion: draft.schedulingVersion,
      serverNow,
      clock,
      pickStartedAt: draft.pickStartedAt?.toISOString() ?? null,
      pickDeadlineAt: draft.pickDeadlineAt?.toISOString() ?? null,
      pausedRemainingSeconds: draft.pausedRemainingSeconds,
      createdAt: draft.createdAt.toISOString(),
      startedAt: draft.startedAt?.toISOString(),
      completedAt: draft.completedAt?.toISOString(),
      selectedCategories,
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
      draftReadiness,
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
