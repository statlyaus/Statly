import type { NextRequest } from 'next/server';

import { z } from 'zod';

import { commonErrors, errorResponse, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  DraftPrivateStateAccessError,
  draftPrivateStateService,
} from '@/server/draft/services/DraftPrivateStateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const AddWatchlistItemSchema = z.object({
  playerId: z.string().trim().min(1),
  priority: z.coerce.number().int().positive().optional(),
  notes: z.string().optional(),
});

const RemoveWatchlistItemSchema = z.object({
  playerId: z.string().trim().min(1),
});

function privateResponse(data: unknown, status = 200): Response {
  const response = successResponse(data, status);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function privateStateErrorResponse(error: unknown, operation: string, draftId: string): Response {
  if (error instanceof DraftPrivateStateAccessError) {
    return commonErrors.forbidden(error.message);
  }

  logger.error(`Failed to ${operation}`, {
    draftId,
    error: error instanceof Error ? error.message : String(error),
  });
  return errorResponse(`Failed to ${operation}`, 500);
}

async function authenticate(request: NextRequest): Promise<string | Response> {
  const actorUserId = await getAuthenticatedUserId(request);
  return actorUserId ?? commonErrors.unauthorized('Authentication required');
}

/** Get the authenticated member's watchlist. Legacy memberId query values are ignored. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await params;

  try {
    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) return actorUserId;

    const watchlist = await draftPrivateStateService.getWatchlist({ draftId, actorUserId });
    return privateResponse({ watchlist });
  } catch (error) {
    return privateStateErrorResponse(error, 'get watchlist', draftId);
  }
}

/** Add a player to the authenticated member's watchlist. Legacy memberId fields are ignored. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await params;

  try {
    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) return actorUserId;

    const parsed = AddWatchlistItemSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid request body', {
        issues: parsed.error.flatten(),
      });
    }

    const watchlistItem = await draftPrivateStateService.addToWatchlist({
      draftId,
      actorUserId,
      ...parsed.data,
    });
    return privateResponse({ watchlistItem }, 201);
  } catch (error) {
    return privateStateErrorResponse(error, 'add to watchlist', draftId);
  }
}

/** Remove a player from the authenticated member's watchlist. Legacy memberId values are ignored. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await params;

  try {
    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) return actorUserId;

    const url = new URL(request.url);
    const parsed = RemoveWatchlistItemSchema.safeParse({
      playerId: url.searchParams.get('playerId'),
    });
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid query params', {
        issues: parsed.error.flatten(),
      });
    }

    await draftPrivateStateService.removeFromWatchlist({
      draftId,
      actorUserId,
      playerId: parsed.data.playerId,
    });
    return privateResponse({ message: 'Player removed from watchlist' });
  } catch (error) {
    return privateStateErrorResponse(error, 'remove from watchlist', draftId);
  }
}
