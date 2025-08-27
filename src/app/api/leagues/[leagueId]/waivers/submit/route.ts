import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export async function POST(req: NextRequest, { params }: { params: { leagueId: string } }) {
  try {
    const { leagueId } = params;
    const body = await req.json();
    const { userId, teamId, playerId, dropPlayerId, priority = 1, bidAmount } = body || {};

    if (!userId || !teamId || !playerId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Basic validation: ensure league/member relationship
    const memberDoc = await adminDb.doc(`leagues/${leagueId}/members/${userId}`).get();
    if (!memberDoc.exists) {
      return NextResponse.json({ error: 'Not a league member' }, { status: 403 });
    }

    // Scalable ownership check: denormalized O(1) lookup with safe fallback
    const ownershipDoc = await adminDb
      .doc(`leagues/${leagueId}/playerOwnerships/${String(playerId)}`)
      .get();

    if (ownershipDoc.exists) {
      return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
    }

    // Fallback for migration: if ownership map not yet populated, check rosters via array-contains
    const ownedSnap = await adminDb
      .collection(`leagues/${leagueId}/rosters`)
      .where('playerIds', 'array-contains', String(playerId))
      .limit(1)
      .get();
    if (!ownedSnap.empty) {
      return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
    }

    // Read settings for FAAB and minimums
    const settingsDoc = await adminDb.doc(`leagues/${leagueId}/config/settings`).get();
    const waiverSettings = settingsDoc.data()?.waiverSettings;
    if (waiverSettings?.system === 'FAAB') {
      const minBid = waiverSettings?.minimumBid ?? 1;
      if (typeof bidAmount !== 'number' || bidAmount < minBid) {
        return NextResponse.json({ error: 'Invalid bid amount' }, { status: 400 });
      }

      // Optional FAAB remaining enforcement if priority doc exists
      const priorityDoc = await adminDb.doc(`leagues/${leagueId}/waiverPriorities/${userId}`).get();
      const remainingFAAB: number | undefined = priorityDoc.exists
        ? (priorityDoc.data()?.remainingFAAB as number | undefined)
        : undefined;

      if (typeof remainingFAAB === 'number') {
        const waiversCollection = adminDb.collection(`leagues/${leagueId}/waivers`);
        try {
          const newDocId = await adminDb.runTransaction(async (tx) => {
            const pendingQuery = waiversCollection
              .where('userId', '==', userId)
              .where('status', '==', 'PENDING');

            const pendingSnap = await tx.get(pendingQuery);
            let pendingTotal = 0;
            for (const d of pendingSnap.docs) {
              const b = d.data()?.bidAmount as number | undefined;
              if (typeof b === 'number') pendingTotal += b;
            }

            if (pendingTotal + bidAmount > remainingFAAB) {
              throw new Error('Insufficient FAAB remaining');
            }

            const newDocRef = waiversCollection.doc();
            tx.set(newDocRef, {
              leagueId,
              userId,
              teamId,
              playerId: String(playerId),
              dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
              priority: Number(priority) || 1,
              bidAmount,
              status: 'PENDING',
              createdAt: new Date(),
            });

            // audit: waiver-submitted
            const activityRef = adminDb.collection(`leagues/${leagueId}/activity`).doc();
            tx.set(activityRef, {
              type: 'waiver-submitted',
              leagueId,
              userId,
              teamId,
              playerId: String(playerId),
              dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
              bidAmount: typeof bidAmount === 'number' ? bidAmount : undefined,
              priority: Number(priority) || 1,
              timestamp: new Date(),
              claimId: newDocRef.id,
            });

            return newDocRef.id;
          });

          return NextResponse.json({ id: newDocId }, { status: 201 });
        } catch (err) {
          if (err instanceof Error && err.message === 'Insufficient FAAB remaining') {
            return NextResponse.json({ error: err.message }, { status: 400 });
          }
          throw err;
        }
      }
    }

    // Default creation path (non-FAAB or no remainingFAAB tracking)
    const createdAt = new Date();
    const ref = await adminDb.collection(`leagues/${leagueId}/waivers`).add({
      leagueId,
      userId,
      teamId,
      playerId: String(playerId),
      dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
      priority: Number(priority) || 1,
      bidAmount: typeof bidAmount === 'number' ? bidAmount : undefined,
      status: 'PENDING',
      createdAt,
    });

    // audit: waiver-submitted (non-transaction path)
    await adminDb.collection(`leagues/${leagueId}/activity`).add({
      type: 'waiver-submitted',
      leagueId,
      userId,
      teamId,
      playerId: String(playerId),
      dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
      bidAmount: typeof bidAmount === 'number' ? bidAmount : undefined,
      priority: Number(priority) || 1,
      timestamp: new Date(),
      claimId: ref.id,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    console.error('Waiver submit error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
