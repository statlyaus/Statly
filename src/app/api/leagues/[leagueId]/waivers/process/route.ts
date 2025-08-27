import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

// NOTE: Protect this endpoint (e.g. internal auth, cron token, or commissioner role verification)
// It processes all pending waiver claims for a league and applies results atomically per claim.

interface WaiverClaimRaw {
  id: string;
  leagueId: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  createdAt: FirebaseFirestore.Timestamp | Date;
  bidAmount?: number;
}

interface RosterDoc {
  playerIds?: string[];
  bench?: string[];
  updatedAt?: FirebaseFirestore.Timestamp | Date;
}

export async function POST(req: NextRequest, { params }: { params: { leagueId: string } }) {
  const { leagueId } = params;
  try {
    // (Optional) simple auth guard placeholder
    const authHeader = req.headers.get('x-internal-key');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load waiver settings to determine processing order
    const settingsSnap = await adminDb.doc(`leagues/${leagueId}/config/settings`).get();
    const waiverSettings = settingsSnap.data()?.waiverSettings || {};
    const isFAAB = waiverSettings.system === 'FAAB';

    // Fetch all pending claims (status == PENDING)
    const pendingSnap = await adminDb
      .collection(`leagues/${leagueId}/waivers`)
      .where('status', '==', 'PENDING')
      .get();

    const pending: WaiverClaimRaw[] = pendingSnap.docs.map((d) => {
      const data = d.data() as Partial<WaiverClaimRaw>;
      return {
        id: d.id,
        leagueId: data.leagueId || leagueId,
        userId: data.userId || '',
        teamId: data.teamId || '',
        playerId: data.playerId || '',
        dropPlayerId: data.dropPlayerId,
        priority: typeof data.priority === 'number' ? data.priority : 1,
        status: (data.status as WaiverClaimRaw['status']) || 'PENDING',
        createdAt: data.createdAt || new Date(),
        bidAmount: data.bidAmount,
      } satisfies WaiverClaimRaw;
    });

    if (!pending.length) {
      return NextResponse.json({ processed: 0, results: [] });
    }

    // Sort per system:
    // FAAB: highest bid first, then priority asc (lower number = higher priority), then createdAt asc
    // Rolling list / others: priority asc, createdAt asc
    pending.sort((a, b) => {
      // If FAAB, first compare bid (desc)
      if (isFAAB) {
        const bidDiff = (b.bidAmount ?? 0) - (a.bidAmount ?? 0);
        if (bidDiff !== 0) return bidDiff;
      }

      // Next compare priority (asc) for both FAAB ties and non-FAAB systems
      const prioDiff = a.priority - b.priority;
      if (prioDiff !== 0) return prioDiff;

      // Final tie-breaker: createdAt (asc)
      const getTime = (v: WaiverClaimRaw['createdAt']) =>
        v instanceof Date ? v.getTime() : v.toMillis();
      return getTime(a.createdAt) - getTime(b.createdAt);
    });

    const results: Array<{ id: string; status: string; reason?: string }> = [];

    for (const claim of pending) {
      try {
        await adminDb.runTransaction(async (tx) => {
          // Helper to emit audit log for failures
          function logFailure(reason: string) {
            const activityRef = adminDb.collection(`leagues/${leagueId}/activity`).doc();
            tx.set(activityRef, {
              type: 'waiver-failed',
              leagueId,
              userId: freshData.userId,
              teamId: freshData.teamId,
              playerId: freshData.playerId,
              dropPlayerId: freshData.dropPlayerId || undefined,
              bidAmount: freshData.bidAmount || undefined,
              reason,
              claimId: claim.id,
              timestamp: new Date(),
            });
          }

          const claimRef = adminDb.doc(`leagues/${leagueId}/waivers/${claim.id}`);
          const freshSnap = await tx.get(claimRef);
          if (!freshSnap.exists) {
            results.push({ id: claim.id, status: 'SKIPPED', reason: 'Missing claim' });
            return;
          }
          const freshData = freshSnap.data() as WaiverClaimRaw;
          if (freshData.status !== 'PENDING') {
            results.push({ id: claim.id, status: 'SKIPPED', reason: 'Already processed' });
            return;
          }

          const playerOwnershipRef = adminDb.doc(`leagues/${leagueId}/playerOwnerships/${freshData.playerId}`);
          const ownershipSnap = await tx.get(playerOwnershipRef);
          if (ownershipSnap.exists) {
            tx.update(claimRef, {
              status: 'FAILED',
              processedAt: new Date(),
              reason: 'Player already owned',
            });
            logFailure('Player already owned');
            results.push({ id: claim.id, status: 'FAILED', reason: 'Player already owned' });
            return;
          }

          // Validate roster & drop player (if any)
          const rosterRef = adminDb.doc(`leagues/${leagueId}/rosters/${freshData.teamId}`);
          const rosterSnap = await tx.get(rosterRef);
          if (!rosterSnap.exists) {
            tx.update(claimRef, {
              status: 'FAILED',
              processedAt: new Date(),
              reason: 'Roster not found',
            });
            logFailure('Roster not found');
            results.push({ id: claim.id, status: 'FAILED', reason: 'Roster not found' });
            return;
          }
          const rosterData = rosterSnap.data() as RosterDoc;
          const playerIds = [...(rosterData.playerIds || [])];

          if (freshData.dropPlayerId) {
            const dropIdx = playerIds.indexOf(freshData.dropPlayerId);
            if (dropIdx === -1) {
              tx.update(claimRef, {
                status: 'FAILED',
                processedAt: new Date(),
                reason: 'Drop player not on roster',
              });
              logFailure('Drop player not on roster');
              results.push({ id: claim.id, status: 'FAILED', reason: 'Drop player not on roster' });
              return;
            }
            playerIds.splice(dropIdx, 1); // remove drop
            // Remove drop ownership doc if exists (safe even if missing)
            const dropOwnershipRef = adminDb.doc(`leagues/${leagueId}/playerOwnerships/${freshData.dropPlayerId}`);
            tx.delete(dropOwnershipRef);
          }

          // FAAB debit (if applicable and claim has bidAmount)
          if (isFAAB && typeof freshData.bidAmount === 'number' && freshData.bidAmount > 0) {
            const priorityRef = adminDb.doc(`leagues/${leagueId}/waiverPriorities/${freshData.userId}`);
            const prioritySnap = await tx.get(priorityRef);
            const faabBudget = waiverSettings.faabBudget ?? null;
            let remainingFAAB = prioritySnap.exists ? (prioritySnap.data()?.remainingFAAB as number | undefined) : undefined;

            // Initialize remainingFAAB if not present but budget defined
            if (remainingFAAB === undefined && typeof faabBudget === 'number') {
              remainingFAAB = faabBudget; // assume full budget if first debit and doc missing
            }

            if (typeof remainingFAAB !== 'number') {
              tx.update(claimRef, {
                status: 'FAILED',
                processedAt: new Date(),
                reason: 'FAAB balance unavailable',
              });
              logFailure('FAAB balance unavailable');
              results.push({ id: claim.id, status: 'FAILED', reason: 'FAAB balance unavailable' });
              return;
            }

            if (freshData.bidAmount > remainingFAAB) {
              tx.update(claimRef, {
                status: 'FAILED',
                processedAt: new Date(),
                reason: 'Insufficient FAAB',
              });
              logFailure('Insufficient FAAB');
              results.push({ id: claim.id, status: 'FAILED', reason: 'Insufficient FAAB' });
              return;
            }

            const newRemaining = remainingFAAB - freshData.bidAmount;
            if (prioritySnap.exists) {
              tx.update(priorityRef, { remainingFAAB: newRemaining, updatedAt: new Date() });
            } else {
              tx.set(priorityRef, { remainingFAAB: newRemaining, leagueId, userId: freshData.userId, createdAt: new Date(), updatedAt: new Date() });
            }
          }

          // Add new player & apply changes
          playerIds.push(freshData.playerId);
          tx.update(rosterRef, { playerIds, updatedAt: new Date() });
          tx.set(playerOwnershipRef, {
            leagueId,
            playerId: freshData.playerId,
            teamId: freshData.teamId,
            userId: freshData.userId,
            acquiredAt: new Date(),
          });
          tx.update(claimRef, { status: 'SUCCESSFUL', processedAt: new Date() });
          // audit: waiver-successful
          const successActivityRef = adminDb.collection(`leagues/${leagueId}/activity`).doc();
          tx.set(successActivityRef, {
            type: 'waiver-successful',
            leagueId,
            userId: freshData.userId,
            teamId: freshData.teamId,
            playerId: freshData.playerId,
            dropPlayerId: freshData.dropPlayerId || undefined,
            bidAmount: freshData.bidAmount || undefined,
            claimId: claim.id,
            timestamp: new Date(),
          });
          results.push({ id: claim.id, status: 'SUCCESSFUL' });
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'Unknown error';
        results.push({ id: claim.id, status: 'ERROR', reason });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (err) {
    console.error('Waiver process error', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
