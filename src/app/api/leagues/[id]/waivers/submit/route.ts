import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { tags } from '@/lib/cacheTags';
import { adminDb } from '@/lib/firebaseAdmin';
import { getWeekWindowStart, isActivelyOwned, isCantCutPlayer, parseLeagueWaiverRules } from '@/lib/leagueRules';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { logger, withTiming } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LeagueRostersDoc = { playerIds?: string[] };

const paramsSchema = z.object({
  id: z.string().min(1, 'Missing leagueId'),
});

const bodySchema = z.object({
  teamId: z.string().min(1),
  playerId: z.string().min(1),
  dropPlayerId: z.string().min(1).optional(),
  priority: z.number().int().positive().optional().default(1),
  bidAmount: z.number().finite().optional(),
});

export const POST = withMetrics(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const parsedParams = paramsSchema.safeParse(await context.params);
      if (!parsedParams.success) {
        return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });
      }
      const { id: leagueId } = parsedParams.data;

      const userId = await getAuthenticatedUserId(req);
      if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const body = (await req.json().catch(() => null)) as unknown;
      const parsedBody = bodySchema.safeParse(body);
      if (!parsedBody.success) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }
      const { teamId, playerId, dropPlayerId, priority, bidAmount } = parsedBody.data;

      logger.apiRequest('POST', `/api/leagues/${leagueId}/waivers/submit`, {
        userId,
        teamId,
        playerId,
      });
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
      const ownershipData = ownershipDoc.exists
        ? (ownershipDoc.data() as FirebaseFirestore.DocumentData | undefined)
        : undefined;
      const ownedByOwnershipDoc = isActivelyOwned(ownershipData);
      if (ownedByOwnershipDoc || !rosterOwned.empty) {
        return NextResponse.json({ error: 'Player already owned' }, { status: 409 });
      }

      // Read waiver settings
      const settingsSnap = await withTiming('waivers.settings.get', () =>
        adminDb.doc(`leagues/${leagueId}/config/settings`).get()
      );
      const rawSettings: unknown = settingsSnap.data();
      const rules = parseLeagueWaiverRules(rawSettings);

      if (rules.acquisitionLocked) {
        return NextResponse.json(
          { error: 'Acquisitions are locked for the current round' },
          { status: 423 }
        );
      }

      if (isCantCutPlayer(String(playerId), rules)) {
        return NextResponse.json(
          { error: "This player is on the can't cut list and cannot be acquired via waivers" },
          { status: 400 }
        );
      }
      if (dropPlayerId && isCantCutPlayer(String(dropPlayerId), rules)) {
        return NextResponse.json(
          { error: "Selected drop player is on the can't cut list" },
          { status: 400 }
        );
      }

      // Enforce roster capacity when no linked drop is provided.
      const teamRosterSnap = await adminDb.doc(`leagues/${leagueId}/rosters/${teamId}`).get();
      const teamRosterData = teamRosterSnap.exists
        ? (teamRosterSnap.data() as LeagueRostersDoc | undefined)
        : undefined;
      const rosterPlayerCount = Array.isArray(teamRosterData?.playerIds)
        ? teamRosterData!.playerIds.length
        : 0;
      const rosterSettings = (rawSettings && typeof rawSettings === 'object'
        ? ((rawSettings as { rosterSettings?: { totalRosterSize?: number } }).rosterSettings ?? {})
        : {}) as { totalRosterSize?: number };
      const rosterCapacity =
        typeof rosterSettings.totalRosterSize === 'number' && Number.isFinite(rosterSettings.totalRosterSize)
          ? Math.max(1, Math.round(rosterSettings.totalRosterSize))
          : undefined;
      if (!dropPlayerId && typeof rosterCapacity === 'number' && rosterPlayerCount >= rosterCapacity) {
        return NextResponse.json(
          { error: 'Roster is at limit. Include a player to drop with this claim.' },
          { status: 400 }
        );
      }

      // Enforce acquisition limits from rules where configured.
      if (typeof rules.maxSeasonAcquisitions === 'number') {
        const seasonCountSnap = await adminDb
          .collection(`leagues/${leagueId}/waivers`)
          .where('userId', '==', userId)
          .where('status', '==', 'SUCCESSFUL')
          .get();
        if (seasonCountSnap.size >= rules.maxSeasonAcquisitions) {
          return NextResponse.json({ error: 'Season acquisition limit reached' }, { status: 400 });
        }
      }
      if (typeof rules.maxWeekAcquisitions === 'number') {
        const weekStart = getWeekWindowStart();
        const weekCountSnap = await adminDb
          .collection(`leagues/${leagueId}/waivers`)
          .where('userId', '==', userId)
          .where('status', '==', 'SUCCESSFUL')
          .where('processedAt', '>=', weekStart)
          .get();
        if (weekCountSnap.size >= rules.maxWeekAcquisitions) {
          return NextResponse.json({ error: 'Weekly acquisition limit reached' }, { status: 400 });
        }
      }

      const isFAAB = rules.system === 'FAAB';
      let validatedBid: number | undefined = undefined;

      if (isFAAB) {
        const minBid = rules.minimumBid;
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
        const ownershipDataTx = ownershipDocTx.exists
          ? (ownershipDocTx.data() as FirebaseFirestore.DocumentData | undefined)
          : undefined;
        if (isActivelyOwned(ownershipDataTx)) throw new Error('PLAYER_OWNED');

        // If FAAB, ensure we are not exceeding remaining (using pre-aggregated pendingBidTotal if present)
        if (isFAAB && typeof validatedBid === 'number') {
          const priorityRef = adminDb.doc(`leagues/${leagueId}/waiverPriorities/${userId}`);
          const prioritySnap = await tx.get(priorityRef);
          const remainingFAAB = prioritySnap.exists
            ? (prioritySnap.data()?.remainingFAAB as number | undefined)
            : undefined;
          if (typeof remainingFAAB === 'number') {
            // Store and calculate in cents to avoid floating point issues
            const existingPendingBidTotal =
              typeof prioritySnap.data()?.pendingBidTotal === 'number'
                ? (prioritySnap.data()!.pendingBidTotal as number)
                : 0;
            const existingPendingBidTotalCentsField = prioritySnap.data()?.pendingBidTotalCents as
              | number
              | undefined;
            const pendingBidTotalCents =
              typeof existingPendingBidTotalCentsField === 'number'
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
              tx.set(
                priorityRef,
                {
                  leagueId,
                  userId,
                  pendingBidTotalCents: validatedBidCents,
                  pendingBidTotal: validatedBidCents / 100,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
                { merge: true }
              );
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

      logger.info('waiver submitted', {
        leagueId,
        userId,
        teamId,
        playerId: String(playerId),
        claimId,
      });
      try {
        const results = await Promise.allSettled([
          revalidateTag(tags.waivers(leagueId)),
          revalidateTag(tags.league(leagueId)),
        ]);
        const failed = results.filter((r) => r.status === 'rejected').length;
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
  },
  'POST /api/leagues/[id]/waivers/submit'
);
