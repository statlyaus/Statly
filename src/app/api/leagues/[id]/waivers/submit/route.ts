import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { logger, withTiming } from '@/lib/logger';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { withMetrics } from '@/lib/metrics';
import { verifyLeagueMembership } from '@/lib/leagueMembership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WaiverSettings {
  system?: 'FAAB' | 'PRIORITY';
  minimumBid?: number;
}

export const POST = withMetrics(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    const { id: leagueId } = await context.params;
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 });

    const userId = await getAuthenticatedUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { teamId, playerId, dropPlayerId, priority = 1, bidAmount } = body || {};

    if (!teamId || !playerId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    logger.apiRequest('POST', `/api/leagues/${leagueId}/waivers/submit`, { userId, teamId, playerId });
    // Unified membership verification
    const membership = await verifyLeagueMembership(leagueId, userId);
    if (!membership.isMember) {
      return NextResponse.json({ error: 'Not a league member' }, { status: 403 });
    }

    // Ownership checks (doc read + roster scan) concurrently to reduce latency
    const ownershipRef = adminDb.doc(`leagues/${leagueId}/playerOwnerships/${String(playerId)}`);
    const ownershipPromise = withTiming('waivers.ownership.get', () => ownershipRef.get());
    const rosterScanPromise = withTiming('waivers.roster.scan', () =>
      adminDb
        .collection(`leagues/${leagueId}/rosters`)
        .where('playerIds', 'array-contains', String(playerId))
        .limit(1)
        .get()
    );
    const [ownershipDoc, rosterOwned] = await Promise.all([ownershipPromise, rosterScanPromise]);
    if (ownershipDoc.exists || !rosterOwned.empty) {
      return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
    }

    // Read waiver settings
    const settingsSnap = await withTiming('waivers.settings.get', () => adminDb.doc(`leagues/${leagueId}/config/settings`).get());
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
          // Store and calculate in cents to avoid floating point issues
          const existingPendingBidTotal = typeof prioritySnap.data()?.pendingBidTotal === 'number'
            ? (prioritySnap.data()!.pendingBidTotal as number)
            : 0;
          const existingPendingBidTotalCentsField = prioritySnap.data()?.pendingBidTotalCents as number | undefined;
          const pendingBidTotalCents = typeof existingPendingBidTotalCentsField === 'number'
            ? Math.round(existingPendingBidTotalCentsField)
            : Math.round(existingPendingBidTotal * 100);
          const validatedBidCents = Math.round(validatedBid * 100);
          const remainingFAABCents = Math.round(remainingFAAB * 100);

          if (pendingBidTotalCents + validatedBidCents > remainingFAABCents) {
            throw new Error('INSUFFICIENT_FAAB');
          }

          const newPendingBidTotalCents = pendingBidTotalCents + validatedBidCents;

          if (prioritySnap.exists) {
            tx.update(priorityRef, {
              pendingBidTotalCents: newPendingBidTotalCents,
              pendingBidTotal: newPendingBidTotalCents / 100,
              updatedAt: new Date(),
            });
          } else {
            tx.set(priorityRef, {
              leagueId,
              userId,
              pendingBidTotalCents: validatedBidCents,
              pendingBidTotal: validatedBidCents / 100,
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

    logger.info('waiver submitted', { leagueId, userId, teamId, playerId: String(playerId), claimId });
    try {
      const results = await Promise.allSettled([
        revalidateTag(tags.waivers(leagueId)),
        revalidateTag(tags.league(leagueId)),
      ]);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) {
        logger.warn('Failed to revalidate tags after waiver submit', { leagueId, failed });
      }
    } catch (e) {
      logger.warn('Revalidation error after waiver submit', { leagueId, error: e });
    }
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
    logger.apiError('POST', '/api/leagues/[id]/waivers/submit', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}, 'POST /api/leagues/[id]/waivers/submit');
