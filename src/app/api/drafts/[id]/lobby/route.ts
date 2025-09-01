export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';
import { z } from 'zod';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getLobbyState } from '@/lib/draftLobby';
import { ensureLobbyColumns } from '@/lib/ensureLobbyColumns';
import { prisma } from '@/lib/prisma';
import { draftRoomStore } from '@/server/roomStore';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { draftPubSub } from '@/services/realtime/pubsub';
import { incCounter, observeHistogram, registerHistogram } from '@/server/metrics';
import { executeSafely } from '@/lib/errorHandling';
import { SESSION_COOKIE_NAME } from '@/constants';

// Register histograms once in this module context
const API_DRAFT_LOBBY_GET_DURATION_SECONDS = 'api_draft_lobby_get_duration_seconds';
registerHistogram('lobby_action_duration_seconds', [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
registerHistogram(API_DRAFT_LOBBY_GET_DURATION_SECONDS, [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);



/**
 * Get current lobby state
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startMs = Date.now();
  let outcome: 'success' | 'error' = 'success';
  let auth: 'none' | 'verified' | 'invalid' = 'none';
  let draftId: string | undefined;
  try {
    const ParamsSchema = z.object({ id: z.string().min(1) });
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) {
      outcome = 'error';
      logger.warn('Invalid draft id', { issues: parsed.error.issues });
      return errorResponse('Invalid draft id', 400);
    }
    draftId = parsed.data.id;

    // Attempt to verify session cookie; lobby data is still returned even if auth fails
    try {
      const sessionCookie = cookies().get(SESSION_COOKIE_NAME)?.value;
      if (sessionCookie) {
        await adminAuth.verifySessionCookie(sessionCookie, true);
        auth = 'verified';
      }
    } catch (authErr) {
      auth = 'invalid';
      logger.debug('Lobby request auth verification failed', { error: authErr });
    }

    logger.info('Lobby API called', { draftId });

    // Ensure lobby columns exist before querying
    const columnsReady = await ensureLobbyColumns();
    if (!columnsReady) {
      logger.warn('Lobby columns not ready, using fallback');
    }

    const lobbyState = await getLobbyState(draftId);

    logger.info('Lobby state retrieved', { draftId, status: lobbyState.status });

    return successResponse(lobbyState);
  } catch (error) {
    outcome = 'error';
    logger.error('Failed to get lobby state', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse('Failed to get lobby state', 500);
  } finally {
    observeHistogram(
      API_DRAFT_LOBBY_GET_DURATION_SECONDS,
      (Date.now() - startMs) / 1000,
      { outcome, auth }
    );
  }
}
// POST actions for lobby management
const LobbyStatusSchema = z.object({ 
  action: z.literal('status'), 
  status: z.enum(['OPEN','CLOSED']), 
  lobbyOpenAt: z.string().datetime().optional() 
});
const LobbyOrderSchema = z.object({ 
  action: z.literal('order'), 
  order: z.array(z.object({ 
    memberId: z.string().min(1), 
    slot: z.number().int().positive() 
  })) 
});
const LobbyReadySchema = z.object({ 
  action: z.literal('ready'), 
  ready: z.boolean(), 
  memberId: z.string().optional() 
});
const LobbyInviteSchema = z.object({ 
  action: z.literal('invite'), 
  email: z.string().email() 
});
const LobbyRemoveSchema = z.object({ 
  action: z.literal('remove'), 
  memberId: z.string().min(1) 
});
const AnyActionSchema = z.discriminatedUnion('action', [
  LobbyStatusSchema, 
  LobbyOrderSchema, 
  LobbyReadySchema, 
  LobbyInviteSchema, 
  LobbyRemoveSchema
]);

async function requireUser() {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid as string;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await params;
  const t0 = Date.now();
  let actionLabel: string = 'unknown';
  
  try {
    const userId = await requireUser();
    if (!userId) {
      observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: 'unauthorized', outcome: 'unauthorized' });
      return errorResponse('Unauthorized', 401);
    }

    const json = await request.json().catch(() => ({}));
    const parsed = AnyActionSchema.safeParse(json);
    if (!parsed.success) {
      observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: 'invalid', outcome: 'validation_error' });
      return errorResponse('Invalid lobby action', 422, 'VALIDATION_ERROR', { issues: parsed.error.flatten() });
    }
    const body = parsed.data;
    actionLabel = body.action;

    const draft = await prisma.draft.findUnique({ 
      where: { id: draftId }, 
      include: { league: { include: { members: true } } } 
    });
    if (!draft) return errorResponse('Draft not found', 404);
    
    const membership = draft.league?.members.find((m) => m.userId === userId) || null;
    if (!membership) return errorResponse('Forbidden', 403);
    const isOwner = membership.role === 'OWNER';

    if (body.action === 'status') {
      if (!isOwner) {
        observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'forbidden' });
        return errorResponse('Only owner can change lobby status', 403);
      }
      const data: any = { lobbyStatus: body.status };
      if (body.status === 'OPEN') {
        data.lobbyOpenAt = body.lobbyOpenAt ? new Date(body.lobbyOpenAt) : new Date();
      }
      await prisma.draft.update({ where: { id: draftId }, data });
      await prisma.lobbyActivity.create({ 
        data: { 
          draftId, 
          memberId: membership.id, 
          action: 'lobby:status', 
          details: JSON.stringify({ status: body.status }) 
        } 
      });
      
      // Execute non-critical operations safely
      await executeSafely(
        () => incCounter('lobby_status_changes_total'),
        'increment lobby status counter',
        { draftId, action: 'status' }
      );
      
      await executeSafely(
        () => draftPubSub.publish(draftId, 'draft:state', { 
          status: body.status, 
          lobbyOpenAt: data.lobbyOpenAt || null 
        }),
        'publish draft state update',
        { draftId, action: 'status' }
      );
      
      await executeSafely(
        () => Promise.allSettled([
          revalidateTag(tags.league(draft.leagueId)),
          revalidateTag(tags.draft(draft.leagueId)),
          revalidateTag(`draft:${draftId}`),
        ]),
        'revalidate cache tags',
        { draftId, action: 'status' }
      );
      
      const res = NextResponse.json({ success: true, data: { status: body.status } });
      observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'ok' });
      return res;
    }

    if (body.action === 'order') {
      if (!isOwner) {
        observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'forbidden' });
        return errorResponse('Only owner can set draft order', 403);
      }
      await prisma.$transaction(async (tx) => {
        for (const item of body.order) {
          await tx.draftOrder.updateMany({ 
            where: { draftId, memberId: item.memberId }, 
            data: { slot: item.slot } 
          });
        }
        await tx.lobbyActivity.create({ 
          data: { 
            draftId, 
            memberId: membership.id, 
            action: 'lobby:order', 
            details: JSON.stringify({ count: body.order.length }) 
          } 
        });
      });
      
      // Execute non-critical operations safely
      await executeSafely(
        () => incCounter('lobby_order_changes_total'),
        'increment lobby order counter',
        { draftId, action: 'order' }
      );
      
      await executeSafely(
        () => draftPubSub.publish(draftId, 'draft:state', { order: body.order }),
        'publish draft order update',
        { draftId, action: 'order' }
      );
      
      await executeSafely(
        () => Promise.allSettled([
          revalidateTag(tags.league(draft.leagueId)),
          revalidateTag(tags.draft(draft.leagueId)),
          revalidateTag(`draft:${draftId}`),
        ]),
        'revalidate cache tags',
        { draftId, action: 'order' }
      );
      
      const res = NextResponse.json({ success: true, data: { updated: body.order.length } });
      observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'ok' });
      return res;
    }

    if (body.action === 'ready') {
      const memberId = body.memberId || membership.id;
      if (memberId !== membership.id && !isOwner) {
        observeHistogram(
          'lobby_action_duration_seconds',
          (Date.now() - t0) / 1000,
          { action: actionLabel, outcome: 'forbidden' }
        );
        return errorResponse('Only owner can change readiness for others', 403);
      }
      
      // Execute non-critical operations safely
      await executeSafely(
        () => draftRoomStore.setReady(draftId, memberId, body.ready),
        'set draft room ready state',
        { draftId, memberId, ready: body.ready }
      );
      
      // Durable persistence for long-term durability
      await executeSafely(
        () => prisma.$executeRaw`
          INSERT INTO "LobbyReady" ("draftId", "memberId", "ready")
          VALUES (${draftId}, ${memberId}, ${body.ready})
          ON CONFLICT ("draftId", "memberId") 
          DO UPDATE SET "ready" = EXCLUDED."ready"
        `,
        'persist lobby ready state',
        { draftId, memberId, ready: body.ready }
      );
      
      await prisma.lobbyActivity.create({
        data: {
          draftId,
          memberId,
          action: body.ready ? 'lobby:ready' : 'lobby:not_ready',
          details: undefined,
        },
      });
      
      // Execute non-critical operations safely
      await executeSafely(
        () => incCounter('lobby_ready_updates_total'),
        'increment lobby ready counter',
        { draftId, memberId, ready: body.ready }
      );
      
      await executeSafely(
        async () => {
          await draftPubSub.publish(draftId, 'draft:state', { memberId, ready: body.ready });
          const snapshot = await draftRoomStore.getReadyMap(draftId).catch(() => ({} as Record<string, boolean>));
          if (snapshot && typeof snapshot === 'object') {
            await (draftPubSub as any).publish(draftId, 'lobby:ready-map', { ready: snapshot } as any);
          }
        },
        'publish draft ready updates',
        { draftId, memberId, ready: body.ready }
      );
      
      const res = NextResponse.json({ success: true, data: { memberId, ready: body.ready } });
      observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'ok' });
      return res;
    }

    if (body.action === 'invite') {
      if (!isOwner) {
        observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'forbidden' });
        return errorResponse('Only owner can invite', 403);
      }
      await prisma.lobbyActivity.create({ 
        data: { 
          draftId, 
          memberId: membership.id, 
          action: 'lobby:invite', 
          details: JSON.stringify({ email: body.email }) 
        } 
      });
      
      // Execute non-critical operations safely
      await executeSafely(
        () => incCounter('lobby_invites_total'),
        'increment lobby invites counter',
        { draftId, action: 'invite', email: body.email }
      );
      
      await executeSafely(
        () => draftPubSub.publish(draftId, 'draft:admin-message', { email: body.email }),
        'publish draft admin message',
        { draftId, action: 'invite', email: body.email }
      );
      
      const res = NextResponse.json({ success: true, data: { invited: body.email } });
      observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'ok' });
      return res;
    }

    if (body.action === 'remove') {
      if (!isOwner) {
        observeHistogram(
          'lobby_action_duration_seconds',
          (Date.now() - t0) / 1000,
          { action: actionLabel, outcome: 'forbidden' }
        );
        return errorResponse('Only owner can remove', 403);
      }
      
      await prisma.$transaction(async (tx) => {
        await tx.draftOrder
          .deleteMany({ where: { draftId, memberId: body.memberId } })
          .catch(() => undefined);
        await tx.leagueMember
          .deleteMany({
            where: { id: body.memberId, leagueId: draft.leagueId },
          })
          .catch(() => undefined);
        await tx.lobbyActivity.create({
          data: {
            draftId,
            memberId: membership.id,
            action: 'lobby:remove',
            details: JSON.stringify({ memberId: body.memberId }),
          },
        });
      });
      
      // Execute non-critical operations safely
      await executeSafely(
        () => incCounter('lobby_removals_total'),
        'increment lobby removals counter',
        { draftId, action: 'remove', memberId: body.memberId }
      );
      
      await executeSafely(
        () => draftPubSub.publish(draftId, 'draft:admin-message', { memberId: body.memberId }),
        'publish draft admin message',
        { draftId, action: 'remove', memberId: body.memberId }
      );
      
      await executeSafely(
        () => Promise.allSettled([
          revalidateTag(tags.league(draft.leagueId)),
          revalidateTag(tags.draft(draft.leagueId)),
          revalidateTag(`draft:${draftId}`),
        ]),
        'revalidate cache tags',
        { draftId, action: 'remove' }
      );
      
      const res = NextResponse.json({ success: true, data: { removed: body.memberId } });
      observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'ok' });
      return res;
    }

    const res = errorResponse('Unsupported lobby action', 400);
    observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'unsupported' });
    return res;
  } catch (error) {
    logger.error('Lobby action failed', { 
      draftId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    const res = errorResponse('Failed to process lobby action', 500);
    observeHistogram('lobby_action_duration_seconds', (Date.now() - t0) / 1000, { action: actionLabel, outcome: 'error' });
    return res;
  }
}