import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

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
  { params }: { params: { leagueId: string } }
) {
  try {
    const { leagueId } = params;
    
    // Validate leagueId format
    if (!leagueId || typeof leagueId !== 'string' || leagueId.trim() === '') {
      return NextResponse.json({ error: 'Invalid league ID' }, { status: 400 });
    }
    
    const { userId, claimId } = await req.json();

    if (!userId || !claimId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Validate string types and format
    if (typeof userId !== 'string' || typeof claimId !== 'string') {
      return NextResponse.json({ error: 'Invalid field types' }, { status: 400 });
    }

    const claimRef = adminDb.doc(`leagues/${leagueId}/waivers/${claimId}`);
    const claimSnap = await claimRef.get();
    if (!claimSnap.exists) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    const claim = claimSnap.data() as WaiverClaimData;
    if (claim.userId !== userId) {
      return NextResponse.json(
        { error: 'You are not authorized to cancel this claim' },
        { status: 403 }
      );
    }

    if (claim.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only pending claims can be cancelled' },
        { status: 409 }
      );
    }

    const now = new Date();
    await claimRef.update({
      status: 'CANCELLED',
      processedAt: now,
      cancelledBy: userId,
      cancelledAt: now,
    });

    // audit: waiver-cancelled (prune undefined fields before write)
    const audit: Record<string, unknown> = {
      type: 'waiver-cancelled',
      leagueId,
      userId,
      teamId: claim.teamId,
      playerId: claim.playerId,
      dropPlayerId: claim.dropPlayerId,
      bidAmount: claim.bidAmount,
      claimId,
      timestamp: now,
    };
    for (const key of Object.keys(audit)) {
      if (audit[key] === undefined) delete audit[key];
    }
    await adminDb.collection(`leagues/${leagueId}/activity`).add(audit);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[Waiver Cancel] Error:', {
      leagueId: params?.leagueId,
      error: err,
    });
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
