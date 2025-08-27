import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WaiverSettings {
  system?: 'FAAB' | 'PRIORITY';
  minimumBid?: number;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id: leagueId } = params;
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 });

    const userId = await getAuthenticatedUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { teamId, playerId, dropPlayerId, priority = 1, bidAmount } = body || {};

    if (!teamId || !playerId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Membership check (either embedded member doc or global collection)
    const memberRef = adminDb.doc(`leagues/${leagueId}/members/${userId}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      const legacyMemberSnap = await adminDb
        .collection('leagueMembers')
        .where('leagueId', '==', leagueId)
        .where('userId', '==', userId)
        .limit(1)
        .get();
      if (legacyMemberSnap.empty) {
        return NextResponse.json({ error: 'Not a league member' }, { status: 403 });
      }
    }

    // Fast ownership check: if playerOwnership doc exists -> owned
    const ownershipRef = adminDb.doc(`leagues/${leagueId}/playerOwnerships/${String(playerId)}`);
    const ownershipDoc = await ownershipRef.get();
    if (ownershipDoc.exists) {
      return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
    }

    // Fallback (migration) roster scan if no ownership doc
    if (!ownershipDoc.exists) {
      const rosterOwned = await adminDb
        .collection(`leagues/${leagueId}/rosters`)
        .where('playerIds', 'array-contains', String(playerId))
        .limit(1)
        .get();
      if (!rosterOwned.empty) {
        return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
      }
    }

    // Read waiver settings
    const settingsSnap = await adminDb.doc(`leagues/${leagueId}/config/settings`).get();
    interface SettingsDoc { waiverSettings?: WaiverSettings }
    const rawSettings: unknown = settingsSnap.data();
    const waiverSettings: SettingsDoc | undefined = (rawSettings && typeof rawSettings === 'object') ? (rawSettings as SettingsDoc) : undefined;
    const ws: WaiverSettings | undefined = waiverSettings?.waiverSettings;

    const isFAAB = ws?.system === 'FAAB';
    let validatedBid: number | undefined = undefined;

    if (isFAAB) {
      const minBid = ws?.minimumBid ?? 1;
      if (typeof bidAmount !== 'number' || bidAmount < minBid) {
        return NextResponse.json({ error: 'Invalid bid amount' }, { status: 400 });
      }
      validatedBid = bidAmount;
    }

    const waiversCollection = adminDb.collection(`leagues/${leagueId}/waivers`);

    // Transaction builds waiver and increments pendingBidTotal if FAAB
    const claimId = await adminDb.runTransaction(async (tx) => {
      // Re-check ownership inside transaction for safety
      const ownershipDocTx = await tx.get(ownershipRef);
      if (ownershipDocTx.exists) throw new Error('PLAYER_OWNED');

      // If FAAB, ensure we are not exceeding remaining (using pre-aggregated pendingBidTotal if present)
      if (isFAAB && typeof validatedBid === 'number') {
        const priorityRef = adminDb.doc(`leagues/${leagueId}/waiverPriorities/${userId}`);
        const prioritySnap = await tx.get(priorityRef);
        const remainingFAAB = prioritySnap.exists ? (prioritySnap.data()?.remainingFAAB as number | undefined) : undefined;
        if (typeof remainingFAAB === 'number') {
          const pendingBidTotal = typeof prioritySnap.data()?.pendingBidTotal === 'number' ? (prioritySnap.data()!.pendingBidTotal as number) : 0;
          if (pendingBidTotal + validatedBid > remainingFAAB) {
            throw new Error('INSUFFICIENT_FAAB');
          }
          // Increment pendingBidTotal atomically
          if (prioritySnap.exists) {
            tx.update(priorityRef, { pendingBidTotal: FieldValue.increment(validatedBid), updatedAt: new Date() });
          } else {
            tx.set(priorityRef, {
              leagueId,
              userId,
              pendingBidTotal: validatedBid,
              createdAt: new Date(),
              updatedAt: new Date(),
            }, { merge: true });
          }
        }
      }

      const newDocRef = waiversCollection.doc();
      tx.set(newDocRef, {
        leagueId,
        userId,
        teamId,
        playerId: String(playerId),
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
        priority: Number(priority) || 1,
        bidAmount: typeof validatedBid === 'number' ? validatedBid : undefined,
        status: 'PENDING',
        createdAt: new Date(),
      });

      // Audit log
      const activityRef = adminDb.collection(`leagues/${leagueId}/activity`).doc();
      tx.set(activityRef, {
        type: 'waiver-submitted',
        leagueId,
        userId,
        teamId,
        playerId: String(playerId),
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
        bidAmount: typeof validatedBid === 'number' ? validatedBid : undefined,
        priority: Number(priority) || 1,
        timestamp: new Date(),
        claimId: newDocRef.id,
      });

      return newDocRef.id;
    });

    return NextResponse.json({ id: claimId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'PLAYER_OWNED') {
        return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
      }
      if (err.message === 'INSUFFICIENT_FAAB') {
        return NextResponse.json({ error: 'Insufficient FAAB remaining' }, { status: 400 });
      }
    }
    console.error('[Waivers Submit] Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
