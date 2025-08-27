import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { FieldValue } from 'firebase-admin/firestore';
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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: leagueId } = params;

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

    const claimRef = adminDb.doc(`leagues/${leagueId}/waivers/${claimId}`);
    const claimSnap = await claimRef.get();
    if (!claimSnap.exists) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    const claim = claimSnap.data() as WaiverClaimData;

    // AuthZ: owner of the claim or league admin/commissioner/owner
    if (claim.userId !== callerId) {
      let memberSnap = await adminDb
        .collection('leagueMembers')
        .where('leagueId', '==', leagueId)
        .where('userId', '==', callerId)
        .limit(1)
        .get();
      if (memberSnap.empty) {
        memberSnap = await adminDb
          .collection('league_members')
          .where('leagueId', '==', leagueId)
          .where('userId', '==', callerId)
          .limit(1)
          .get();
      }
      const role = (memberSnap.docs[0]?.data() as { role?: string } | undefined)?.role ?? 'member';
      const allowed = role === 'owner' || role === 'commissioner' || role === 'admin';
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
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

    // audit: waiver-cancelled (prune undefined fields before write)
    const now = new Date();
    const audit: Record<string, unknown> = {
      type: 'waiver-cancelled',
      leagueId,
      userId: claim.userId,
      teamId: claim.teamId,
      playerId: claim.playerId,
      dropPlayerId: claim.dropPlayerId,
      bidAmount: claim.bidAmount,
      claimId,
      cancelledBy: callerId,
      timestamp: now,
    };
    for (const key of Object.keys(audit)) {
      if (audit[key] === undefined) delete audit[key];
    }
    await adminDb.collection(`leagues/${leagueId}/activity`).add(audit);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Avoid any-cast in logs
    console.error('[Waiver Cancel] Error:', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
