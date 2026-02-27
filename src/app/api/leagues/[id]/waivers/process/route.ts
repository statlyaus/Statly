import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { FieldValue } from 'firebase-admin/firestore';

import { tags } from '@/lib/cacheTags';
import { adminDb } from '@/lib/firebaseAdmin';
import { isActivelyOwned, isCantCutPlayer, parseLeagueWaiverRules } from '@/lib/leagueRules';
import { logger, withTiming } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NOTE: Protect this endpoint (e.g. internal auth, cron token, or commissioner role verification)
// It processes all pending waiver claims for a league and applies results atomically per claim.

// Normalize Firestore Timestamp or Date-like into a JS Date
function normalizeFirestoreDate(date?: FirebaseFirestore.Timestamp | Date): Date {
  if (date instanceof Date) return date;
  if (
    date &&
    typeof date === 'object' &&
    'toDate' in date &&
    typeof (date as any).toDate === 'function'
  ) {
    return (date as FirebaseFirestore.Timestamp).toDate();
  }
  return new Date();
}

interface WaiverClaimRaw {
  id: string;
  leagueId: string;
  userId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
  createdAt: Date;
  bidAmount?: number;
}

interface RosterDoc {
  playerIds?: string[];
  bench?: string[];
  updatedAt?: FirebaseFirestore.Timestamp | Date;
}

