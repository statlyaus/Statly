import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { FieldValue } from 'firebase-admin/firestore';

import { logLeagueActivity } from '@/lib/activity';
import { tags } from '@/lib/cacheTags';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger, withTiming } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Explicit type for waiver claim documents
interface WaiverClaimData {
  userId: string;
  status: string;
  playerId?: string;
  dropPlayerId?: string;
  teamId?: string;
  bidAmount?: number;
}

export const POST = withMetrics(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id: leagueId } = await params;

      // AuthN
      const callerId = await getAuthenticatedUserId(req);
      if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      // Validate leagueId format
      if (!leagueId || typeof leagueId !== 'string' || leagueId.trim() === '') {
        return NextResponse.json({ error: 'Invalid league ID' }, { status: 400 });
      }

      const { claimId } = await req.json();
      if (!claimId || typeof claimId !== 'string') {
        return NextResponse.json({ error: 'Invalid claimId' }, { status: 400 });
      }

      logger.apiRequest('POST', `/api/leagues/${leagueId}/waivers/cancel`, { callerId, claimId });
      const claimRef = adminDb.doc(`leagues/${leagueId}/waivers/${claimId}`);
      const claimSnap = await withTiming('waivers.claim.get', () => claimRef.get());
      if (!claimSnap.exists) {
        return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
      }

      const claim = claimSnap.data() as WaiverClaimData;

      // AuthZ: owner of the claim or league admin/commissioner/owner
      const memberSnap = await adminDb
        .collection('leagues')
        .doc(leagueId)
        .collection('members')
        .doc(callerId)
        .get();

      if (!memberSnap.exists) {
        // User is not a member of this league
        return NextResponse.json({ error: 'Not a league member' }, { status: 403 });
      }

      const role = (memberSnap.data() as { role?: string }).role ?? 'member';

      const allowedRoles = ['owner', 'commissioner', 'admin'];
      if (claim.userId !== callerId && !allowedRoles.includes(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (claim.status !== 'PENDING') {
        return NextResponse.json(
          { error: 'Only pending claims can be cancelled' },
          { status: 409 }
        );
      }

      // Transactionally set CANCELLED and decrement pendingBidTotal if tracked
      await adminDb.runTransaction(async (tx) => {
        const fresh = await tx.get(claimRef);
        if (!fresh.exists) throw new Error('Claim not found');
        const data = fresh.data() as WaiverClaimData;
        if (data.status !== 'PENDING') throw new Error('Not pending');

        // Update claim status
        tx.update(claimRef, {
          status: 'CANCELLED',
          processedAt: FieldValue.serverTimestamp(),
          cancelledBy: callerId,
          cancelledAt: FieldValue.serverTimestamp(),
        });

        // Decrement pre-aggregated pending bid total if it exists
        const bid = typeof data.bidAmount === 'number' ? data.bidAmount : 0;
        if (bid > 0) {
          const priorityRef = adminDb.doc(`leagues/${leagueId}/waiverPriorities/${data.userId}`);
          const prSnap = await tx.get(priorityRef);
          if (prSnap.exists) {
            tx.update(priorityRef, {
              pendingBidTotal: FieldValue.increment(-bid),
              updatedAt: new Date(),
            });
          }
        }
      });

      // audit: waiver-cancelled via shared helper
      await logLeagueActivity(leagueId, 'waiver-cancelled', {
        userId: claim.userId,
        teamId: claim.teamId,
        playerId: claim.playerId,
        dropPlayerId: claim.dropPlayerId,
        bidAmount: claim.bidAmount,
        claimId,
        cancelledBy: callerId,
      });

      logger.info('waiver cancelled', { leagueId, callerId, claimId });
      try {
        revalidateTag(tags.waivers(leagueId));
        revalidateTag(tags.league(leagueId));
      } catch (revalErr) {
        logger.warn('Failed to revalidate tags after waiver cancel', {
          leagueId,
          tags: [tags.waivers(leagueId), tags.league(leagueId)],
          error:
            revalErr instanceof Error
              ? { name: revalErr.name, message: revalErr.message, stack: revalErr.stack }
              : undefined,
        });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (err) {
      logger.apiError('POST', '/api/leagues/[id]/waivers/cancel', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/cancel'
);
