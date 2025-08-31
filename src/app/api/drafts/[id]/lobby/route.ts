import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
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
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';
import { z } from 'zod';

// Register histograms once in this module context
registerHistogram('lobby_action_duration_seconds', [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
registerHistogram('lobby_get_duration_seconds', [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]);

/**
 * Get current lobby state
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const t0 = Date.now();
  try {
    const { id: draftId } = await params;

    logger.info('Lobby API called', { draftId });

    // Ensure lobby columns exist before querying
    const columnsReady = await ensureLobbyColumns();
    if (!columnsReady) {
      logger.warn('Lobby columns not ready, using fallback');
    }

    const lobbyState = await getLobbyState(draftId);

    logger.info('Lobby state retrieved', { draftId, status: lobbyState.status });

    const res = successResponse(lobbyState);
    observeHistogram('lobby_get_duration_seconds', (Date.now() - t0) / 1000, { outcome: 'ok' });
    return res;
  } catch (error) {
    logger.error('Failed to get lobby state', {
      draftId: (await params).id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const res = errorResponse(
      `Failed to get lobby state: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
    observeHistogram('lobby_get_duration_seconds', (Date.now() - t0) / 1000, { outcome: 'error' });
    return res;
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
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('statly_session')?.value;
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
      try { incCounter('lobby_status_changes_total'); } catch {}
      try { 
        await draftPubSub.publish(draftId, 'draft:state', { 
          status: body.status, 
          lobbyOpenAt: data.lobbyOpenAt || null 
        }); 
      } catch {}
      try {
        await Promise.allSettled([
          revalidateTag(tags.league(draft.leagueId)),
          revalidateTag(tags.draft(draft.leagueId)),
          revalidateTag(`draft:${draftId}`),
        ]);
      } catch {}
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
      try { incCounter('lobby_order_changes_total'); } catch {}
      try { await draftPubSub.publish(draftId, 'draft:state', { order: body.order }); } catch {}
      try {
        await Promise.allSettled([
          revalidateTag(tags.league(draft.leagueId)),
          revalidateTag(tags.draft(draft.leagueId)),
          revalidateTag(`draft:${draftId}`),
        ]);
      } catch {}
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
      
      try {
        await draftRoomStore.setReady(draftId, memberId, body.ready);
      } catch {}
      
      // Durable persistence for long-term durability
      try {
        await prisma.$executeRaw`
          INSERT INTO "LobbyReady" ("draftId", "memberId", "ready")
          VALUES (${draftId}, ${memberId}, ${body.ready})
          ON CONFLICT ("draftId", "memberId") 
          DO UPDATE SET "ready" = EXCLUDED."ready"
        `;
      } catch {}
      
      await prisma.lobbyActivity.create({
        data: {
          draftId,
          memberId,
          action: body.ready ? 'lobby:ready' : 'lobby:not_ready',
          details: undefined,
        },
      });
      
      try {
        incCounter('lobby_ready_updates_total');
      } catch {}
      
      try {
        await draftPubSub.publish(draftId, 'draft:state', { memberId, ready: body.ready });
        const snapshot = await draftRoomStore.getReadyMap(draftId).catch(() => ({} as Record<string, boolean>));
        if (snapshot && typeof snapshot === 'object') {
          await (draftPubSub as any).publish(draftId, 'lobby:ready-map', { ready: snapshot } as any);
        }
      } catch {}
      
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
      try { incCounter('lobby_invites_total'); } catch {}
      try { await draftPubSub.publish(draftId, 'draft:admin-message', { email: body.email }); } catch {}
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
      
      try {
        incCounter('lobby_removals_total');
      } catch {}
      
      try { await draftPubSub.publish(draftId, 'draft:admin-message', { memberId: body.memberId }); } catch {}
      try {
        await Promise.allSettled([
          revalidateTag(tags.league(draft.leagueId)),
          revalidateTag(tags.draft(draft.leagueId)),
          revalidateTag(`draft:${draftId}`),
        ]);
      } catch {}
      
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