async function releaseExpiredWaiverHoldsToFreeAgency(
  leagueId: string,
  claimedPlayerIds: Set<string>
): Promise<number> {
  const now = new Date();
  const lockedSnap = await adminDb
    .collection(`leagues/${leagueId}/playerOwnerships`)
    .where('waiverHold', '==', true)
    .where('waiverExpiresAt', '<=', now)
    .limit(500)
    .get();

  if (lockedSnap.empty) return 0;

  const batch = adminDb.batch();
  let releasedCount = 0;
  for (const docSnap of lockedSnap.docs) {
    const playerId = docSnap.id;
    // If there are still pending claims for this player in this run, let claim processing handle it.
    if (claimedPlayerIds.has(playerId)) continue;

    batch.set(
      docSnap.ref,
      {
        available: true,
        waiverHold: false,
        waived: false,
        owners: [],
        userId: null,
        teamId: null,
        releasedToFreeAgencyAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    const activityRef = adminDb.collection(`leagues/${leagueId}/activity`).doc();
    batch.set(activityRef, {
      type: 'waiver-expired-to-free-agency',
      leagueId,
      playerId,
      timestamp: now,
    });
    releasedCount += 1;
  }

  if (releasedCount > 0) {
    await batch.commit();
  }

  return releasedCount;
}

export const POST = withMetrics(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: leagueId } = await params;
    try {
      // Stronger auth: verify Firebase ID token from Authorization header or session
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Authorization: require commissioner/owner role for this league
      const memberSnap = await adminDb
        .collection('leagues')
        .doc(leagueId)
        .collection('members')
        .doc(userId)
        .get();
      const member = memberSnap.data() as { role?: string } | undefined;
      const role = member?.role ?? 'member';
      const allowed = role === 'owner' || role === 'commissioner' || role === 'admin';
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // Load waiver settings to determine processing order
      const settingsSnap = await withTiming('waivers.settings.get', () =>
        adminDb.doc(`leagues/${leagueId}/config/settings`).get()
      );
      const rules = parseLeagueWaiverRules(settingsSnap.data());
      const waiverSettings = settingsSnap.data()?.waiverSettings || {};
      const isFAAB = rules.system === 'FAAB';

      // Fetch pending claims in pages to avoid unbounded scans
      const pendingCol = adminDb
        .collection(`leagues/${leagueId}/waivers`)
        .where('status', '==', 'PENDING');
      const pending: WaiverClaimRaw[] = [];
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      const PAGE = 500;
      // Loop with pagination by __name__
      for (let i = 0; i < 10; i++) {
        // hard cap to avoid runaway
        let q: FirebaseFirestore.Query = pendingCol.orderBy('__name__').limit(PAGE);
        if (cursor) q = q.startAfter(cursor);
        const snap = await withTiming('waivers.pending.page', () => q.get());
        if (snap.empty) break;
        for (const d of snap.docs) {
          const data = d.data() as Partial<
            WaiverClaimRaw & { createdAt?: FirebaseFirestore.Timestamp | Date }
          >;
          const createdAt = normalizeFirestoreDate(data.createdAt);
          const claim: WaiverClaimRaw = {
            id: d.id,
            leagueId: data.leagueId || leagueId,
            userId: data.userId || '',
            teamId: data.teamId || '',
            playerId: data.playerId || '',
            priority: typeof data.priority === 'number' ? data.priority : 1,
            status: (data.status as WaiverClaimRaw['status']) || 'PENDING',
            createdAt,
            ...(typeof data.bidAmount === 'number' ? { bidAmount: data.bidAmount } : {}),
            ...(data.dropPlayerId ? { dropPlayerId: data.dropPlayerId } : {}),
          };
          pending.push(claim);
        }
        if (snap.size < PAGE) break;
        const lastDoc = snap.docs[snap.docs.length - 1];
        if (lastDoc) {
          cursor = lastDoc;
        }
      }

      if (!pending.length) {
        const releasedToFreeAgency = await releaseExpiredWaiverHoldsToFreeAgency(leagueId, new Set());
        return NextResponse.json({ processed: 0, results: [], releasedToFreeAgency });
      }

      // Sort per system:
      // FAAB: highest bid first, then priority asc (lower number = higher priority), then createdAt asc
      // Rolling list / others: priority asc, createdAt asc
      let reverseLadderRankByTeamId = new Map<string, number>();
      if (!isFAAB && rules.priorityMode === 'REVERSE_LADDER') {
        const membersSnap = await adminDb.collection(`leagues/${leagueId}/members`).get();
        membersSnap.forEach((docSnap) => {
          const data = docSnap.data() as { ladderRank?: number; teamId?: string };
          const rank =
            typeof data.ladderRank === 'number' && Number.isFinite(data.ladderRank)
              ? data.ladderRank
              : undefined;
          if (typeof rank === 'number') {
            reverseLadderRankByTeamId.set(docSnap.id, rank);
            if (typeof data.teamId === 'string' && data.teamId.length > 0) {
              reverseLadderRankByTeamId.set(data.teamId, rank);
            }
          }
        });
      }

      pending.sort((a, b) => {
        // If FAAB, first compare bid (desc)
        if (isFAAB) {
          const bidDiff = (b.bidAmount ?? 0) - (a.bidAmount ?? 0);
          if (bidDiff !== 0) return bidDiff;
        }

        if (!isFAAB && rules.priorityMode === 'REVERSE_LADDER') {
          const rankA = reverseLadderRankByTeamId.get(a.teamId) ?? 0;
          const rankB = reverseLadderRankByTeamId.get(b.teamId) ?? 0;
          // Higher rank number = lower ladder position = higher waiver priority.
          if (rankA !== rankB) return rankB - rankA;
        }

        // Next compare priority (asc) for both FAAB ties and non-FAAB systems
        const prioDiff = a.priority - b.priority;
        if (prioDiff !== 0) return prioDiff;

        // Final tie-breaker: createdAt (asc)
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      const results: Array<{ id: string; status: string; reason?: string }> = [];
      const winners: string[] = [];
      const claimedPlayerIds = new Set(pending.map((claim) => String(claim.playerId)));
      const releasedToFreeAgency = await releaseExpiredWaiverHoldsToFreeAgency(
        leagueId,
        claimedPlayerIds
      );

      for (const claim of pending) {
        try {
          await adminDb.runTransaction(async (tx) => {
            // Helper to emit audit log for failures
            function logFailure(claim: WaiverClaimRaw, reason: string) {
              const activityRef = adminDb.collection(`leagues/${leagueId}/activity`).doc();
              tx.set(activityRef, {
                type: 'waiver-failed',
                leagueId,
                userId: claim.userId,
                teamId: claim.teamId,
                playerId: claim.playerId,
                dropPlayerId: claim.dropPlayerId || undefined,
                bidAmount: claim.bidAmount || undefined,
                reason,
                claimId: claim.id,
                timestamp: new Date(),
              });
            }

            // Helper to decrement pendingBidTotal when a PENDING claim leaves PENDING
            const decrementPendingBidTotal = async (freshData: WaiverClaimRaw) => {
              if (!isFAAB) return;
              const bid = typeof freshData.bidAmount === 'number' ? freshData.bidAmount : 0;
              if (bid <= 0) return;
              const priorityRef = adminDb.doc(
                `leagues/${leagueId}/waiverPriorities/${freshData.userId}`
              );
              const prSnap = await tx.get(priorityRef);
              const update = {
                pendingBidTotal: FieldValue.increment(-bid),
                updatedAt: new Date(),
              } as const;
              if (prSnap.exists) {
                tx.update(priorityRef, update);
              } else {
                tx.set(
                  priorityRef,
                  { leagueId, userId: freshData.userId, ...update },
                  { merge: true }
                );
              }
            };

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

            if (
              isCantCutPlayer(String(freshData.playerId), rules) ||
              (freshData.dropPlayerId && isCantCutPlayer(String(freshData.dropPlayerId), rules))
            ) {
              await decrementPendingBidTotal(freshData);
              tx.update(claimRef, {
                status: 'CANCELLED',
                processedAt: new Date(),
                reason: "Claim includes a player on the can't cut list",
              });
              results.push({
                id: claim.id,
                status: 'CANCELLED',
                reason: "Claim includes a player on the can't cut list",
              });
              const cancelledActivityRef = adminDb.collection(`leagues/${leagueId}/activity`).doc();
              tx.set(cancelledActivityRef, {
                type: 'waiver-cancelled',
                leagueId,
                userId: freshData.userId,
                teamId: freshData.teamId,
                playerId: freshData.playerId,
                dropPlayerId: freshData.dropPlayerId || undefined,
                claimId: freshData.id,
                reason: "Claim includes a player on the can't cut list",
                timestamp: new Date(),
              });
              return;
            }

            const playerOwnershipRef = adminDb.doc(
              `leagues/${leagueId}/playerOwnerships/${freshData.playerId}`
            );
            const ownershipSnap = await tx.get(playerOwnershipRef);
            const ownershipData = ownershipSnap.exists
              ? (ownershipSnap.data() as FirebaseFirestore.DocumentData | undefined)
              : undefined;
            if (isActivelyOwned(ownershipData)) {
              await decrementPendingBidTotal(freshData);
              tx.update(claimRef, {
                status: 'FAILED',
                processedAt: new Date(),
                reason: 'Player already owned',
              });
              logFailure(freshData, 'Player already owned');
              results.push({ id: claim.id, status: 'FAILED', reason: 'Player already owned' });
              return;
            }

            // Validate roster & drop player (if any)
            const rosterRef = adminDb.doc(`leagues/${leagueId}/rosters/${freshData.teamId}`);
            const rosterSnap = await tx.get(rosterRef);
            if (!rosterSnap.exists) {
              await decrementPendingBidTotal(freshData);
              tx.update(claimRef, {
                status: 'FAILED',
                processedAt: new Date(),
                reason: 'Roster not found',
              });
              logFailure(freshData, 'Roster not found');
              results.push({ id: claim.id, status: 'FAILED', reason: 'Roster not found' });
              return;
            }
            const rosterData = rosterSnap.data() as RosterDoc;
            const playerIds = [...(rosterData.playerIds || [])];

            if (freshData.dropPlayerId) {
              const dropIdx = playerIds.indexOf(freshData.dropPlayerId);
              if (dropIdx === -1) {
                await decrementPendingBidTotal(freshData);
                tx.update(claimRef, {
                  status: 'FAILED',
                  processedAt: new Date(),
                  reason: 'Drop player not on roster',
                });
                logFailure(freshData, 'Drop player not on roster');
                results.push({
                  id: claim.id,
                  status: 'FAILED',
                  reason: 'Drop player not on roster',
                });
                return;
              }
              playerIds.splice(dropIdx, 1); // remove drop
              // Remove drop ownership doc if exists (safe even if missing)
              const dropOwnershipRef = adminDb.doc(
                `leagues/${leagueId}/playerOwnerships/${freshData.dropPlayerId}`
              );
              tx.delete(dropOwnershipRef);
            }

            // FAAB debit (if applicable and claim has bidAmount)
            if (isFAAB && typeof freshData.bidAmount === 'number' && freshData.bidAmount > 0) {
              const priorityRef = adminDb.doc(
                `leagues/${leagueId}/waiverPriorities/${freshData.userId}`
              );
              const prioritySnap = await tx.get(priorityRef);
              const faabBudget = waiverSettings.faabBudget ?? null;
              let remainingFAAB = prioritySnap.exists
                ? (prioritySnap.data()?.remainingFAAB as number | undefined)
                : undefined;

              // Initialize remainingFAAB if not present but budget defined
              if (remainingFAAB === undefined && typeof faabBudget === 'number') {
                remainingFAAB = faabBudget; // assume full budget if first debit and doc missing
              }

              if (typeof remainingFAAB !== 'number') {
                await decrementPendingBidTotal(freshData);
                tx.update(claimRef, {
                  status: 'FAILED',
                  processedAt: new Date(),
                  reason: 'FAAB balance unavailable',
                });
                logFailure(freshData, 'FAAB balance unavailable');
                results.push({
                  id: claim.id,
                  status: 'FAILED',
                  reason: 'FAAB balance unavailable',
                });
                return;
              }

              if (freshData.bidAmount > remainingFAAB) {
                await decrementPendingBidTotal(freshData);
                tx.update(claimRef, {
                  status: 'FAILED',
                  processedAt: new Date(),
                  reason: 'Insufficient FAAB',
                });
                logFailure(freshData, 'Insufficient FAAB');
                results.push({ id: claim.id, status: 'FAILED', reason: 'Insufficient FAAB' });
                return;
              }

              const newRemaining = remainingFAAB - freshData.bidAmount;
              if (prioritySnap.exists) {
                tx.update(priorityRef, { remainingFAAB: newRemaining, updatedAt: new Date() });
              } else {
                tx.set(priorityRef, {
                  remainingFAAB: newRemaining,
                  leagueId,
                  userId: freshData.userId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
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
              owners: [freshData.userId],
              available: false,
              waiverHold: false,
              waived: false,
              acquiredAt: new Date(),
            });
            await decrementPendingBidTotal(freshData);
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
            winners.push(freshData.userId);
          });
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'Unknown error';
          results.push({ id: claim.id, status: 'ERROR', reason });
        }
      }

      if (!isFAAB && rules.priorityMode === 'ROLLING' && rules.moveWinnerToBack && winners.length > 0) {
        const uniqueWinners = Array.from(new Set(winners));
        const prioritiesRef = adminDb.collection(`leagues/${leagueId}/waiverPriorities`);
        const prioritiesSnap = await prioritiesRef.get();
        let maxPriority = 0;
        prioritiesSnap.forEach((docSnap) => {
          const value = docSnap.data()?.currentPriority;
          if (typeof value === 'number' && Number.isFinite(value)) {
            maxPriority = Math.max(maxPriority, value);
          }
        });
        const batch = adminDb.batch();
        let nextPriority = maxPriority;
        for (const winnerUserId of uniqueWinners) {
          nextPriority += 1;
          const winnerRef = prioritiesRef.doc(winnerUserId);
          batch.set(
            winnerRef,
            {
              userId: winnerUserId,
              leagueId,
              currentPriority: nextPriority,
              lastClaimDate: new Date(),
              updatedAt: new Date(),
            },
            { merge: true }
          );
        }
        await batch.commit();
      }

      logger.info('waivers processed', { leagueId, processed: results.length });
      const revalResults = await Promise.allSettled([
        revalidateTag(tags.waivers(leagueId)),
        revalidateTag(tags.league(leagueId)),
      ]);
      const rejected = revalResults.filter((r) => r.status === 'rejected');
      if (rejected.length) {
        logger.warn('Failed to revalidate tags after waivers process', {
          leagueId,
          failed: rejected.length,
        });
      }
      return NextResponse.json({ processed: results.length, results, releasedToFreeAgency });
    } catch (err) {
      logger.apiError('POST', '/api/leagues/[id]/waivers/process', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  'POST /api/leagues/[id]/waivers/process'
);
